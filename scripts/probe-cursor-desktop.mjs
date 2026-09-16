import { mkdir, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawn } from 'node:child_process';
import { buildExternalPlugin } from './build.mjs';

if(process.platform!=='darwin')throw Error('Cursor desktop probe currently supports macOS only');
const project=fileURLToPath(new URL('../',import.meta.url));
const aibo=path.resolve(process.env.AIBO_ROOT??path.join(project,'../aibo'));
process.chdir(aibo);
const {createServer}=await import(pathToFileURL(path.join(aibo,'node_modules/vite/dist/node/index.js')).href);
const built=await buildExternalPlugin();
const root=await mkdtemp(path.join(tmpdir(),'aibo-cursor-desktop-'));
const workspacePath=path.join(root,'workspace');await mkdir(workspacePath);
let finish;
const report=new Promise(resolve=>finish=resolve);
const clientPath=path.join(project,'scripts/probe-cursor-desktop-client.mjs');
const server=await createServer({root:aibo,server:{host:'127.0.0.1',port:0,strictPort:false,fs:{allow:[aibo,project]}},plugins:[{name:'cursor-desktop-probe',configureServer(vite){
  vite.middlewares.use('/__cursor_probe_config',(_req,res)=>{res.setHeader('Content-Type','application/json');res.end(JSON.stringify({workspacePath,packagePath:built.cursor}));});
  vite.middlewares.use('/__cursor_probe_report',(req,res)=>{let text='';req.on('data',chunk=>text+=chunk);req.on('end',()=>{try{finish(JSON.parse(text));res.end('ok');}catch{res.statusCode=400;res.end('bad report');}});});
  vite.middlewares.use('/cursor-probe.html',(_req,res)=>{res.setHeader('Content-Type','text/html');res.end(`<!doctype html><html><body><pre>Cursor probe</pre><script type="module" src="/@fs/${clientPath}"></script></body></html>`);});
}}]});
await server.listen();
const port=server.httpServer.address().port;
const identifier=`local.aibo.cursorprobe.${Date.now()}`;
const config=path.join(root,'tauri.json');
await writeFile(config,JSON.stringify({identifier,productName:'Aibo Cursor isolated probe',build:{beforeDevCommand:'',devUrl:`http://127.0.0.1:${port}`},app:{windows:[{label:'main',title:'Aibo Cursor isolated probe',url:'cursor-probe.html',width:900,height:600}]}}));
const child=spawn('pnpm',['tauri','dev','--no-watch','--config',config],{cwd:aibo,stdio:['ignore','pipe','pipe'],detached:true});
child.stdout.pipe(process.stdout);child.stderr.pipe(process.stderr);
let timer;
try {
  const result=await Promise.race([report,new Promise((_,reject)=>timer=setTimeout(()=>reject(Error('Cursor desktop probe timed out')),240_000)),new Promise((_,reject)=>child.on('exit',code=>reject(Error(`Tauri exited before report: ${code}`))))]);
  console.log(`CURSOR_DESKTOP_RESULT ${JSON.stringify(result)}`);
  await writeFile('/private/tmp/aibo-cursor-desktop-result.json',`${JSON.stringify(result,null,2)}\n`);
  if(!result.ok)process.exitCode=1;
} finally {
  clearTimeout(timer);try{process.kill(-child.pid,'SIGTERM')}catch{}
  await server.close();await rm(root,{recursive:true,force:true});
  console.log(`Isolated application identifier: ${identifier}`);
}
