import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// The starter worker declares its identity in code; the host rejects initialization when it differs from plugin.json.
test('capability starter worker identity matches its manifest', async () => {
  const manifest = JSON.parse(await readFile(new URL('../plugins/capability/plugin.json', import.meta.url), 'utf8'));
  const worker = await readFile(new URL('../plugins/capability/worker.ts', import.meta.url), 'utf8');
  assert.match(worker, new RegExp(`pluginId:'${manifest.pluginId.replaceAll('.', '\\.')}'`));
  assert.match(worker, new RegExp(`pluginVersion:'${manifest.version.replaceAll('.', '\\.')}'`));
});
