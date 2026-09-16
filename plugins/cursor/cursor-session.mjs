import { AcpTransport } from './acp-transport.mjs';

export const CAPABILITIES = [
  'session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel',
  'stream.text', 'approval.respond', 'user-input.respond',
];

const RECOVERY_SCHEMA = 'dev.aibo.cursor.recovery';
const MODE_BY_INTERACTION = { ask: 'ask', plan: 'plan', edit: 'agent' };

function pluginError(kind, message) { return Object.assign(new Error(message), { kind }); }
function object(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
function bounded(value, max = 12_000) {
  const text = typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}
function toolPayload(tool, update = {}) {
  const content = update.content ?? tool.content ?? [];
  const text = Array.isArray(content) ? content.map(part => part?.content?.text ?? part?.text ?? (part?.type === 'diff' ? `${part.path ?? ''}\n${part.newText ?? ''}` : '')).filter(Boolean).join('\n') : bounded(content);
  const rawInput = object(update.rawInput ?? tool.rawInput);
  return {
    itemId: tool.toolCallId,
    itemType: tool.kind ?? 'other',
    summary: tool.title ?? 'Cursor tool',
    ...(text ? { [update.status === 'completed' ? 'output' : 'delta']: bounded(text) } : {}),
    ...(typeof rawInput.command === 'string' ? { command: bounded(rawInput.command, 4_000) } : {}),
    ...(typeof rawInput.cwd === 'string' ? { cwd: bounded(rawInput.cwd, 4_000) } : {}),
    status: update.status ?? tool.status ?? 'pending',
  };
}

export function validateExecutionProfile(profile, permissions) {
  const p = object(profile);
  if (p.schema !== 'aibo.execution-profile/v1') throw pluginError('invalid_input', 'Cursor requires execution profile v1');
  const mode = MODE_BY_INTERACTION[p.interactionMode];
  if (!mode) throw pluginError('invalid_input', 'Cursor requires a supported interaction mode');
  if (p.model != null || p.reasoningEffort != null) throw pluginError('unsupported', 'Cursor model and reasoning selection are not enabled in this release');
  if (mode === 'agent') {
    if (!permissions.includes('workspace.write')) throw pluginError('permission_denied', 'Cursor edit mode requires workspace.write');
    if (p.filesystemPolicy !== 'workspace-write') throw pluginError('unsupported', 'Cursor edit mode currently supports workspace-write only');
    if (p.approvalReviewer !== 'user' || p.approvalPolicy !== 'on-request') throw pluginError('unsupported', 'Cursor edit mode currently requires user/on-request approval');
    if (p.commandPolicy !== 'approved') throw pluginError('unsupported', 'Cursor edit mode currently requires approved commands');
  } else if (p.filesystemPolicy !== 'read-only' || p.commandPolicy !== 'disabled' || p.approvalPolicy !== 'never' || p.approvalReviewer !== 'none') {
    throw pluginError('unsupported', 'Cursor ask and plan modes require read-only files, disabled commands, and no approvals');
  }
  if (p.networkPolicy !== 'disabled') throw pluginError('unsupported', 'Cursor network access is not enabled in this release');
  return { mode, profile: p };
}

export function additionalInstructionsFromSettings(settings) {
  if (settings == null) return '';
  const value = object(settings);
  const values = object(value.values);
  if (value.schema !== 'aibo.agent-settings/v1' || value.version !== 1 || typeof values.additionalInstructions !== 'string' || values.additionalInstructions.length > 8_000) {
    throw pluginError('invalid_input', 'Cursor received invalid agent settings');
  }
  return values.additionalInstructions;
}

export class CursorSession {
  constructor({ transportFactory = options => new AcpTransport(options), emit = () => {}, pluginVersion = '0.1.0', cancelGraceMs = 5_000 } = {}) {
    this.transportFactory = transportFactory;
    this.emit = emit;
    this.pluginVersion = pluginVersion;
    this.cancelGraceMs = cancelGraceMs;
    this.pendingInteractions = new Map();
    this.tools = new Map();
    this.completedTools = new Set();
    this.phase = 'stopped';
  }

  async open({ mode, workspaceId, workspacePath, executionProfile, recovery, permissions }) {
    if (this.phase === 'failed' || this.transport?.closed) await this.close();
    if (this.phase !== 'stopped') {
      if (this.sessionId && this.workspaceId === workspaceId) return this.snapshot();
      throw pluginError('busy', 'Cursor session is already open');
    }
    const policy = validateExecutionProfile(executionProfile, permissions);
    const restored = mode === 'resume' ? this.#validateRecovery(recovery, workspaceId, workspacePath) : null;
    this.phase = 'starting';
    this.workspaceId = workspaceId;
    this.workspacePath = workspacePath;
    this.profile = policy.profile;
    this.modeId = policy.mode;
    const transport = this.transportFactory({ cwd: workspacePath }).start();
    this.transport = transport;
    this.removeRequest = transport.onRequest(message => this.#handleRequest(message));
    this.removeNotification = transport.onNotification(message => this.#handleNotification(message));
    try {
      this.phase = 'initializing';
      const initialized = await transport.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
        clientInfo: { name: 'aibo-cursor', version: this.pluginVersion },
      });
      if (initialized?.protocolVersion !== 1) throw pluginError('incompatible_version', 'Cursor ACP protocol v1 is required');
      if (!initialized.authMethods?.some(method => method.id === 'cursor_login')) throw pluginError('provider_unavailable', 'Cursor did not advertise cursor_login authentication');
      this.agentCapabilities = object(initialized.agentCapabilities);
      this.phase = 'authenticating';
      await transport.request('authenticate', { methodId: 'cursor_login' });
      this.phase = restored ? 'loading' : 'opening';
      let result;
      if (restored) {
        if (this.agentCapabilities.loadSession !== true) throw pluginError('unsupported', 'This Cursor CLI cannot restore ACP sessions');
        result = await transport.request('session/load', { sessionId: restored.nativeSessionId, cwd: workspacePath, mcpServers: [] }, 90_000);
        this.sessionId = restored.nativeSessionId;
      } else {
        result = await transport.request('session/new', { cwd: workspacePath, mcpServers: [] }, 90_000);
        if (typeof result?.sessionId !== 'string' || !result.sessionId) throw pluginError('invalid_output', 'Cursor did not return a session ID');
        this.sessionId = result.sessionId;
      }
      await this.#selectMode(result, policy.mode);
      this.phase = 'ready';
      this.#event('session.started', { mode: this.modeId });
      return this.snapshot();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async prompt({ text, turnId, additionalInstructions = '', writable = false }) {
    if (this.phase !== 'ready' || !this.sessionId) throw pluginError('busy', 'Cursor session is not ready');
    if (writable !== (this.modeId === 'agent')) throw pluginError('permission_denied', writable ? 'Cursor write turn requires edit mode' : 'Cursor edit mode requires a write-authorized turn');
    this.phase = 'prompting';
    this.turnId = turnId;
    this.messageText = '';
    this.reasoningText = '';
    this.messageItemId = null;
    this.reasoningItemId = null;
    this.tools.clear();
    this.completedTools.clear();
    this.#event('turn.started', {});
    const promptText = additionalInstructions.trim() ? `${additionalInstructions.trim()}\n\n${text}` : text;
    try {
      const result = await this.transport.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: promptText }],
      }, 12 * 60 * 60 * 1_000);
      if (this.messageText) this.#event('message.completed', { itemId: this.messageItemId, text: this.messageText }, { itemId: this.messageItemId });
      if (this.reasoningText) this.#event('reasoning.completed', { itemId: this.reasoningItemId, summary: this.reasoningText }, { itemId: this.reasoningItemId });
      const stopReason = result?.stopReason;
      const status = stopReason === 'end_turn' || stopReason === 'refusal' ? 'completed'
        : ['cancelled', 'max_tokens', 'max_turn_requests'].includes(stopReason) ? 'interrupted' : 'failed';
      this.#event(status === 'failed' ? 'turn.failed' : 'turn.completed', { status, stopReason: stopReason ?? null });
      return { status, recovery: this.recovery() };
    } catch (error) {
      if (this.phase === 'cancelling') {
        this.#event('turn.completed', { status: 'interrupted', stopReason: 'cancelled', forced: true });
        return { status: 'interrupted', recovery: this.recovery() };
      }
      this.#event('turn.failed', { status: 'failed', message: String(error?.message ?? error).slice(0, 2_000) });
      if (this.transport && !this.transport.closed) await this.transport.close();
      throw error;
    } finally {
      clearTimeout(this.cancelTimer);
      if (this.phase !== 'stopped') this.phase = this.transport?.closed ? 'failed' : 'ready';
      this.turnId = null;
      this.pendingInteractions.clear();
    }
  }

  async cancel() {
    if (!this.sessionId || this.phase !== 'prompting') return { accepted: true };
    for (const [requestId, pending] of this.pendingInteractions) {
      this.transport.respond(pending.rpcId, { outcome: { outcome: 'cancelled' } });
      this.#event(pending.kind === 'question' ? 'user_input.resolved' : 'approval.resolved', { requestId, decision: 'cancel' }, { requestId, ...(pending.kind === 'permission' ? { approvalId: pending.rpcId } : {}) });
    }
    this.pendingInteractions.clear();
    this.phase = 'cancelling';
    this.transport.notify('session/cancel', { sessionId: this.sessionId });
    clearTimeout(this.cancelTimer);
    this.cancelTimer = setTimeout(() => {
      if (this.phase === 'cancelling') void this.transport?.close();
    }, this.cancelGraceMs);
    this.cancelTimer.unref?.();
    return { accepted: true };
  }

  respondApproval(requestId, decision) {
    const pending = this.pendingInteractions.get(requestId);
    if (!pending || pending.turnId !== this.turnId || !['permission', 'plan'].includes(pending.kind)) throw pluginError('invalid_input', 'Cursor approval request is no longer pending');
    if (pending.kind === 'permission') {
      const kind = decision === 'accept' ? 'allow_once' : 'reject_once';
      const option = pending.options.find(candidate => candidate.kind === kind);
      if (!option) this.transport.respond(pending.rpcId, { outcome: { outcome: 'cancelled' } });
      else this.transport.respond(pending.rpcId, { outcome: { outcome: 'selected', optionId: option.optionId } });
    } else {
      this.transport.respond(pending.rpcId, { outcome: decision === 'accept' ? { outcome: 'accepted' } : { outcome: 'rejected' } });
    }
    this.pendingInteractions.delete(requestId);
    this.#event('approval.resolved', { requestId, decision }, { requestId, approvalId: pending.rpcId });
    return { resolved: true, recovery: this.recovery(), capabilities: CAPABILITIES };
  }

  respondUserInput(requestId, answers) {
    const pending = this.pendingInteractions.get(requestId);
    if (!pending || pending.turnId !== this.turnId || pending.kind !== 'question') throw pluginError('invalid_input', 'Cursor question is no longer pending');
    const response = [];
    for (const question of pending.questions) {
      const selected = Array.isArray(answers?.[question.id]) ? answers[question.id] : [answers?.[question.id]].filter(Boolean);
      const allowed = new Set(question.options.map(option => option.id));
      if (!selected.every(value => allowed.has(value)) || (!question.allowMultiple && selected.length > 1)) throw pluginError('invalid_input', 'Cursor question answer contains an invalid option');
      response.push({ questionId: question.id, selectedOptionIds: selected });
    }
    this.transport.respond(pending.rpcId, { outcome: { outcome: 'answered', answers: response } });
    this.pendingInteractions.delete(requestId);
    this.#event('user_input.resolved', { requestId }, { requestId });
    return { resolved: true, recovery: this.recovery(), capabilities: CAPABILITIES };
  }

  snapshot() { return { nativeSessionId: this.sessionId, recovery: this.recovery(), capabilities: CAPABILITIES }; }
  recovery() {
    return { schema: RECOVERY_SCHEMA, version: 1, data: { nativeSessionId: this.sessionId, workspaceId: this.workspaceId, workspacePath: this.workspacePath, protocolVersion: 1, modeId: this.modeId } };
  }

  async close() {
    clearTimeout(this.cancelTimer);
    const transport = this.transport;
    if (transport && !transport.closed) {
      for (const pending of this.pendingInteractions.values()) {
        try { transport.respond(pending.rpcId, { outcome: { outcome: 'cancelled' } }); } catch { /* process is already unavailable */ }
      }
    }
    this.removeRequest?.(); this.removeNotification?.();
    this.transport = null;
    this.pendingInteractions.clear();
    this.phase = 'stopped';
    this.sessionId = null;
    if (transport) await transport.close();
    return { accepted: true };
  }

  async #selectMode(result, expected) {
    const options = result?.configOptions ?? [];
    const mode = options.find(option => option.id === 'mode');
    const available = mode?.options ?? result?.modes?.availableModes ?? [];
    const values = new Set(available.map(option => option.value ?? option.id));
    if (!values.has(expected)) throw pluginError('unsupported', `Cursor does not support ${expected} mode`);
    const current = mode?.currentValue ?? result?.modes?.currentModeId;
    if (current !== expected) {
      const changed = await this.transport.request('session/set_config_option', { sessionId: this.sessionId, configId: 'mode', value: expected });
      const updated = changed?.configOptions?.find(option => option.id === 'mode')?.currentValue;
      if (updated !== undefined && updated !== expected) throw pluginError('invalid_output', 'Cursor did not apply the requested mode');
    }
  }

  #validateRecovery(value, workspaceId, workspacePath) {
    const recovery = object(value);
    const data = object(recovery.data);
    if (recovery.schema !== RECOVERY_SCHEMA || recovery.version !== 1 || typeof data.nativeSessionId !== 'string' || !data.nativeSessionId) throw pluginError('invalid_input', 'Invalid Cursor recovery data');
    if (data.workspaceId !== workspaceId || data.workspacePath !== workspacePath) throw pluginError('permission_denied', 'Cursor recovery belongs to another workspace');
    return data;
  }

  #handleRequest(message) {
    if (!this.turnId || this.phase === 'loading') {
      this.transport.respond(message.id, { outcome: { outcome: 'cancelled' } });
      return true;
    }
    const params = object(message.params);
    if (params.sessionId != null && params.sessionId !== this.sessionId) {
      this.transport.respond(message.id, { outcome: { outcome: 'cancelled' } });
      return true;
    }
    const requestId = `cursor-${typeof message.id === 'number' ? 'n' : 's'}-${String(message.id)}`;
    if (message.method === 'session/request_permission') {
      const options = Array.isArray(params.options) ? params.options : [];
      const toolId = params.toolCall?.toolCallId;
      const knownTool = this.tools.get(toolId) ?? params.toolCall ?? {};
      const networkLike = knownTool.kind === 'fetch' || /\b(mcp|https?|network|fetch|curl|wget)\b/i.test(`${knownTool.title ?? ''}\n${bounded(knownTool.rawInput, 4_000)}`);
      if (this.modeId !== 'agent' || this.profile.approvalReviewer !== 'user' || networkLike) {
        const rejected = options.find(candidate => candidate.kind === 'reject_once');
        this.transport.respond(message.id, rejected ? { outcome: { outcome: 'selected', optionId: rejected.optionId } } : { outcome: { outcome: 'cancelled' } });
        return true;
      }
      if (this.pendingInteractions.size >= 32) {
        this.transport.respond(message.id, { outcome: { outcome: 'cancelled' } });
        return true;
      }
      this.pendingInteractions.set(requestId, { kind: 'permission', rpcId: message.id, options, turnId: this.turnId });
      this.#event('approval.requested', { requestId, kind: params.toolCall?.kind ?? 'tool', command: params.toolCall?.title ?? null, availableDecisions: ['accept', 'cancel'] }, { requestId, toolCallId: params.toolCall?.toolCallId ?? null, approvalId: message.id });
      return true;
    }
    if (message.method === 'cursor/ask_question') {
      const questions = Array.isArray(params.questions) ? params.questions : [];
      if (this.pendingInteractions.size >= 32) {
        this.transport.respond(message.id, { outcome: { outcome: 'cancelled' } });
        return true;
      }
      this.pendingInteractions.set(requestId, { kind: 'question', rpcId: message.id, questions, turnId: this.turnId });
      this.#event('user_input.requested', { requestId, title: params.title ?? null, questions }, { requestId, toolCallId: params.toolCallId ?? null });
      return true;
    }
    if (message.method === 'cursor/create_plan') {
      if (this.pendingInteractions.size >= 32) {
        this.transport.respond(message.id, { outcome: { outcome: 'cancelled' } });
        return true;
      }
      this.pendingInteractions.set(requestId, { kind: 'plan', rpcId: message.id, turnId: this.turnId });
      this.#event('extension.updated', { namespace: 'dev.aibo.cursor', kind: 'plan', requestId, plan: params.plan ?? '', todos: params.todos ?? [] }, { requestId, toolCallId: params.toolCallId ?? null });
      this.#event('approval.requested', { requestId, kind: 'plan', command: params.name ?? 'Cursor plan', description: params.plan ?? '', availableDecisions: ['accept', 'cancel'] }, { requestId, toolCallId: params.toolCallId ?? null, approvalId: message.id });
      return true;
    }
    return false;
  }

  #handleNotification(message) {
    if (message.method === 'transport/closed') {
      this.phase = 'failed';
      if (this.turnId) this.#event('adapter.crashed', { message: message.params?.message ?? 'Cursor ACP exited' });
      return;
    }
    if (['cursor/update_todos', 'cursor/task', 'cursor/generate_image'].includes(message.method)) {
      if (this.turnId) this.#event('extension.updated', { namespace: 'dev.aibo.cursor', kind: message.method.slice('cursor/'.length), ...object(message.params) });
      return;
    }
    if (message.method !== 'session/update' || this.phase === 'loading' || message.params?.sessionId !== this.sessionId || !this.turnId) return;
    const update = object(message.params.update);
    if (update.sessionUpdate === 'agent_message_chunk' && update.content?.type === 'text') {
      const nextItemId = update.messageId ?? this.messageItemId ?? `assistant-${this.turnId}`;
      if (this.messageItemId && nextItemId !== this.messageItemId && this.messageText) {
        this.#event('message.completed', { itemId: this.messageItemId, text: this.messageText }, { itemId: this.messageItemId });
        this.messageText = '';
      }
      this.messageItemId = nextItemId;
      this.messageText += update.content.text;
      this.#event('message.delta', { itemId: this.messageItemId, delta: update.content.text }, { itemId: this.messageItemId });
      return;
    }
    if (update.sessionUpdate === 'agent_thought_chunk' && update.content?.type === 'text') {
      const nextItemId = update.messageId ?? this.reasoningItemId ?? `reasoning-${this.turnId}`;
      if (this.reasoningItemId && nextItemId !== this.reasoningItemId && this.reasoningText) {
        this.#event('reasoning.completed', { itemId: this.reasoningItemId, summary: this.reasoningText }, { itemId: this.reasoningItemId });
        this.reasoningText = '';
      }
      this.reasoningItemId = nextItemId;
      this.reasoningText += update.content.text;
      this.#event('reasoning.updated', { itemId: this.reasoningItemId, delta: update.content.text }, { itemId: this.reasoningItemId });
      return;
    }
    if (update.sessionUpdate === 'tool_call') {
      this.tools.set(update.toolCallId, { ...update });
      this.#event('tool.started', toolPayload(update, { status: 'pending' }), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      if (['completed', 'failed'].includes(update.status)) {
        this.completedTools.add(update.toolCallId);
        this.#event('tool.completed', toolPayload(update), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      }
      return;
    }
    if (update.sessionUpdate === 'tool_call_update') {
      if (this.completedTools.has(update.toolCallId)) return;
      const merged = { ...this.tools.get(update.toolCallId), ...update };
      this.tools.set(update.toolCallId, merged);
      const terminal = ['completed', 'failed'].includes(merged.status);
      if (terminal) this.completedTools.add(update.toolCallId);
      this.#event(terminal ? 'tool.completed' : 'tool.updated', toolPayload(merged, update), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      return;
    }
    if (update.sessionUpdate === 'usage_update') {
      this.#event('usage.updated', { usage: update });
      return;
    }
    if (String(update.sessionUpdate).includes('available_')) return;
    this.#event('extension.updated', { namespace: 'dev.aibo.cursor', update });
  }

  #event(type, payload, correlation = null) {
    this.emit({ nativeSessionId: this.sessionId, turnId: this.turnId ?? null, type, correlation, payload });
  }
}
