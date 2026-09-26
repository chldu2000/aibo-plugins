import { imageInput } from './image-input.mjs';
import { AcpTransport } from './acp-transport.mjs';
import { modelParameters, selectValues } from './model-config.mjs';

export const CAPABILITIES = [
  'session.create', 'session.resume', 'session.close', 'turn.send', 'turn.cancel',
  'stream.text', 'approval.respond', 'user-input.respond', 'command.list',
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
function subagentName(value) {
  if (typeof value === 'string' && value && value !== 'unspecified') return value.replaceAll('_', ' ');
  if (typeof value?.custom === 'string' && value.custom) return value.custom;
  return 'Cursor subagent';
}

export function validateExecutionProfile(profile, permissions) {
  const p = object(profile);
  if (p.schema !== 'aibo.execution-profile/v1') throw pluginError('invalid_input', 'Cursor requires execution profile v1');
  const mode = MODE_BY_INTERACTION[p.interactionMode];
  if (!mode) throw pluginError('invalid_input', 'Cursor requires a supported interaction mode');
  if (!permissions.includes('workspace.read')) throw pluginError('permission_denied', 'Cursor requires workspace.read');
  if (p.model != null && (typeof p.model !== 'string' || !p.model.trim())) throw pluginError('invalid_input', 'Cursor model must be a non-empty reference');
  if (p.reasoningEffort != null && (typeof p.reasoningEffort !== 'string' || !p.reasoningEffort)) throw pluginError('invalid_input', 'Cursor reasoning selection must be a non-empty ID');
  if (mode === 'agent') {
    // Opening/restoring selects a native mode but does not authorize a write
    // turn. The worker checks workspace.write on aibo.session.turn.write.
    if (p.filesystemPolicy !== 'agent-managed') throw pluginError('unsupported', 'Cursor Agent requires provider-managed filesystem permissions');
    if (p.approvalReviewer !== 'user' || p.approvalPolicy !== 'on-request') throw pluginError('unsupported', 'Cursor edit mode currently requires user/on-request approval');
    if (p.commandPolicy !== 'agent-managed') throw pluginError('unsupported', 'Cursor Agent requires provider-managed command permissions');
  } else if (p.filesystemPolicy !== 'read-only' || p.commandPolicy !== 'disabled' || p.approvalPolicy !== 'never' || p.approvalReviewer !== 'none') {
    throw pluginError('unsupported', 'Cursor ask and plan modes require read-only files, disabled commands, and no approvals');
  }
  if (p.networkPolicy !== 'agent-managed') throw pluginError('unsupported', 'Cursor requires provider-managed network permissions');
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
  constructor({ transportFactory = options => new AcpTransport(options), emit = () => {}, pluginVersion = '0.1.0', cancelGraceMs = 5_000, commandWaitMs = 10_000 } = {}) {
    this.transportFactory = transportFactory;
    this.emit = emit;
    this.pluginVersion = pluginVersion;
    this.cancelGraceMs = cancelGraceMs;
    this.commandWaitMs = commandWaitMs;
    this.commandCatalog = null;
    this.earlyCommands = new Map();
    this.commandWaiters = new Set();
    this.pendingInteractions = new Map();
    this.tools = new Map();
    this.hostPermissionReplies = new Set();
    this.completedTools = new Set();
    this.subagents = new Map();
    this.phase = 'stopped';
    this.modelConfig = null;
    this.configOptions = [];
    this.parameterized = false;
  }

  async open({ mode, workspaceId, workspacePath, executionProfile, recovery, permissions, mcpServers = [], hostMcpTools = [] }) {
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
    this.hostMcpTools = hostMcpTools;
    this.hostMcpServerName = mcpServers[0]?.name;
    this.modeId = policy.mode;
    // Cursor does not persist a newly-created session until it receives a
    // prompt. An explicitly empty binding can be recreated after a mode change;
    // older or prompted bindings must still load, never silently lose history.
    this.hasPrompt = restored ? restored.hasPrompt !== false : false;
    const loadNative = restored && this.hasPrompt;
    const transport = this.transportFactory({ cwd: workspacePath }).start();
    this.transport = transport;
    this.removeRequest = transport.onRequest(message => this.transport === transport && this.#handleRequest(message));
    this.removeNotification = transport.onNotification(message => { if (this.transport === transport) this.#handleNotification(message); });
    try {
      this.phase = 'initializing';
      const initialized = await transport.request('initialize', {
        protocolVersion: 1,
        clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false, _meta: { parameterizedModelPicker: true } },
        clientInfo: { name: 'aibo-cursor', version: this.pluginVersion },
      });
      if (initialized?.protocolVersion !== 1) throw pluginError('incompatible_version', 'Cursor ACP protocol v1 is required');
      if (!initialized.authMethods?.some(method => method.id === 'cursor_login')) throw pluginError('provider_unavailable', 'Cursor did not advertise cursor_login authentication');
      this.agentCapabilities = object(initialized.agentCapabilities);
      this.phase = 'authenticating';
      await transport.request('authenticate', { methodId: 'cursor_login' });
      this.phase = loadNative ? 'loading' : 'opening';
      let result;
      if (loadNative) {
        if (this.agentCapabilities.loadSession !== true) throw pluginError('unsupported', 'This Cursor CLI cannot restore ACP sessions');
        result = await transport.request('session/load', { sessionId: restored.nativeSessionId, cwd: workspacePath, mcpServers }, 90_000);
        this.sessionId = restored.nativeSessionId;
      } else {
        result = await transport.request('session/new', { cwd: workspacePath, mcpServers }, 90_000);
        if (typeof result?.sessionId !== 'string' || !result.sessionId) throw pluginError('invalid_output', 'Cursor did not return a session ID');
        this.sessionId = result.sessionId;
      }
      if (this.earlyCommands.has(this.sessionId)) this.#readCommands(this.earlyCommands.get(this.sessionId));
      this.earlyCommands.clear();
      this.#readModelConfig(result);
      await this.#selectMode(result, policy.mode);
      const requestedModel = policy.profile.model ?? restored?.modelId;
      if (requestedModel != null) await this.#setModel(requestedModel);
      const sameModel = !policy.profile.model || policy.profile.model === restored?.modelId;
      const level = policy.profile.reasoningEffort ?? (sameModel ? restored?.reasoningEffort : null);
      if (level != null) await this.#setParameter('reasoning', level);
      if (sameModel && restored?.contextWindow != null) await this.#setParameter('context', restored.contextWindow);
      this.phase = 'ready';
      this.#event('session.started', { mode: this.modeId });
      return this.snapshot();
    } catch (error) {
      await this.close();
      throw error;
    }
  }

  async prompt({ text, turnId, attachments = [], additionalInstructions = '', writable = false }) {
    if (this.phase !== 'ready' || !this.sessionId) throw pluginError('busy', 'Cursor session is not ready');
    if (writable !== (this.modeId === 'agent')) throw pluginError('permission_denied', writable ? 'Cursor write turn requires edit mode' : 'Cursor edit mode requires a write-authorized turn');
    const images = imageInput(attachments, this.agentCapabilities?.promptCapabilities?.image === true);
    this.phase = 'prompting';
    this.turnId = turnId;
    this.messageText = '';
    this.reasoningText = '';
    this.messageItemId = null;
    this.reasoningItemId = null;
    this.tools.clear();
    this.hostPermissionReplies.clear();
    this.completedTools.clear();
    this.subagents.clear();
    this.#event('turn.started', {});
    // Cursor parses leading slash commands before processing ordinary prompt text.
    // Prefixing settings would turn a native command into a model request.
    const promptText = !/^\s*\/\S+/.test(text) && additionalInstructions.trim() ? `${additionalInstructions.trim()}\n\n${text}` : text;
    this.hasPrompt = true;
    try {
      const result = await this.transport.request('session/prompt', {
        sessionId: this.sessionId,
        prompt: [{ type: 'text', text: promptText }, ...images],
      }, 12 * 60 * 60 * 1_000);
      if (this.messageText) this.#event('message.completed', { itemId: this.messageItemId, text: this.messageText }, { itemId: this.messageItemId });
      if (this.reasoningText) this.#event('reasoning.completed', { itemId: this.reasoningItemId, summary: this.reasoningText }, { itemId: this.reasoningItemId });
      const stopReason = result?.stopReason;
      const status = stopReason === 'end_turn' || stopReason === 'refusal' ? 'completed'
        : ['cancelled', 'max_tokens', 'max_turn_requests'].includes(stopReason) ? 'interrupted' : 'failed';
      this.#finishSubagents(
        status === 'interrupted' ? 'interrupted' : status === 'failed' ? 'failed' : 'unavailable',
        status === 'interrupted' ? 'Parent turn was interrupted.' : status === 'failed' ? 'Parent turn failed.' : 'Cursor did not provide a final task notification.',
      );
      this.#event(status === 'failed' ? 'turn.failed' : 'turn.completed', { status, stopReason: stopReason ?? null });
      return { status, recovery: this.recovery() };
    } catch (error) {
      if (this.phase === 'cancelling') {
        this.#finishSubagents('interrupted', 'Parent turn was cancelled.');
        this.#event('turn.completed', { status: 'interrupted', stopReason: 'cancelled', forced: true });
        return { status: 'interrupted', recovery: this.recovery() };
      }
      this.#finishSubagents('failed', 'Cursor task status became unavailable after a transport failure.');
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
    return { resolved: true, recovery: this.recovery(), capabilities: this.capabilities() };
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
    return { resolved: true, recovery: this.recovery(), capabilities: this.capabilities() };
  }

  capabilities() { const capabilities = [...CAPABILITIES, ...(this.hostToolsRegistered ? ['host-tools'] : []), ...(this.agentCapabilities?.promptCapabilities?.image === true ? ['image.input'] : [])]; return this.modelConfig ? [...capabilities, 'model.select', ...(this.parameterized ? ['model.reasoning', 'model.context-window'] : [])] : capabilities; }

  async commands() {
    if (!this.sessionId || !this.transport || this.transport.closed) throw pluginError('invalid_session', 'Cursor command directory requires an open session');
    const transport = this.transport, sessionId = this.sessionId;
    if (this.commandCatalog === null) {
      await new Promise(resolve => {
        const done = () => { clearTimeout(timer); this.commandWaiters.delete(done); resolve(); };
        const timer = setTimeout(done, this.commandWaitMs);
        this.commandWaiters.add(done);
      });
    }
    if (this.transport !== transport || this.sessionId !== sessionId || transport.closed) throw pluginError('invalid_session', 'Cursor session changed while loading commands');
    return { commands: (this.commandCatalog ?? []).map(command => ({ ...command })) };
  }

  #readCommands(available) {
    if (!Array.isArray(available)) return;
    const seen = new Set();
    this.commandCatalog = available.slice(0, 512).flatMap(command => {
      if (typeof command?.name !== 'string' || !/^[^\s/\x00-\x1f\x7f][^\s\x00-\x1f\x7f]{0,255}$/.test(command.name)) return [];
      const key = command.name.toLowerCase();
      if (seen.has(key)) return [];
      seen.add(key);
      // Cursor ACP currently encodes skill origins in description suffixes,
      // rather than a structured type field. Keep unknown commands as agent
      // commands; mentioning "skill" elsewhere is not a classification signal.
      const category = typeof command.description === 'string' && /\((?:builtin|project|user) skill\)$/.test(command.description) ? 'skill' : 'agent';
      return [{ name: command.name, description: typeof command.description === 'string' ? command.description.slice(0, 4000) : null,
        source: category, category, execution: 'prompt',
        ...(typeof command.input?.hint === 'string' ? { argumentHint: command.input.hint.slice(0, 1000) } : {}),
      }];
    });
    for (const done of this.commandWaiters) done();
  }

  parameters() { return modelParameters(this.configOptions ?? [], this.modelConfig?.current); }

  async configure(kind, input) {
    if (this.phase !== 'ready' || !this.sessionId) throw pluginError('busy', 'Cursor configuration requires an idle session');
    if (!['reasoning', 'context'].includes(kind)) throw pluginError('invalid_input', 'Unknown Cursor configuration');
    if (input.action === 'set') {
      const transport = this.transport;
      this.phase = 'configuring';
      try { await this.#setParameter(kind, kind === 'reasoning' ? input.level : input.contextWindow); }
      finally { if (this.transport === transport && this.phase === 'configuring') this.phase = 'ready'; }
    } else if (input.action !== 'list') throw pluginError('invalid_input', 'Unknown Cursor configuration action');
    const parameters = this.parameters();
    return kind === 'reasoning'
      ? { current: parameters.current, levels: parameters.levels.map(({ values, ...level }) => level), recovery: this.recovery(parameters), capabilities: this.capabilities() }
      : { current: parameters.context?.currentValue ?? null, contextWindows: parameters.contextWindows, recovery: this.recovery(parameters), capabilities: this.capabilities() };
  }

  async #setParameter(kind, value) {
    const parameters = this.parameters();
    const values = kind === 'reasoning' ? parameters.levels.find(level => level.id === value)?.values
      : parameters.contextWindows.some(option => option.id === value) ? [{ id: parameters.context.id, value }] : null;
    if (!values) throw pluginError('invalid_input', 'Cursor parameter is not in the current model catalog');
    const model = this.modelConfig.current;
    for (const selection of values) {
      if (this.modelConfig?.current !== model) throw pluginError('invalid_session', 'Cursor model changed during configuration');
      const config = this.configOptions.find(config => config.id === selection.id);
      if (!selectValues(config).some(option => option.value === selection.value)) throw pluginError('invalid_input', 'Cursor parameter options changed during configuration');
      if (config.currentValue === selection.value) continue;
      const transport = this.transport, sessionId = this.sessionId;
      const result = await transport.request('session/set_config_option', { sessionId, configId: selection.id, value: selection.value });
      if (this.transport !== transport || this.sessionId !== sessionId || transport.closed) throw pluginError('invalid_session', 'Cursor session changed during configuration');
      this.#readModelConfig(result);
      if (!Array.isArray(result?.configOptions) || this.modelConfig?.current !== model || this.configOptions.find(config => config.id === selection.id)?.currentValue !== selection.value) throw pluginError('invalid_output', 'Cursor did not confirm the requested parameter');
    }
    const confirmed = this.parameters();
    if ((kind === 'reasoning' ? confirmed.current : confirmed.context?.currentValue) !== value) throw pluginError('invalid_output', 'Cursor did not confirm the requested parameter combination');
  }

  async models(input) {
    if (this.phase !== 'ready' || !this.sessionId) throw pluginError('busy', 'Cursor model configuration requires an idle session');
    if (!this.modelConfig) throw pluginError('unsupported', 'Cursor did not provide model configuration');
    if (input.action === 'set') {
      const transport = this.transport;
      this.phase = 'configuring';
      try { await this.#setModel(input.reference); }
      finally { if (this.transport === transport && this.phase === 'configuring') this.phase = 'ready'; }
    } else if (input.action !== 'list') throw pluginError('invalid_input', 'Unknown Cursor model action');
    const parameters = this.parameters();
    return { current: this.modelConfig.current, currentContextWindow: parameters.context?.currentValue ?? null,
      models: this.modelConfig.models.map(model => ({ ...model, reasoningEfforts: model.reference === this.modelConfig.current ? parameters.levels.map(({ values, ...level }) => level) : [], contextWindows: model.reference === this.modelConfig.current ? parameters.contextWindows : [] })), recovery: this.recovery(parameters), capabilities: this.capabilities() };
  }

  #readModelConfig(result) {
    if (!Array.isArray(result?.configOptions)) return;
    this.configOptions = result.configOptions;
    const config = result.configOptions.find(option => option.category === 'model' || option.id === 'model');
    if (!config || config.type && config.type !== 'select' || typeof config.id !== 'string' || typeof config.currentValue !== 'string') {
      this.modelConfig = null;
      this.configOptions = [];
      this.parameterized = false;
      return;
    }
    // Cursor has no explicit server acknowledgement for its picker extension.
    // Its parameterized model descriptor also identifies support when Auto has no parameters.
    this.parameterized ||= config.description === 'Controls which model is used for responses' || result.configOptions.some(option => ['thought_level', 'model_config'].includes(option.category));
    const models = selectValues(config).map(option => ({
      id: option.value, reference: option.value, displayName: option.name || option.value,
      description: option.description ?? null,
    }));
    // The directory describes choices, not subscription entitlements.
    this.modelConfig = models.length ? { id: config.id, current: config.currentValue, models } : null;
  }

  async #setModel(reference) {
    const config = this.modelConfig;
    if (!config) throw pluginError('unsupported', 'Cursor did not provide model configuration');
    if (typeof reference !== 'string' || !config.models.some(model => model.reference === reference)) throw pluginError('invalid_input', 'Cursor model is not in the session catalog');
    if (config.current === reference) return;
    const transport = this.transport, sessionId = this.sessionId;
    const result = await transport.request('session/set_config_option', { sessionId, configId: config.id, value: reference });
    if (this.transport !== transport || this.sessionId !== sessionId || transport.closed) throw pluginError('invalid_session', 'Cursor session changed during model selection');
    this.#readModelConfig(result);
    if (!Array.isArray(result?.configOptions) || this.modelConfig?.current !== reference) throw pluginError('invalid_output', 'Cursor did not confirm the requested model');
  }

  snapshot() { return { nativeSessionId: this.sessionId, recovery: this.recovery(), capabilities: this.capabilities() }; }
  recovery(parameters = this.parameters()) {
    return { schema: RECOVERY_SCHEMA, version: 1, data: { nativeSessionId: this.sessionId, workspaceId: this.workspaceId, workspacePath: this.workspacePath, protocolVersion: 1, modeId: this.modeId, hostMcpServerName: this.hostMcpServerName, hasPrompt: this.hasPrompt, ...(this.modelConfig ? { modelId: this.modelConfig.current, reasoningEffort: parameters.current, contextWindow: parameters.context?.currentValue ?? null } : {}) } };
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
    this.commandCatalog = null;
    this.earlyCommands.clear();
    for (const done of this.commandWaiters) done();
    this.pendingInteractions.clear();
    this.phase = 'stopped';
    this.hostMcpTools=[];
    this.hostPermissionReplies.clear();
    this.sessionId = null;
    this.modelConfig = null;
    this.configOptions = [];
    this.parameterized = false;
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
      this.#readModelConfig(changed);
      const updated = changed?.configOptions?.find(option => option.id === 'mode')?.currentValue;
      if (updated !== expected) throw pluginError('invalid_output', 'Cursor did not confirm the requested mode');
    }
  }

  #validateRecovery(value, workspaceId, workspacePath) {
    const recovery = object(value);
    const data = object(recovery.data);
    if (recovery.schema !== RECOVERY_SCHEMA || recovery.version !== 1 || typeof data.nativeSessionId !== 'string' || !data.nativeSessionId) throw pluginError('invalid_input', 'Invalid Cursor recovery data');
    if (data.workspaceId !== workspaceId || data.workspacePath !== workspacePath) throw pluginError('permission_denied', 'Cursor recovery belongs to another workspace');
    if (data.hasPrompt !== undefined && typeof data.hasPrompt !== 'boolean') throw pluginError('invalid_input', 'Invalid Cursor prompt recovery state');
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
      // Only native structured metadata correlated with this turn can identify
      // the private, randomly named host bridge. Display titles grant nothing.
      const toolCallId=params.toolCall?.toolCallId;
      const tool=this.tools.get(toolCallId);
      const raw=tool?.rawInput;
      const hostRead=this.phase==='prompting' && params.sessionId===this.sessionId
        && tool?.kind==='other' && !this.completedTools.has(toolCallId)
        && this.hostMcpTools?.some(allowed=>raw?.providerIdentifier===allowed.providerIdentifier && raw?.toolName===allowed.toolName);
      if(hostRead){
        const allowed=options.find(option=>option.kind==='allow_once');
        const fresh=!this.hostPermissionReplies.has(requestId);
        this.hostPermissionReplies.add(requestId);
        this.transport.respond(message.id,allowed&&fresh?{outcome:{outcome:'selected',optionId:allowed.optionId}}:{outcome:{outcome:'cancelled'}});
        return true;
      }
      if (this.modeId !== 'agent' || this.profile.approvalReviewer !== 'user') {
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
      for (const done of this.commandWaiters) done();
      if (this.turnId) this.#event('adapter.crashed', { message: message.params?.message ?? 'Cursor ACP exited' });
      return;
    }
    if (message.method === 'cursor/task') {
      if (!this.turnId) return;
      const params = object(message.params);
      const subagent = this.subagents.get(params.toolCallId);
      if (!subagent) return;
      const completed = Number.isFinite(params.durationMs);
      this.#updateSubagent(subagent, {
        name: subagentName(params.subagentType ?? subagent.subagentType),
        task: params.prompt || subagent.task,
        status: completed ? 'completed' : 'unavailable',
        activity: completed ? `Completed${params.durationMs > 0 ? ` in ${params.durationMs} ms` : ''}.` : 'Cursor did not expose a successful task result.',
      });
      return;
    }
    if (['cursor/update_todos', 'cursor/generate_image'].includes(message.method)) {
      if (this.turnId) this.#event('extension.updated', { namespace: 'dev.aibo.cursor', kind: message.method.slice('cursor/'.length), ...object(message.params) });
      return;
    }
    if (message.method === 'session/update' && message.params?.update?.sessionUpdate === 'available_commands_update') {
      const { sessionId, update } = message.params;
      if (sessionId === this.sessionId && this.sessionId) this.#readCommands(update.availableCommands);
      else if (['opening', 'loading'].includes(this.phase) && typeof sessionId === 'string' && Array.isArray(update.availableCommands) && this.earlyCommands.size < 16) {
        this.earlyCommands.set(sessionId, update.availableCommands.slice(0, 512));
      }
      return;
    }
    if (message.method === 'session/update' && this.phase !== 'loading' && message.params?.sessionId === this.sessionId && message.params?.update?.sessionUpdate === 'config_option_update') {
      this.#readModelConfig(message.params.update);
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
      if (update.rawInput?._toolName === 'task') {
        const subagent = {
          id: update.toolCallId,
          parentId: this.sessionId,
          rootTurnId: this.turnId,
          name: subagentName(update.rawInput.subagentType),
          task: update.rawInput.prompt || update.rawInput.description || update.title || 'Cursor task',
          status: 'running',
          activity: update.rawInput.description || 'Running Cursor subagent task.',
          subagentType: update.rawInput.subagentType,
        };
        this.subagents.set(update.toolCallId, subagent);
        this.#updateSubagent(subagent);
        return;
      }
      this.#event('tool.started', toolPayload(update, { status: 'pending' }), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      if (['completed', 'failed'].includes(update.status)) {
        this.completedTools.add(update.toolCallId);
        this.#event('tool.completed', toolPayload(update), { itemId: update.toolCallId, toolCallId: update.toolCallId });
      }
      return;
    }
    if (update.sessionUpdate === 'tool_call_update') {
      const subagent = this.subagents.get(update.toolCallId);
      if (subagent) {
        if (update.status === 'failed') this.#updateSubagent(subagent, { status: 'failed', activity: bounded(update.rawOutput ?? update.content) || 'Cursor subagent task failed.' });
        else if (update.status === 'completed') this.#updateSubagent(subagent, { status: 'waiting', activity: 'Waiting for Cursor task details.' });
        return;
      }
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

  #updateSubagent(subagent, changes = {}) {
    Object.assign(subagent, changes);
    const { id, parentId, rootTurnId, name, task, status, activity } = subagent;
    this.emit({ nativeSessionId: this.sessionId, turnId: null, type: 'subagent.updated', correlation: { itemId: id, toolCallId: id }, payload: { id, parentId, rootTurnId, name, task, status, activity } });
  }

  #finishSubagents(status, activity) {
    for (const subagent of this.subagents.values()) {
      if (!['completed', 'failed', 'interrupted', 'unavailable'].includes(subagent.status)) this.#updateSubagent(subagent, { status, activity });
    }
  }
}
