// ACP values remain opaque. In particular, labels are not token counts.
export function selectValues(config) {
  return (Array.isArray(config?.options) ? config.options : []).flatMap(option => Array.isArray(option?.options) ? option.options : [option])
    .filter(option => typeof option?.value === 'string' && option.value.length);
}
export function modelParameters(configs, model) {
  const valid = configs.filter(config => config?.type === 'select' && typeof config.id === 'string' && typeof config.currentValue === 'string' && selectValues(config).length);
  const thoughts = valid.filter(config => config.category === 'thought_level' || (!config.category && ['effort', 'reasoning', 'reasoning_effort', 'thought_level', 'thinking'].includes(config.id)));
  const contexts = valid.filter(config => config.category === 'model_config' && ['context', 'context_window', 'context_size'].includes(config.id));
  let combinations = thoughts.length ? [{ values: [], labels: [] }] : [];
  for (const config of thoughts) {
    if (combinations.length * selectValues(config).length > 128) { combinations = []; break; }
    combinations = combinations.flatMap(previous => selectValues(config).map(option => ({
      values: [...previous.values, { id: config.id, value: option.value }],
      labels: [...previous.labels, thoughts.length > 1 ? `${config.name || config.id}: ${option.name || option.value}` : option.name || option.value],
    })));
  }
  const levels = combinations.map(({ values, labels }) => ({ id: JSON.stringify([model, values]), label: labels.join(' · '), values }));
  const current = levels.find(level => level.values.every(value => thoughts.find(config => config.id === value.id)?.currentValue === value.value))?.id ?? null;
  const context = contexts.length === 1 ? contexts[0] : null;
  return { levels, current, context, contextWindows: selectValues(context).map(option => ({ id: option.value, label: option.name || option.value,
    ...(option.description ? { description: option.description } : {}),
    ...(Number.isSafeInteger(option.tokens) && option.tokens > 0 ? { tokens: option.tokens } : {}),
  })) };
}
