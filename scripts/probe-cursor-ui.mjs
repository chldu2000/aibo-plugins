// Real App in an isolated WKWebView. Takes foreground for native mouse/keyboard input.
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn, execFileSync, execFile } from 'node:child_process';
import { buildExternalPlugin } from './build.mjs';

if (process.platform !== 'darwin') throw Error('This probe requires macOS');
const project = fileURLToPath(new URL('../', import.meta.url));
const aibo = path.resolve(process.env.AIBO_ROOT ?? path.join(project, '../aibo'));
process.chdir(aibo);
const { createServer } = await import(pathToFileURL(path.join(aibo, 'node_modules/vite/dist/node/index.js')));
const built = process.env.AIBO_CURSOR_PACKAGE ? { cursor: path.resolve(process.env.AIBO_CURSOR_PACKAGE) } : await buildExternalPlugin();
const root = await mkdtemp(path.join(tmpdir(), 'aibo-cursor-ui-'));
const workspacePath = path.join(root, 'workspace'); await mkdir(workspacePath);
execFileSync('git', ['init', '-q', workspacePath]);
await writeFile(path.join(workspacePath, 'probe.txt'), 'AIBO_CURSOR_UI_FIXTURE\n');
const legacyPath = path.join(root, 'legacy'); await mkdir(legacyPath);
// The remote-main baseline has its own session implementation, before A1 extraction.
execFileSync('tar', ['-xf', '-', '-C', legacyPath, '--strip-components=2'], {
  input: execFileSync('git', ['archive', 'd2616e4', 'plugins/cursor'], { cwd: project }),
});
const helper = path.join(root, 'native-input');
execFileSync('swiftc', ['-O', path.join(aibo, 'probes/native-input.swift'), '-o', helper]);
const identifier = `local.aibo.cursorui.${Date.now()}`, windowId = `cursor-ui-${Date.now()}`;
const capability = { ...JSON.parse(await readFile(path.join(aibo, 'src-tauri/capabilities/default.json'))), windows: [windowId] };
let child, finish, phase = 'initial', previous;
const checks = [];
function isolatedPid() {
  const rows = execFileSync('ps', ['-axo', 'pid=,ppid=,comm='], { encoding: 'utf8' }).trim().split('\n').map(line => {
    const [, pid, parent, command] = line.match(/^\s*(\d+)\s+(\d+)\s+(.+)$/);
    return { pid: Number(pid), parent: Number(parent), command };
  });
  const descendants = new Set([child.pid]);
  for (let i = 0; i < 20; i++) for (const row of rows) if (descendants.has(row.parent)) descendants.add(row.pid);
  const found = rows.filter(row => descendants.has(row.pid) && path.basename(row.command) === 'aibo');
  if (found.length !== 1) throw Error('Expected one isolated Aibo process');
  return found[0].pid;
}
const body = req => new Promise((resolve, reject) => {
  let text = ''; req.on('data', chunk => { text += chunk; });
  req.on('end', () => { try { resolve(JSON.parse(text)); } catch (error) { reject(error); } });
});
const server = await createServer({ root: aibo, cacheDir: path.join(root, 'vite-cache'), optimizeDeps: { entries: [path.join(project, 'scripts/probe-cursor-ui-client.mjs')], include: ['svelte', 'svelte/internal/client', '@tauri-apps/api/core', '@tauri-apps/api/event', '@tauri-apps/api/window', '@tauri-apps/plugin-dialog', 'lowlight'] }, resolve: { dedupe: ['svelte', '@tauri-apps/api'] }, server: { host: '127.0.0.1', port: 0, hmr: false, watch: null, fs: { allow: [aibo, project] } }, plugins: [{
  name: 'cursor-ui-probe', configureServer(vite) {
    const json = (res, value) => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(value)); };
    vite.middlewares.use('/__cursor_ui_config', (_req, res) => json(res, { workspacePath, packagePath: built.cursor, legacyPath, phase, previous, skipMenus: process.env.AIBO_CURSOR_UI_SKIP_MENUS === '1' }));
    vite.middlewares.use('/__cursor_ui_check', async (req, res) => { const check = await body(req); checks.push({ phase, ...check }); console.log('CURSOR_UI_CHECK ' + JSON.stringify(check)); res.end('ok'); });
    vite.middlewares.use('/__cursor_ui_report', async (req, res) => { finish(await body(req)); res.end('ok'); });
    vite.middlewares.use('/__cursor_ui_input', async (req, res) => {
      try {
        const step = await body(req);
        const args = step.action === 'click' ? [step.x, step.y, step.width, step.height].map(String) : [step.key];
        execFile(helper, [String(isolatedPid()), step.action, ...args], { timeout: 20000 }, (error, stdout, stderr) => json(res, error ? { ok: false, error: String(stderr || error) } : { ok: true }));
      } catch (error) { json(res, { ok: false, error: String(error) }); }
    });
    vite.middlewares.use('/cursor-ui.html', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.end(`<!doctype html><html><body><div id="app"></div><script>window.addEventListener("error",e=>fetch("/__cursor_ui_report",{method:"POST",body:JSON.stringify({ok:false,error:e.message})}));</script><script type="module" src="/@fs/${path.join(project, 'scripts/probe-cursor-ui-client.mjs')}"></script></body></html>`);
    });
  },
}] });
await server.listen();
const configPath = path.join(root, 'tauri.json');
await writeFile(configPath, JSON.stringify({ identifier, productName: 'Aibo Cursor UI isolated probe', build: { beforeDevCommand: '', devUrl: `http://127.0.0.1:${server.httpServer.address().port}` }, app: { security: { capabilities: [capability] }, windows: [{ label: windowId, title: 'Aibo Cursor UI isolated probe', url: 'cursor-ui.html', width: 1380, height: 940 }] } }));
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise(resolve => child.once('exit', resolve));
  try { process.kill(-child.pid, 'SIGTERM'); } catch {}
  await exited;
}
let result;
try {
  for (phase of ['initial', 'restart']) {
    const report = new Promise(resolve => { finish = resolve; });
    child = spawn('pnpm', ['tauri', 'dev', '--no-watch', '--config', configPath], { cwd: aibo, stdio: ['ignore', 'pipe', 'pipe'], detached: true });
    child.stdout.pipe(process.stdout); child.stderr.pipe(process.stderr);
    let timer;
    result = await Promise.race([report, new Promise((_, reject) => { timer = setTimeout(() => reject(Error(`UI probe ${phase} timeout`)), 900000); }), new Promise((_, reject) => child.once('exit', code => reject(Error('Tauri exited: ' + code))))]).finally(() => clearTimeout(timer));
    await stop();
    if (!result.ok) break;
    previous = result.context;
  }
} catch (error) { result = { ok: false, error: String(error) }; }
finally {
  await stop(); await server.close();
  const summary = { ...result, acceptanceComplete: result?.ok === true && process.env.AIBO_CURSOR_UI_SKIP_MENUS !== '1' && !checks.some(check => check.status === 'not-observed'), skippedChecks: process.env.AIBO_CURSOR_UI_SKIP_MENUS === '1' ? ['theme menus and mode switching (separate run)'] : [], identifier, platform: process.platform, architecture: process.arch, checks, interaction: 'real App and Tauri IPC in WKWebView; CGEvent clicks/keys; DOM input values seeded by probe' };
  await writeFile('/private/tmp/aibo-cursor-ui-result.json', JSON.stringify(summary, null, 2) + '\n');
  console.log('CURSOR_UI_RESULT ' + JSON.stringify(summary));
  await rm(root, { recursive: true, force: true });
}
if (!result?.ok) process.exitCode = 1;
