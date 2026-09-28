// Real Claude Code through the configuration-only plugin: plugin.json + acp.json on the host SDK worker.
// Uses a packaged ACP adapter, host private Node and the locally installed Claude CLI and login.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { aiboRoot } from './host-sdk.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
if (!process.env.CLAUDE_PLUGIN_PATH) throw Error('Set CLAUDE_PLUGIN_PATH to the built claude-code package directory');
const pluginPath = path.resolve(process.env.CLAUDE_PLUGIN_PATH);
const runtimeNode = path.join(aiboRoot, 'src-tauri/resources/node-runtime', process.platform === 'win32' ? 'node.exe' : 'node');
const manifest = JSON.parse(await readFile(path.join(pluginPath, 'plugin.json'), 'utf8'));
const contribution = manifest.contributions[0];
const root = await mkdtemp(path.join(tmpdir(), 'aibo-claude-code-probe-'));
const workspacePath = path.join(root, 'workspace');
execFileSync('mkdir', ['-p', workspacePath]);
const { resolveClaudeExecutable } = await import(pathToFileURL(path.join(pluginPath, 'launch-acp.mjs')));
const claudeExecutable = resolveClaudeExecutable();
const claudeVersion = execFileSync(claudeExecutable, ['--version'], { encoding: 'utf8', timeout: 30_000 }).trim();
const adapterVersion = JSON.parse(await readFile(path.join(pluginPath, 'vendor/node_modules/@agentclientprotocol/claude-agent-acp/package.json'), 'utf8')).version;

