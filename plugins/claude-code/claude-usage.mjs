const windows = new Map([
  ['five_hour', { label: '5 小时', windowMinutes: 300 }],
  ['seven_day', { label: '每周', windowMinutes: 10080 }],
  ['seven_day_opus', { label: 'Opus 每周', windowMinutes: 10080 }],
  ['seven_day_sonnet', { label: 'Sonnet 每周', windowMinutes: 10080 }],
]);

/** Claude event utilization is a ratio (0..1), unlike the structured /usage API's percent. */
export function claudeUsage(update, now = Date.now() / 1000) {
  const info = update?._meta?.['_claude/rateLimit'];
  if (!info || typeof info !== 'object') return {};
  const limits = [];
  for (const [id, window] of windows) {
    const bucket = info.unifiedWindows?.[id];
    // Prefer a valid per-window observation, with the legacy representative bucket as fallback.
    const source = validRatio(bucket?.utilization) ? bucket
      : info.rateLimitType === id && validRatio(info.utilization) ? info : null;
    if (!source) continue;
    const resetsAt = typeof source.resetsAt === 'number' && Number.isFinite(source.resetsAt)
      && source.resetsAt > 0 && source.resetsAt <= 8.64e12 ? source.resetsAt : null;
    limits.push({ id, ...window, usedPercent: source.utilization * 100, resetsAt, observedAt: now });
  }
  return limits.length ? { limits } : {};
}

function validRatio(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
}
