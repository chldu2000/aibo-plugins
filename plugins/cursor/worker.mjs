import { readFileSync } from 'node:fs';
import { serveCapability } from '@aibo/capability-runtime/stdio';
import { CursorSession, additionalInstructionsFromSettings } from './cursor-session.mjs';

const manifest = JSON.parse(readFileSync(new URL('./plugin.json', import.meta.url), 'utf8'));
const contribution = manifest.contributions[0];
let owner;
const session = new CursorSession({ pluginVersion: manifest.version, emit(event) { owner?.tools.emit(event); } });

function inputOf(request) {
  if (!request.input || typeof request.input !== 'object' || Array.isArray(request.input)) throw Object.assign(new Error('Object input required'), { kind: 'invalid_input' });
  return request.input;
}

function contextOf(request) {
  const context = request.context;
  if (request.scope?.kind !== 'session' || typeof request.scope.id !== 'string' || !request.scope.id || typeof context?.workspaceId !== 'string' || !context.workspaceId || typeof context.workspacePath !== 'string' || !context.workspacePath || !Array.isArray(context.permissions) || !context.permissions.includes('workspace.read')) {
    throw Object.assign(new Error('Cursor requires a trusted session workspace'), { kind: 'permission_denied' });
  }
  return context;
}

async function commandDirectory() {
  const output = await session.commands();
  return { ...output, recovery: session.recovery(), capabilities: session.capabilities(),
    commands: output.commands.map(command => ({ ...command, insertionText: `/${command.name} ` })),
  };
}

async function invoke(request, tools) {
  if (owner) throw Object.assign(new Error('Cursor session invocation already running'), { kind: 'busy' });
  owner = { request, tools };
  const context = contextOf(request);
  const input = inputOf(request);
  const abort = () => { if (request.capability === 'aibo.session.turn' || request.capability === 'aibo.session.turn.write') void session.cancel(); };
  tools.signal.addEventListener('abort', abort, { once: true });
  try {
    if (request.capability === 'aibo.session.open') {
      return await session.open({ mode: input.mode, workspaceId: context.workspaceId, workspacePath: context.workspacePath, executionProfile: input.executionProfile, recovery: input.recovery, permissions: context.permissions });
    }
    if (request.capability === 'dev.aibo.cursor.command.list') return await commandDirectory();
    if (request.capability === 'dev.aibo.cursor.model.reasoning') return await session.configure('reasoning', input);
    if (request.capability === 'dev.aibo.cursor.model.context-window') return await session.configure('context', input);
    if (request.capability === 'dev.aibo.cursor.model.select') return await session.models(input);
    if (request.capability === 'aibo.session.close') return await session.close();
    if (request.capability === 'aibo.session.turn' || request.capability === 'aibo.session.turn.write') {
      if (!context.turnId || typeof input.text !== 'string' || !input.text.trim()) throw Object.assign(new Error('Cursor turn requires text and turn identity'), { kind: 'invalid_input' });
      if (request.capability.endsWith('.write') && !context.permissions.includes('workspace.write')) throw Object.assign(new Error('Cursor write turn requires workspace.write'), { kind: 'permission_denied' });
      const writable = request.capability.endsWith('.write');
      const instructions = additionalInstructionsFromSettings(context.settings);
      return await session.prompt({ text: input.text, attachments: input.attachments, turnId: context.turnId, additionalInstructions: instructions, writable });
    }
    throw Object.assign(new Error('Unsupported Cursor capability'), { kind: 'unsupported' });
  } finally {
    tools.signal.removeEventListener('abort', abort);
    owner = undefined;
  }
}

async function control(request, { invocation }) {
  if (!owner || owner.request.invocationId !== invocation.invocationId) throw Object.assign(new Error('No matching Cursor invocation'), { kind: 'invalid_input' });
  const input = inputOf(request);
  if (request.capability === 'dev.aibo.cursor.command.list') return await commandDirectory();
  if (request.capability.startsWith('dev.aibo.cursor.model.')) throw Object.assign(new Error('Cursor model configuration requires an idle session'), { kind: 'busy' });
  if (request.capability === 'aibo.session.cancel') return session.cancel();
  if (request.capability === 'dev.aibo.cursor.approval.respond') return session.respondApproval(input.requestId, input.decision);
  if (request.capability === 'dev.aibo.cursor.user-input.respond') return session.respondUserInput(input.requestId, input.answers);
  throw Object.assign(new Error('Unsupported Cursor control'), { kind: 'unsupported' });
}

serveCapability({
  protocol: '2.1', pluginId: manifest.pluginId, pluginVersion: manifest.version, contributionId: contribution.id,
  operations: contribution.operations.map(operation => ({ capability: operation.capability.id, version: operation.capability.version, operationId: operation.id })),
  invoke, control,
});

process.stdin.on('end', () => void session.close());
