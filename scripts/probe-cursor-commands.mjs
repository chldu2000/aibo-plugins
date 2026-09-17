import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CursorSession } from '../plugins/cursor/cursor-session.mjs';

const workspacePath = await mkdtemp(path.join(tmpdir(), 'aibo-cursor-commands-'));
const events = [];
const session = new CursorSession({ emit: event => events.push(event) });
const timeout = setTimeout(() => { void session.close(); }, 90_000);
timeout.unref();
try {
  await mkdir(path.join(workspacePath, '.cursor', 'commands'), { recursive: true });
  await writeFile(path.join(workspacePath, '.cursor', 'commands', 'aibo-menu-probe.md'), 'Inspect the current workspace and summarize its files.');
  const opened = await session.open({ mode: 'create', workspaceId: 'command-probe', workspacePath, permissions: ['workspace.read'], executionProfile: {
    schema: 'aibo.execution-profile/v1', interactionMode: 'ask', approvalPolicy: 'never', approvalReviewer: 'none', filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'disabled', model: null, reasoningEffort: null,
  } });
  assert.ok(opened.capabilities.includes('command.list'));
  const { commands } = await session.commands();
  assert.ok(commands.some(command => command.name === 'copy-request-id'));
  assert.ok(commands.some(command => command.name === 'aibo-menu-probe'));
  // On a new session this native utility returns a local diagnostic, without
  // sending a model prompt or copying an existing request ID to the clipboard.
  const result = await session.prompt({ text: '/copy-request-id', turnId: 'native-command', additionalInstructions: 'This must not prefix the native command.' });
  assert.equal(result.status, 'completed');
  const text = events.filter(event => event.type === 'message.completed').map(event => event.payload.text).join('');
  assert.match(text, /No request ID found/);
  console.log(JSON.stringify({ ok: true, commandCount: commands.length, builtinListed: true, workspaceCommandListed: true, nativeCommandExecuted: true }));
} finally {
  clearTimeout(timeout);
  await session.close(); await rm(workspacePath, { recursive: true, force: true });
}
