import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpSession } from '@aibolabs/acp-adapter';
import { claudeUsage } from '../plugins/claude-code/claude-usage.mjs';

const update = info => ({ sessionUpdate: 'usage_update', used: 50, size: 200, _meta: { '_claude/rateLimit': info } });

test('Claude maps subscription ratios, prefers unified windows and rejects invented percentages', () => {
  const result = claudeUsage(update({ rateLimitType: 'five_hour', utilization: .9, unifiedWindows: {
    five_hour: { utilization: .24, resetsAt: 2000 }, seven_day: { utilization: .13 },
    seven_day_opus: { utilization: 0 }, seven_day_sonnet: { utilization: 1 }, overage: { utilization: .2 },
  } }), 1000);
  assert.deepEqual(result.limits.map(l => [l.id, l.usedPercent, l.resetsAt, l.observedAt]), [
    ['five_hour', 24, 2000, 1000], ['seven_day', 13, null, 1000], ['seven_day_opus', 0, null, 1000], ['seven_day_sonnet', 100, null, 1000],
  ]);
  for (const utilization of [undefined, null, '0.2', NaN, Infinity, -1, 24]) {
    assert.deepEqual(claudeUsage(update({ status: 'rejected', rateLimitType: 'five_hour', utilization })), {});
  }
  assert.equal(claudeUsage(update({ rateLimitType: 'seven_day', utilization: .5, resetsAt: -1 }), 1000).limits[0].resetsAt, null);
  assert.deepEqual(claudeUsage(update({ rateLimitType: 'overage', utilization: .5 })), {});
});

test('real ACP session merges quota with context and turn totals, isolates sessions and clears on reconnect', async () => {
  const transports = [], events = [];
  const session = new AcpSession({ emit: e => events.push(e), extension: {
    label: 'Test', command: 'unused', namespace: 'test', recoverySchema: 'test', writableMode: 'edit',
    validateExecutionProfile: profile => ({ mode: 'ask', profile }), mapUsage: claudeUsage,
  }, transportFactory: () => {
    const transport = { closed: false, start() { return this; }, onRequest() { return () => {}; },
      onNotification(fn) { this.receive = fn; return () => {}; },
      async request(method) {
        if (method === 'initialize') return { protocolVersion: 1, agentCapabilities: { loadSession: true } };
        if (method === 'session/new') return { sessionId: 'native', modes: { currentModeId: 'ask', availableModes: [{ id: 'ask' }] } };
        if (method === 'session/load') {
          this.receive({ method: 'session/update', params: { sessionId: 'native', update: update({ rateLimitType: 'five_hour', utilization: .99 }) } });
          return { modes: { currentModeId: 'ask', availableModes: [{ id: 'ask' }] } };
        }
        if (method === 'session/prompt') return new Promise(resolve => { this.finish = resolve; });
        throw Error(method);
      }, async close() { this.closed = true; }, notify() {}, respond() {},
    };
    transports.push(transport); return transport;
  } });
  const options = { mode: 'create', workspaceId: 'w', workspacePath: '/w', executionProfile: {}, permissions: ['workspace.read'] };
  await session.open(options);
  const send = (info, sessionId = 'native', transport = transports.at(-1)) => transport.receive({ method: 'session/update', params: { sessionId, update: update(info) } });
  const usage = () => events.filter(e => e.type === 'usage.updated').at(-1).payload.usage;
  send({ unifiedWindows: { five_hour: { utilization: .24 }, seven_day: { utilization: .13 } } });
  assert.equal(usage().limits.length, 2, 'idle observations are supported');
  send({ rateLimitType: 'five_hour', utilization: .9 }, 'foreign');
  assert.equal(usage().limits[0].usedPercent, 24);
  const turn = session.prompt({ text: 'hello', turnId: 'turn' });
  send({ rateLimitType: 'five_hour', utilization: .3 });
  send(undefined);
  transports[0].finish({ stopReason: 'end_turn', usage: { inputTokens: 10, outputTokens: 2, totalTokens: 12 } });
  await turn;
  assert.deepEqual(usage().limits.map(l => l.usedPercent), [30, 13]);
  assert.equal(usage().contextTokens, 50);
  assert.equal(usage().totalTokens, 12);
  const recovery = session.recovery();
  assert.equal(recovery.data.usage, undefined);
  await session.close();
  await session.open({ ...options, mode: 'resume', recovery });
  assert.deepEqual(usage(), {}, 'neither recovery nor replay restores live quota');
  send({ rateLimitType: 'five_hour', utilization: .8 }, 'native', transports[0]);
  assert.deepEqual(usage(), {}, 'old transport cannot repopulate quota');
  await session.close();
});
