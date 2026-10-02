import { AcpSession, BASE_CAPABILITIES, object, pluginError } from '@aibolabs/acp-adapter/session';

// The generic ACP session lives in the host SDK; this module keeps only Cursor behaviour.
export const CAPABILITIES = [...BASE_CAPABILITIES, 'user-input.respond'];

const MODE_BY_INTERACTION = { ask: 'ask', plan: 'plan', edit: 'agent' };

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

const NAMESPACE = 'dev.aibo.cursor';

/** Cursor-specific behaviour on top of the generic ACP session. */
export const cursorExtension = {
  capabilities: CAPABILITIES,
  label: 'Cursor',
  command: 'agent',
  args: ['acp'],
  clientName: 'aibo-cursor',
  clientMeta: { parameterizedModelPicker: true },
  // Cursor's picker extension exposes parameters per model, so both are claimed up front.
  parameterizedPicker: true,
  parameterScope: 'current-model',
  authMethodId: 'cursor_login',
  recoverySchema: 'dev.aibo.cursor.recovery',
  namespace: NAMESPACE,
  requestPrefix: 'cursor',
  writableMode: 'agent',
  // Cursor does not persist a newly-created session until it receives a prompt.
  persistsEmptySessions: false,
  validateExecutionProfile,
  // Cursor ACP currently encodes skill origins in description suffixes,
  // rather than a structured type field. Keep unknown commands as agent
  // commands; mentioning "skill" elsewhere is not a classification signal.
  commandCategory: command => typeof command.description === 'string' && /\((?:builtin|project|user) skill\)$/.test(command.description) ? 'skill' : 'agent',
  // Cursor has no explicit server acknowledgement for its picker extension.
  // Its parameterized model descriptor also identifies support when Auto has no parameters.
  parameterized: (config, result) => config.description === 'Controls which model is used for responses' || result.configOptions.some(option => ['thought_level', 'model_config'].includes(option.category)),
  subagentFromTool(update) {
    if (update.rawInput?._toolName !== 'task') return null;
    return {
      name: subagentName(update.rawInput.subagentType),
      task: update.rawInput.prompt || update.rawInput.description || update.title || 'Cursor task',
      activity: update.rawInput.description || 'Running Cursor subagent task.',
      subagentType: update.rawInput.subagentType,
    };
  },
  handleRequest(session, message, params, requestId) {
    if (message.method === 'cursor/ask_question') {
      const questions = Array.isArray(params.questions) ? params.questions : [];
      const answer = answers => {
        const response = [];
        for (const question of questions) {
          const selected = Array.isArray(answers?.[question.id]) ? answers[question.id] : [answers?.[question.id]].filter(Boolean);
          // The host's question UI submits display labels. Keep native IDs accepted for
          // existing API consumers, but never guess if a label and another ID collide.
          const selectedOptionIds = selected.map(value => {
            const matches = question.options.filter(option => option.id === value || option.label === value);
            if (matches.length !== 1) throw pluginError('invalid_input', 'Cursor question answer contains an invalid option');
            return matches[0].id;
          });
          if (!question.allowMultiple && selectedOptionIds.length > 1) throw pluginError('invalid_input', 'Cursor question answer contains an invalid option');
          response.push({ questionId: question.id, selectedOptionIds });
        }
        return { outcome: { outcome: 'answered', answers: response } };
      };
      if (!session.await(requestId, message.id, { kind: 'question', questions, answer })) return true;
      session.event('user_input.requested', { requestId, title: params.title ?? null,
        questions: questions.map(question => ({ ...question, question: question.prompt ?? question.question, isOther: false })),
      }, { requestId, toolCallId: params.toolCallId ?? null });
      return true;
    }
    if (message.method === 'cursor/create_plan') {
      const approve = decision => ({ outcome: decision === 'accept' ? { outcome: 'accepted' } : { outcome: 'rejected' } });
      if (!session.await(requestId, message.id, { kind: 'plan', approve })) return true;
      session.event('extension.updated', { namespace: NAMESPACE, kind: 'plan', requestId, plan: params.plan ?? '', todos: params.todos ?? [] }, { requestId, toolCallId: params.toolCallId ?? null });
      session.event('approval.requested', { requestId, kind: 'plan', command: params.name ?? 'Cursor plan', description: params.plan ?? '', availableDecisions: ['accept', 'cancel'] }, { requestId, toolCallId: params.toolCallId ?? null, approvalId: message.id });
      return true;
    }
    return false;
  },
  handleNotification(session, message) {
    if (message.method === 'cursor/task') {
      if (!session.turnId) return true;
      const params = object(message.params);
      const subagent = session.subagents.get(params.toolCallId);
      if (!subagent) return true;
      const completed = Number.isFinite(params.durationMs);
      session.updateSubagent(subagent, {
        name: subagentName(params.subagentType ?? subagent.subagentType),
        task: params.prompt || subagent.task,
        status: completed ? 'completed' : 'unavailable',
        activity: completed ? `Completed${params.durationMs > 0 ? ` in ${params.durationMs} ms` : ''}.` : 'Cursor did not expose a successful task result.',
      });
      return true;
    }
    if (['cursor/update_todos', 'cursor/generate_image'].includes(message.method)) {
      if (session.turnId) session.event('extension.updated', { namespace: NAMESPACE, kind: message.method.slice('cursor/'.length), ...object(message.params) });
      return true;
    }
    return false;
  },
};

export class CursorSession extends AcpSession {
  constructor(options = {}) { super({ ...options, extension: cursorExtension }); }
}
