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
  assert.equal(input({ action: 'set' }), false);
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
    assert.equal(input({ action: 'set' }), false);
    assert.equal(input({ action: 'set', [key]: '' }), false);
    assert.equal(input({ action: 'set', [key]: 'x', command: 'unexpected' }), false);
  }
});
