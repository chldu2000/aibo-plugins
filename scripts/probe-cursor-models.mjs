import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CursorSession } from '../plugins/cursor/cursor-session.mjs';

const workspacePath = await mkdtemp(path.join(tmpdir(), 'aibo-cursor-models-'));
const profile = { schema: 'aibo.execution-profile/v1', interactionMode: 'ask', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'agent-managed', model: null, reasoningEffort: null };
const open = { workspaceId: 'model-probe', workspacePath, executionProfile: profile, permissions: ['workspace.read'] };
const events = [];
let session = new CursorSession({ emit: event => events.push(event) }), original;
try {
  const opened = await session.open({ ...open, mode: 'create' });
  assert.ok(opened.capabilities.includes('model.select'));
  const catalog = await session.models({ action: 'list' });
  original = catalog.current;
  const auto = catalog.models.find(model => model.reference === 'auto' || model.displayName.toLowerCase() === 'auto');
  assert.ok(auto, 'Cursor must return its real Auto option');
  // Exercise the setter even when Auto is already current by selecting a different
  // catalog entry first. No model prompt is sent until Auto has been confirmed.
  const other = catalog.models.find(model => model.reference !== auto.reference);
  if (other) await session.models({ action: 'set', reference: other.reference });
  assert.equal((await session.models({ action: 'set', reference: auto.reference })).current, auto.reference);
  let promptStatus = 'not-requested';
  const timeout = setTimeout(() => { void session.close(); }, 90_000);
  timeout.unref();
  if (process.argv.includes('--prompt')) {
    promptStatus = (await session.prompt({ text: 'Reply with exactly: AIBO_AUTO_OK', turnId: 'auto-probe' })).status;
    assert.equal(promptStatus, 'completed');
    const text = events.filter(event => event.type === 'message.completed').map(event => event.payload.text).join('');
    assert.equal(text.trim(), 'AIBO_AUTO_OK', 'Auto must return the expected reply, not a completed error message');
  }
  clearTimeout(timeout);
  const recovery = session.recovery();
  await session.close();
  session = new CursorSession();
  await session.open({ ...open, mode: 'resume', recovery });
  const resumed = await session.models({ action: 'list' });
  assert.equal(resumed.current, auto.reference);
  console.log(JSON.stringify({ ok: true, modelCount: catalog.models.length, auto: auto.reference, selected: resumed.current, switched: Boolean(other), resumed: true, promptStatus }));
} finally {
  try { if (original && session.phase === 'ready') await session.models({ action: 'set', reference: original }); }
  finally { await session.close(); await rm(workspacePath, { recursive: true, force: true }); }
}
