// Packaged ACP + host Node + a controlled external CLI. No login or model prompts.
import assert from 'node:assert/strict';
import { readFile, readdir, mkdtemp, mkdir, writeFile, chmod, rm } from 'node:fs/promises';
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { aiboRoot } from './host-sdk.mjs';

const packagePath = path.resolve(process.argv[2]);
const node = path.join(aiboRoot, 'src-tauri/resources/node-runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const manifest = JSON.parse(await readFile(path.join(packagePath, 'plugin.json')));
const config = JSON.parse(await readFile(path.join(packagePath, 'acp.json')));
assert.ok(manifest.executableDependencies.some(item => item.name === 'claude' && item.required));
const entries = await readdir(path.join(packagePath, 'vendor/node_modules/@anthropic-ai'));
assert.ok(!entries.some(name => /^claude-agent-sdk-(darwin|linux|win32)-/.test(name)), 'no bundled native SDK packages');
const { JsonlProcess } = await import(pathToFileURL(path.join(aiboRoot, 'probes/lib/jsonl-process.mjs')));
const worker = new JsonlProcess(node, ['--import', pathToFileURL(path.join(aiboRoot, 'packages/plugin-host/register.mjs')).href,
  path.join(packagePath, 'worker.mjs')], { cwd: path.dirname(packagePath), env: { PATH: '' } }).start();
try {
  const reply = await worker.requestMessage({ jsonrpc: '2.0', method: 'capability.initialize', params: {
    protocol: '2.1', instanceId: 'smoke', generationId: 'smoke', installationId: 'smoke',
    pluginId: manifest.pluginId, pluginVersion: manifest.version, contributionId: manifest.contributions[0].id,
    privateData: { path: packagePath, formatVersion: 1 },
  } });
  assert.equal(reply.result.pluginVersion, manifest.version);
} finally { await worker.close(); }
const launcher = path.join(packagePath, config.launch.entry);
assert.throws(() => execFileSync(node, [launcher, '--cli', '--version'], { env: { PATH: '' }, encoding: 'utf8', stdio: 'pipe', timeout: 30_000 }),
  error => error.status === 1 && error.stdout === '' && /未找到 Claude Code/.test(error.stderr), 'missing CLI reports installation guidance without a bundled fallback');
const root = await mkdtemp(path.join(tmpdir(), 'aibo-external-claude '));
try {
  const bin = path.join(root, 'bin with spaces');
  await mkdir(bin);
  await writeFile(path.join(bin, 'claude'), '#!/bin/sh\nprintf "AIBO_EXTERNAL_CLAUDE_OK\\n"\n');
  await chmod(path.join(bin, 'claude'), 0o755);
  const env = { PATH: bin, CLAUDE_CODE_EXECUTABLE: '/must-not-use-inherited-override' };
  assert.equal(execFileSync(node, [launcher, '--cli', '--version'], { env, encoding: 'utf8', timeout: 30_000 }).trim(), 'AIBO_EXTERNAL_CLAUDE_OK');
  const { AcpTransport } = await import(pathToFileURL(path.join(aiboRoot, 'packages/acp-adapter/transport.mjs')));
  const transport = new AcpTransport({ command: node, args: [launcher], cwd: root,
    spawnProcess: (command, args, options) => spawn(command, args, { ...options, env }) }).start();
  try {
    const response = await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'aibo-package-smoke', version: '1.0.0' } });
    assert.equal(response.protocolVersion, 1);
  } finally { await transport.close(); }
} finally { await rm(root, { recursive: true, force: true }); }
console.log(JSON.stringify({ ok: true, privateNode: true, worker: manifest.version, bundledNativeCli: false, externalCliDelegation: true, missingCliGuidance: true, acpInitialize: true }));
