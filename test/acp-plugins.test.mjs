import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { acpAgentConfig, extensionFromConfig } from '@aibolabs/acp-adapter/worker';

const project = fileURLToPath(new URL('../', import.meta.url));
const aibo = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
const json = async file => JSON.parse(await readFile(file, 'utf8'));
// Configuration-only ACP plugins: no code beyond the one-line worker.
const plugins = ['acp-template', 'claude-code'];

for (const name of plugins) {
const template = file => path.join(project, 'plugins', name, file);

test(`${name} is a valid manifest whose operations match the host session contracts`, async () => {
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

test(`${name} acp.json configures the generic worker and every declared mode`, async t => {
  const manifest = await json(template('plugin.json'));
  const config = acpAgentConfig(await json(template('acp.json')), manifest);
  let manifestUrl;
  if (config.launch) {
    const directory = await mkdtemp(path.join(tmpdir(), 'aibo-config-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    const entry = path.join(directory, config.launch.entry);
    await mkdir(path.dirname(entry), { recursive: true });
    await writeFile(entry, '');
    manifestUrl = pathToFileURL(path.join(directory, 'plugin.json'));
  }
  const extension = extensionFromConfig(config, manifest, manifestUrl);
  if (name === 'claude-code') {
    assert.equal(extension.parameterScope, 'current-model');
    assert.equal(config.launch.entry, 'launch-acp.mjs');
    assert.ok(manifest.executableDependencies.some(item => item.name === 'claude' && item.required && item.versionRange === '>=2.1.280'));
    assert.ok((await json(template('package.json'))).files.includes(config.launch.entry));
    assert.throws(() => acpAgentConfig({ ...config, parameterScope: 'all-models' }, manifest), /parameterScope/);
  }
  assert.equal(extension.recoverySchema, `${manifest.pluginId}.recovery`);
  assert.equal(extension.writableMode, config.modes.edit);
  for (const control of manifest.contributions[0].sessionControls) {
    const { mode } = extension.validateExecutionProfile({ schema: 'aibo.execution-profile/v1', ...control.profile }, ['workspace.read', 'workspace.write']);
    // Auto is edit reviewed by the agent's own classifier.
    assert.equal(mode, config.modes[control.profile.approvalReviewer === 'auto-review' ? 'auto' : control.profile.interactionMode], control.id);
  }
  const targets = manifest.contributions[0].sessionControls.flatMap(control => control.transitions ?? []);
  for (const choice of extension.approvalChoices.filter(choice => choice.sessionControl)) {
    assert.ok(targets.includes(choice.sessionControl), `${choice.optionId} switches only to a declared transition target`);
    assert.ok(extension.writableModes.includes(choice.mode), `${choice.optionId} switches to a writable mode`);
  }
  assert.throws(() => acpAgentConfig({ ...config, command: 'sh' }, manifest), /executableDependencies|without command/);
});

test(`${name} uses the shared configuration-driven worker`, async () => {
  assert.equal(await readFile(template('worker.mjs'), 'utf8'), await readFile(path.join(project, 'plugins/acp-template/worker.mjs'), 'utf8'));
});
}
