import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { CAPABILITIES } from '../plugins/cursor/cursor-session.mjs';

const project = fileURLToPath(new URL('../', import.meta.url));
const aibo = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
const json = async file => JSON.parse(await readFile(file, 'utf8'));

test('Cursor publishes native Agent Ask Plan modes with explicit provider-owned permissions', async () => {
  const manifest = await json(path.join(project, 'plugins/cursor/plugin.json'));
  const provider = manifest.contributions[0];
  assert.equal(provider.executionPolicy, 'agent-managed');
  assert.deepEqual(provider.sessionControls.map(control => control.label), ['Agent', 'Ask', 'Plan']);
  assert.deepEqual(provider.sessionControls.map(control => control.profile.interactionMode), ['edit', 'ask', 'plan']);
  const { validateExecutionProfile } = await import('../plugins/cursor/cursor-session.mjs');
  for (const control of provider.sessionControls) {
    assert.equal(control.kind, 'mode');
    assert.equal(control.profile.networkPolicy, 'agent-managed');
    assert.equal(validateExecutionProfile({schema:'aibo.execution-profile/v1',...control.profile}, ['workspace.read','workspace.write']).mode, control.id);
  }
});

test('Cursor manifest qualifies for the host queue without claiming native steering', async () => {
  const manifest = await json(path.join(project, 'plugins/cursor/plugin.json'));
  const packageManifest = await json(path.join(project, 'plugins/cursor/package.json'));
  const contracts = await json(path.join(aibo, 'contracts/session-capabilities.v1.json'));
  const contribution = manifest.contributions.find(entry => entry.id === 'dev.aibo.cursor.agent');

  assert.equal(manifest.version, packageManifest.version);
  assert.deepEqual(manifest.protocols.runtime, { min: '2.1', max: '2.1' });
  assert.equal(contribution.kind, 'capabilityProvider');
  assert.equal(contribution.scope, 'session');

  for (const id of ['aibo.session.open', 'aibo.session.turn', 'aibo.session.cancel', 'aibo.session.close']) {
    const operation = contribution.operations.find(candidate => candidate.capability.id === id);
    assert.ok(operation, `missing ${id}`);
    assert.equal(operation.capability.version, contracts.version);
    assert.deepEqual(operation.inputSchema, contracts.capabilities[id].inputSchema);
    assert.deepEqual(operation.outputSchema, contracts.capabilities[id].outputSchema);
    assert.equal(operation.effect, 'read');
    assert.deepEqual(operation.permissions, ['workspace.read']);
  }

  assert.equal(contribution.operations.some(operation => operation.capability.id === 'dev.aibo.cursor.queue.manage'), false);
  assert.equal(CAPABILITIES.includes('queue.manage'), false);
  assert.equal(CAPABILITIES.includes('queue.steer'), false);
  assert.equal(CAPABILITIES.some(capability => capability.startsWith('goal.')), false);
});


test('Cursor model operation validates host inputs and the release manifest', async () => {
  const require = createRequire(path.join(aibo, 'package.json'));
  const Ajv = require('ajv/dist/2020').default;
  const ajv = new Ajv({ strict: false, formats: { uri: true } });
  const manifest = await json(path.join(project, 'plugins/cursor/plugin.json'));
  const validate = ajv.compile(await json(path.join(aibo, 'contracts/plugin-manifest.v2.schema.json')));
  assert.ok(validate(manifest), JSON.stringify(validate.errors));
  const operation = manifest.contributions[0].operations.find(operation => operation.capability.id === 'dev.aibo.cursor.model.select');
  assert.ok(operation);
  const input = ajv.compile(operation.inputSchema);
  assert.equal(input({ action: 'list' }), true);
  assert.equal(input({ action: 'set', reference: 'default[]' }), true);
  // The shared schema validates the envelope; the provider validates set values.
  assert.equal(input({ action: 'set' }), true);
  assert.equal(input({ action: 'set', reference: '' }), false);
  assert.equal(input({ action: 'subscribe' }), false);
});

