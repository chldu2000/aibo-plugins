import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, chmod, symlink, realpath, rm } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { resolveClaudeExecutable } from '../plugins/claude-code/launch-acp.mjs';

test('Claude launcher resolves an executable from host PATH, following native-install symlinks and skipping invalid entries', async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'aibo-claude-launcher '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const invalid = path.join(root, 'invalid'), valid = path.join(root, 'valid with spaces');
  await mkdir(invalid); await mkdir(valid);
  await writeFile(path.join(invalid, 'claude'), 'not executable');
  const binary = path.join(root, 'native executable');
  await writeFile(binary, '#!/bin/sh\nexit 0\n'); await chmod(binary, 0o755);
  await symlink(binary, path.join(valid, 'claude'));
  assert.equal(resolveClaudeExecutable([invalid, valid].join(path.delimiter)), await realpath(binary));
  await rm(path.join(invalid, 'claude')); await mkdir(path.join(invalid, 'claude'));
  assert.equal(resolveClaudeExecutable([invalid, valid].join(path.delimiter)), await realpath(binary));
  assert.throws(() => resolveClaudeExecutable([invalid, '', '.', 'relative'].join(path.delimiter)), /未找到 Claude Code/);
  assert.throws(() => resolveClaudeExecutable(''), /先安装并登录 Claude Code/);
});
