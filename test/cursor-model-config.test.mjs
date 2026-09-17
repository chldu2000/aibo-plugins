import test from 'node:test';
import assert from 'node:assert/strict';
import { modelParameters } from '../plugins/cursor/model-config.mjs';

test('semantic categories and native aliases preserve names, values, order and model identity', () => {
  for (const id of ['effort', 'reasoning', 'reasoning_effort', 'thought_level']) {
    const config = { id, type: 'select', currentValue: 'extra-high', options: [{ value: 'extra-high', name: 'Extra High' }, { value: 'max', name: 'Maximum' }] };
    const first = modelParameters([config], 'one');
    assert.deepEqual(first.levels.map(level => level.label), ['Extra High', 'Maximum']);
    assert.equal(first.current, first.levels[0].id);
    assert.notEqual(first.current, modelParameters([config], 'two').current);
    assert.deepEqual(first.levels[0].values, [{ id, value: 'extra-high' }]);
  }
});

test('context is not inferred from unrelated model_config fields or display labels', () => {
  const config = { id: 'context', category: 'model_config', type: 'select', currentValue: 'long', options: [{ value: 'long', name: '1M' }] };
  assert.deepEqual(modelParameters([config], 'm').contextWindows, [{ id: 'long', label: '1M' }]);
  assert.deepEqual(modelParameters([{ ...config, id: 'fast' }], 'm').contextWindows, []);
  assert.deepEqual(modelParameters([config, { ...config, id: 'context_size' }], 'm').contextWindows, []);
});
