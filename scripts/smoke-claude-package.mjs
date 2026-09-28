// Real packaged ACP + native CLI, with no global executables. Does not send model prompts.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { aiboRoot } from './host-sdk.mjs';

const packagePath = path.resolve(process.argv[2]);
const node = path.join(aiboRoot, 'src-tauri/resources/node-runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const manifest = JSON.parse(await readFile(path.join(packagePath, 'plugin.json')));
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
const adapter = path.join(packagePath, 'vendor/node_modules/@agentclientprotocol/claude-agent-acp/dist');
const { AcpTransport } = await import(pathToFileURL(path.join(aiboRoot, 'packages/acp-adapter/transport.mjs')));
// Direct child explicitly inherits no PATH, matching the Worker package launch.
const { spawn } = await import('node:child_process');
const transport = new AcpTransport({ command: node, args: [path.join(adapter, 'index.js')], cwd: path.dirname(packagePath),
  spawnProcess: (command, args, options) => spawn(command, args, { ...options, env: { PATH: '' } }) }).start();
try {
  const response = await transport.request('initialize', { protocolVersion: 1, clientCapabilities: {}, clientInfo: { name: 'aibo-package-smoke', version: '1.0.0' } });
  assert.equal(response.protocolVersion, 1);
} finally { await transport.close(); }
const script = `import {claudeCliPath} from ${JSON.stringify(pathToFileURL(path.join(adapter, 'acp-agent.js')).href)};
  import {execFileSync} from 'node:child_process';
  const binary = await claudeCliPath();
  if (!binary.startsWith(${JSON.stringify(packagePath + path.sep)})) throw Error('CLI escaped package');
  console.log(execFileSync(binary, ['--version'], {encoding:'utf8'}).trim());`;
const version = execFileSync(node, ['--input-type=module', '-e', script], { env: { PATH: '' }, encoding: 'utf8', timeout: 30_000 }).trim();
assert.match(version, /2\.1\.280/);
console.log(JSON.stringify({ ok: true, privateNode: true, emptyPath: true, worker: manifest.version, acpInitialize: true, nativeCli: version }));
