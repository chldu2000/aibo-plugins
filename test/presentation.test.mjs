import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

test('状态控件保留宿主标签，其他控件继承默认实现', async () => {
  const self = {};
  runInNewContext(await readFile(new URL('../plugins/presentation/worker.js', import.meta.url), 'utf8'), { self });
  const render = self.aiboPresentation.render;
  for (const tone of ['idle', 'running', 'attention', 'danger', 'muted']) {
    const tree = render({surface:'controls',data:{control:'AgentStatusMark',props:{label:'运行中',tone}}});
    assert.equal(tree.text, '运行中');
    assert.equal(tree.key, 'agent-status');
    assert.equal(tree.events, undefined);
  }
  assert.equal(render({surface:'controls',data:{control:'ModelMatrix'}}), null);
});
