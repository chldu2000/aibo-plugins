import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CursorSession } from '../plugins/cursor/cursor-session.mjs';

const workspacePath = await mkdtemp(path.join(tmpdir(), 'aibo-cursor-parameters-'));
const executionProfile = { schema: 'aibo.execution-profile/v1', interactionMode: 'ask', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'agent-managed', model: null, reasoningEffort: null };
const open = { workspaceId: 'parameter-probe', workspacePath, executionProfile, permissions: ['workspace.read'] };
const events = [];
const createSession = () => new CursorSession({ emit: event => events.push(event) });
let session = createSession();
const timeout = setTimeout(() => { void session.close(); }, 300_000);
timeout.unref();
const evidence = [];
try {
  await session.open({ ...open, mode: 'create' });
  const auto = (await session.models({ action: 'list' })).models.find(model => model.displayName.toLowerCase() === 'auto');
  assert.ok(auto);
  await session.models({ action: 'set', reference: auto.reference });
  assert.equal((await session.prompt({ text: 'Reply with exactly AIBO_PARAMETER_PROBE_OK', turnId: 'seed' })).status, 'completed');
  assert.equal(events.filter(event => event.type === 'message.completed').map(event => event.payload.text).join('').trim(), 'AIBO_PARAMETER_PROBE_OK');
  console.error('Auto conversation saved; checking parameter selection and recovery.');
  for (const reference of ['gpt-5.5', 'claude-sonnet-4-6']) {
    const catalog = await session.models({ action: 'set', reference });
    const model = catalog.models.find(model => model.reference === reference);
    assert.ok(model.reasoningEfforts.length > 1);
    assert.ok(model.contextWindows.length > 1);
    const level = model.reasoningEfforts.at(-1).id;
    const contextWindow = model.contextWindows.at(-1).id;
    await session.configure('reasoning', { action: 'set', level });
    await session.configure('context', { action: 'set', contextWindow });
    assert.equal((await session.configure('reasoning', { action: 'list' })).current, level);
    const recovery = session.recovery();
    await session.close(); session = createSession();
    await session.open({ ...open, mode: 'resume', recovery });
    assert.equal((await session.models({ action: 'list' })).currentContextWindow, contextWindow);
    assert.equal((await session.configure('reasoning', { action: 'list' })).current, level);
    console.error(`${reference}: parameter selection and cross-process recovery passed.`);
    evidence.push({ model: reference, levels: model.reasoningEfforts.map(level => level.label), contexts: model.contextWindows, switched: true, resumed: true });
  }
  console.log(JSON.stringify({ ok: true, evidence }));
} finally {
  clearTimeout(timeout);
  await session.close(); await rm(workspacePath, { recursive: true, force: true });
}