function worker(generation) {
  const child = spawn(runtimeNode, ['--import', pathToFileURL(path.join(aiboRoot, 'packages/plugin-host/register.mjs')).href, path.join(pluginPath, 'worker.mjs')],
    { cwd: root, env: { ...process.env, PATH: `${path.dirname(runtimeNode)}${path.delimiter}${path.dirname(claudeExecutable)}${path.delimiter}${process.env.PATH ?? ''}` }, stdio: ['pipe', 'pipe', 'pipe'] });
  let nextId = 0, stderr = '';
  const pending = new Map(), events = [], listeners = new Set();
  child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-8000); });
  createInterface({ input: child.stdout }).on('line', line => {
    const message = JSON.parse(line);
    if (message.method === 'capability.event') { events.push(message.params); for (const listener of listeners) listener(message.params); return; }
    const waiter = pending.get(message.id); if (!waiter) return; pending.delete(message.id);
    message.error ? waiter.reject(new Error(`${message.error.message}\n${stderr}`)) : waiter.resolve(message.result);
  });
  const rpc = (method, params) => new Promise((resolve, reject) => { const id = nextId++; pending.set(id, { resolve, reject }); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const identity = { instanceId: 'probe', generationId: `probe-${generation}`, contributionId: contribution.id };
  const operation = capability => contribution.operations.find(op => op.capability.id === capability);
  let counter = 0;
  const request = (capability, input, turnId = null, permissions = ['workspace.read']) => ({ ...identity, invocationId: `${generation}-${++counter}`, capability, contractVersion: '1.0.0', operationId: operation(capability).id,
    deadlineUnixMs: Date.now() + 600_000, scope: { kind: 'session', id: 'probe-session' },
    context: { turnId, workspaceId: 'probe-workspace', workspacePath, originalCaller: { kind: 'window', id: 'probe' }, permissions, callChain: [] }, input });
  const invoke = async (capability, input, turnId, permissions) => (await rpc('capability.invoke', request(capability, input, turnId, permissions))).output;
  const control = (invocationId, capability, input) => rpc('capability.control', { ...identity, invocationId, capability, contractVersion: '1.0.0', operationId: operation(capability).id, input });
  return { child, rpc, events, listeners, request, invoke, control, identity,
    init: () => rpc('capability.initialize', { ...identity, protocol: '2.1', pluginId: manifest.pluginId, pluginVersion: manifest.version, installationId: 'probe', privateData: { path: root, formatVersion: 1 } }),
    close: () => new Promise(resolve => { child.once('exit', resolve); child.stdin.end(); setTimeout(() => child.kill('SIGTERM'), 5000).unref(); }) };
}
const profile = mode => mode === 'plan'
  ? { schema: 'aibo.execution-profile/v1', interactionMode: 'plan', filesystemPolicy: 'read-only', commandPolicy: 'disabled', networkPolicy: 'agent-managed', approvalPolicy: 'never', approvalReviewer: 'none', model: null, reasoningEffort: null }
  : { schema: 'aibo.execution-profile/v1', interactionMode: 'edit', filesystemPolicy: 'agent-managed', commandPolicy: 'agent-managed', networkPolicy: 'agent-managed', approvalPolicy: 'on-request', approvalReviewer: 'user', model: null, reasoningEffort: null };
const text = w => w.events.filter(entry => entry.event.type === 'message.completed').map(entry => entry.event.payload.text).join('\n');
const feature = name => `${manifest.pluginId}.${name}`;
const result = { ok: false, adapterVersion, claudeCode: claudeVersion, externalClaude: true, checks: [] };
try {
  const first = worker(1);
  assert.equal((await first.init()).protocol, '2.1');
  const planned = await first.invoke('aibo.session.open', { mode: 'create', executionProfile: profile('plan'), recovery: null });
  result.capabilities = planned.capabilities;
  for (const expected of ['session.create', 'turn.send', 'approval.respond', 'command.list', 'user-input.respond']) assert.ok(planned.capabilities.includes(expected), expected);
  result.checks.push('plan session opens through acp.json; capabilities narrowed by the native handshake');
  result.commands = (await first.invoke(feature('command.list'), { action: 'get' })).commands.length;
  if (planned.capabilities.includes('model.select')) {
    const models = await first.invoke(feature('model.select'), { action: 'list' });
    assert.equal(models.parameterScope, 'current-model');
    result.models = { count: models.models.length, current: models.current, parameterScope: models.parameterScope };
  }
  if (planned.capabilities.includes('model.reasoning')) result.reasoningLevels = (await first.invoke(feature('model.reasoning'), { action: 'list' })).levels.length;
  if (planned.capabilities.includes('model.context-window')) result.contextWindows = (await first.invoke(feature('model.context-window'), { action: 'list' })).contextWindows.length;
  result.checks.push(`command directory (${result.commands}) and model catalog read`);
  // PROBE_CONFIG_ONLY=1 stops before any prompt, so it spends no model usage.
  if (process.env.PROBE_CONFIG_ONLY === '1') {
    const original = await first.invoke(feature('model.select'), { action: 'list' });
    const other = original.models.find(model => model.reference !== original.current);
    if (other) {
      const selected = await first.invoke(feature('model.select'), { action: 'set', reference: other.reference });
      assert.equal(selected.current, other.reference);
      assert.equal(selected.parameterScope, 'current-model');
      assert.ok(selected.models.filter(model => model.reference !== selected.current).every(model => model.reasoningEfforts.length === 0));
      const restored = await first.invoke(feature('model.select'), { action: 'set', reference: original.current });
      assert.equal(restored.current, original.current);
      result.checks.push('current-model scope survives real model switches and parameter options remain isolated');
    }
    result.ok = true; await first.close(); throw null;
  }
  assert.equal((await first.invoke('aibo.session.turn', { text: 'Reply with exactly: AIBO_CLAUDE_OK' }, 'plan-turn')).status, 'completed');
  assert.match(text(first), /AIBO_CLAUDE_OK/);
  result.checks.push('plan turn streams the requested reply');
  // AskUserQuestion arrives as an ACP form elicitation and is answered through the host question.
  const questions = [];
  first.listeners.add(entry => {
    if (entry.event.type !== 'user_input.requested') return;
    questions.push(entry.event.payload);
    const [question] = entry.event.payload.questions;
    const blue = question.options.find(option => /blue/i.test(option.label));
    void first.control(entry.invocationId, feature('user-input.respond'), { requestId: entry.event.payload.requestId, answers: { [question.id]: [blue.label] } });
  });
  assert.equal((await first.invoke('aibo.session.turn', { text: 'Use the AskUserQuestion tool once to ask me which colour I prefer, with exactly two options: Red and Blue. Then reply with exactly COLOUR=<my answer> and nothing else.' }, 'question-turn')).status, 'completed');
  assert.equal(questions.length, 1);
  assert.ok(questions[0].questions[0].isOther, 'the custom answer field becomes the other input');
  assert.match(text(first), /COLOUR=Blue/i);
  first.listeners.clear();
  result.question = questions[0].questions.map(question => ({ header: question.header, question: question.question, options: question.options.map(option => option.label) }));
  result.checks.push('AskUserQuestion reached the host as a question and Claude used the answer');
  await first.invoke('aibo.session.close', {});

  const editor = await first.invoke('aibo.session.open', { mode: 'create', executionProfile: profile('edit'), recovery: null });
  const approvals = [];
  first.listeners.add(entry => {
    if (entry.event.type !== 'approval.requested') return;
    approvals.push(entry.event.payload);
    const allow = entry.event.payload.options.find(option => option.kind === 'allow' && !option.effects);
    void first.control(entry.invocationId, feature('approval.respond'), { requestId: entry.event.payload.requestId, optionId: allow.id });
  });
  const turn = await first.invoke('aibo.session.turn.write', { text: 'Create a file named aibo-probe.txt in the current directory containing exactly AIBO_FILE_OK and nothing else. Do not do anything else.' }, 'edit-turn', ['workspace.read', 'workspace.write']);
  assert.equal(turn.status, 'completed');
  assert.equal((await readFile(path.join(workspacePath, 'aibo-probe.txt'), 'utf8')).trim(), 'AIBO_FILE_OK');
  assert.ok(approvals.length >= 1, 'Manual mode asks the host before writing');
  assert.ok(approvals.every(approval => approval.requestId.startsWith('claude-')));
  result.approvals = approvals.map(approval => ({ kind: approval.kind, command: approval.command }));
  result.checks.push(`manual write turn asked for approval ${approvals.length} time(s); the file was written after acceptance`);
  await first.invoke('aibo.session.close', {});

  // Plan → approve → implement in one turn: the plan approval offers the declared transitions. Choosing
  // PROBE_PLAN_CHOICE (manual, auto or clear-auto; default manual) lets Claude switch modes in the same turn.
  const choice = process.env.PROBE_PLAN_CHOICE ?? 'manual';
  await first.invoke('aibo.session.open', { mode: 'create', executionProfile: profile('plan'), recovery: null });
  const planApprovals = [];
  first.listeners.clear();
  first.listeners.add(entry => {
    if (entry.event.type !== 'approval.requested') return;
    const payload = entry.event.payload;
    planApprovals.push(payload);
    const transition = payload.options.find(option => option.effects && option.effects.sessionControl === choice.replace('clear-', '') && !!option.effects.contextReset === choice.startsWith('clear-'));
    const allow = transition ?? payload.options.find(option => option.kind === 'allow');
    void first.control(entry.invocationId, feature('approval.respond'), { requestId: payload.requestId, optionId: allow.id });
  });
  const implemented = await first.invoke('aibo.session.turn', { text: 'Make a one-line plan to create a file named aibo-plan.txt in the current directory containing exactly AIBO_PLAN_OK, then call ExitPlanMode to ask for approval. Once approved, create the file and do nothing else.' }, 'plan-exit-turn');
  const exit = planApprovals.find(payload => payload.options.some(option => option.effects));
  assert.ok(exit, 'Claude asked to leave Plan mode');
  // Auto options depend on the model and organization; Manual and keep-planning are always offered.
  const auto = new Set(['exit-plan-auto', 'exit-plan-clear-auto']);
  assert.deepEqual(exit.options.filter(option => !auto.has(option.id)).map(option => [option.id, option.label, option.effects?.sessionControl ?? null]), [
    ['exit-plan-default', '批准计划，手动审批编辑', 'manual'], ['reject', '继续规划', null],
  ], 'only declared transitions and keep-planning are offered');
  assert.ok(exit.options.filter(option => auto.has(option.id)).every(option => option.effects?.sessionControl === 'auto' && !!option.effects.contextReset === (option.id === 'exit-plan-clear-auto')));
  assert.ok(exit.options.some(option => option.effects && option.effects.sessionControl === choice.replace('clear-', '') && !!option.effects.contextReset === choice.startsWith('clear-')), `${choice} was offered and chosen`);
  result.planOptions = exit.options.map(option => option.id);
  assert.equal(implemented.status, 'completed', JSON.stringify(first.events.filter(entry => entry.event.type === 'turn.failed').map(entry => entry.event.payload)));
  assert.equal((await readFile(path.join(workspacePath, 'aibo-plan.txt'), 'utf8')).trim(), 'AIBO_PLAN_OK');
  result.checks.push(`plan approval offered ${result.planOptions.join(', ')}; choosing ${choice} switched modes in the same turn and ${planApprovals.length - 1} further approval(s) followed`);
  await first.close();

  const second = worker(2);
  await second.init();
  const resumed = await second.invoke('aibo.session.open', { mode: 'resume', executionProfile: profile('edit'), recovery: turn.recovery });
  assert.equal(resumed.nativeSessionId, editor.nativeSessionId);
  result.checks.push('a new worker process resumes the prompted session with session/load');
  await second.invoke('aibo.session.close', {});
  await second.close();
  result.ok = true;
} catch (error) {
  if (error !== null) { result.error = String(error?.stack ?? error).slice(0, 4000); process.exitCode = 1; }
} finally {
  console.log(JSON.stringify(result, null, 2));
  await rm(root, { recursive: true, force: true });
}
