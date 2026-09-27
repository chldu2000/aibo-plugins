import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { acpAgentConfig, extensionFromConfig } from '@aibo/acp-adapter/worker';

const project = fileURLToPath(new URL('../', import.meta.url));
const aibo = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
const template = file => path.join(project, 'plugins/acp-template', file);

test('the ACP template is a valid manifest whose operations match the host session contracts', async () => {
  const require = createRequire(path.join(aibo, 'package.json'));
  const Ajv = require('ajv/dist/2020').default;
  const manifest = await json(template('plugin.json'));
  const validate = new Ajv({ strict: false, formats: { uri: true } }).compile(await json(path.join(aibo, 'contracts/plugin-manifest.v2.schema.json')));
  assert.ok(validate(manifest), JSON.stringify(validate.errors));
  assert.equal(manifest.version, (await json(template('package.json'))).version);
  const provider = manifest.contributions[0];
  assert.equal(provider.executionPolicy, 'agent-managed');
  const base = await json(path.join(aibo, 'contracts/session-capabilities.v1.json'));
  const features = await json(path.join(aibo, 'contracts/session-features.v1.json'));
  for (const operation of provider.operations) {
    const id = operation.capability.id;
    const shapes = id.startsWith('aibo.') ? [base.capabilities[id]] : features.capabilities[id.slice(`${manifest.pluginId}.`.length)];
    assert.ok(shapes?.some(shape => shape && isDeepStrictEqual(shape.inputSchema, operation.inputSchema) && isDeepStrictEqual(shape.outputSchema, operation.outputSchema)), `${id} matches a host contract variant`);
  }
});

test('the template acp.json configures the generic worker and every declared mode', async () => {
  const manifest = await json(template('plugin.json'));
  const config = acpAgentConfig(await json(template('acp.json')), manifest);
  const extension = extensionFromConfig(config, manifest);
  assert.equal(extension.recoverySchema, `${manifest.pluginId}.recovery`);
  assert.equal(extension.writableMode, config.modes.edit);
  for (const control of manifest.contributions[0].sessionControls) {
    const { mode } = extension.validateExecutionProfile({ schema: 'aibo.execution-profile/v1', ...control.profile }, ['workspace.read', 'workspace.write']);
    assert.equal(mode, config.modes[control.profile.interactionMode], control.id);
  }
  assert.throws(() => acpAgentConfig({ ...config, command: 'sh' }, manifest), /executableDependencies/);
});