test('Cursor parameter operations validate the host list/set contracts', async () => {
  const require = createRequire(path.join(aibo, 'package.json'));
  const Ajv = require('ajv/dist/2020').default;
  const ajv = new Ajv({ strict: false });
  const manifest = await json(path.join(project, 'plugins/cursor/plugin.json'));
  for (const [kind, key] of [['reasoning', 'level'], ['context-window', 'contextWindow']]) {
    const operation = manifest.contributions[0].operations.find(operation => operation.capability.id === `dev.aibo.cursor.model.${kind}`);
    assert.equal(operation.effect, 'read');
    assert.deepEqual(operation.permissions, ['workspace.read']);
    const input = ajv.compile(operation.inputSchema);
    assert.equal(input({ action: 'list' }), true);
    assert.equal(input({ action: 'set', [key]: 'opaque-native-value' }), true);
    // The shared schema validates the envelope; the provider validates set values.
    assert.equal(input({ action: 'set' }), true);
    assert.equal(input({ action: 'set', [key]: '' }), false);
    assert.equal(input({ action: 'set', [key]: 'x', command: 'unexpected' }), false);
  }
});

test('Cursor command directory accepts host inputs and requires the negotiated reply envelope', async () => {
  const require = createRequire(path.join(aibo, 'package.json'));
  const Ajv = require('ajv/dist/2020').default;
  const ajv = new Ajv({ strict: false });
  const manifest = await json(path.join(project, 'plugins/cursor/plugin.json'));
  const operation = manifest.contributions[0].operations.find(operation => operation.capability.id === 'dev.aibo.cursor.command.list');
  assert.ok(CAPABILITIES.includes('command.list'));
  assert.equal(operation.effect, 'read');
  assert.deepEqual(operation.permissions, ['workspace.read']);
  const input = ajv.compile(operation.inputSchema);
  assert.equal(input({}), true);
  assert.equal(input({ command: 'unexpected' }), false);
  assert.equal(input({ action: 'get' }), true);
  const output = ajv.compile(operation.outputSchema);
  const reply = { commands: [{ name: 'review', description: null, source: 'agent', category: 'agent', execution: 'prompt', insertionText: '/review ' }], recovery: null, capabilities: ['command.list'] };
  assert.equal(output(reply), true);
  assert.equal(output({commands: reply.commands}), false, 'feature replies require negotiated capability and recovery fields');
  assert.equal(output({...reply,capabilities: 'command.list'}), false);
});


test('every Cursor feature pins a supported host schema and never claims an unimplemented execution backend', async () => {
  const manifest = await json(path.join(project, 'plugins/cursor/plugin.json'));
  const contracts = await json(path.join(aibo, 'contracts/session-features.v1.json'));
  const operations = manifest.contributions[0].operations;
  const prefix = manifest.pluginId + '.';
  const features = operations.filter(op => op.capability.id.startsWith(prefix));
  assert.deepEqual(features.map(op => op.capability.id.slice(prefix.length)).sort(), [
    'approval.respond','command.list','model.context-window','model.reasoning','model.select','user-input.respond',
  ]);
  for (const op of features) {
    const name = op.capability.id.slice(prefix.length);
    assert.equal(op.capability.version, contracts.version);
    assert.equal(op.effect, 'read');
    assert.deepEqual(op.permissions, ['workspace.read']);
    assert.ok(contracts.capabilities[name].some(contract => {
      try {assert.deepEqual(op.inputSchema,contract.inputSchema);assert.deepEqual(op.outputSchema,contract.outputSchema);return true;}
      catch {return false;}
    }), `${name} must match a host-negotiable contract`);
  }
  assert.equal(operations.some(op=>op.capability.id==='aibo.session.tool.respond'),false, 'Cursor ACP does not implement the Core tool gateway');
  for(const name of ['session.tree','session.timeline','session.snapshot','session.fork','compaction.run']) {
    assert.equal(CAPABILITIES.includes(name),false);
    assert.equal(operations.some(op=>op.capability.id===prefix+name),false);
  }
});
