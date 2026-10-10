import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

test('terminal view follows the host visual contract', async () => {
  const css = await readFile(new URL('../plugins/terminal/style.css', import.meta.url), 'utf8');
  assert.doesNotMatch(css, /border-radius\s*:\s*[1-9]/, 'square corners');
  assert.match(css, /var\(--aibo-/, 'colours come from host tokens');
  const js = await readFile(new URL('../plugins/terminal/frontend.js', import.meta.url), 'utf8');
  assert.equal((js.match(/<header>/g) ?? []).length, 1, 'single toolbar row');
  assert.match(js, /type:'reload'/, 'dead backend asks the host to rebuild');
});
