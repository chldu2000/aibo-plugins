import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {mkdtemp,mkdir,rm} from 'node:fs/promises';
import {tmpdir,userInfo} from 'node:os';
import path from 'node:path';
import {createInterface} from 'node:readline';
import {fileURLToPath} from 'node:url';
const backend=new URL('../plugins/terminal/backend/',import.meta.url);
execFileSync('cargo',['build','--locked','--manifest-path',fileURLToPath(new URL('Cargo.toml',backend))],{stdio:'pipe'});
const binary=fileURLToPath(new URL(`target/debug/aibo-terminal${process.platform==='win32'?'.exe':''}`,backend));
async function fixture(t) {
  const dir=await mkdtemp(path.join(tmpdir(),'aibo-terminal-test-'));await mkdir(path.join(dir,'settings'));
  const child=spawn(binary,[],{cwd:dir,env:{...process.env,AIBO_TOOL_SETTINGS:path.join(dir,'settings')},stdio:['pipe','pipe','pipe']});
  const waiters=[];const lines=createInterface({input:child.stdout});lines.on('line',line=>{const waiter=waiters.shift();if(waiter)waiter(JSON.parse(line));});
  const call=(method,params=null)=>new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('backend deadline')),10000);waiters.push(value=>{clearTimeout(timer);value.error?reject(Error(value.error)):resolve(value.result)});child.stdin.write(JSON.stringify({protocol:'aibo.tool-view/1',method,params})+'\n');});
  t.after(async()=>{if(child.exitCode===null&&!child.killed){await call('shutdown').catch(()=>{});child.stdin.end();}lines.close();await rm(dir,{recursive:true,force:true});});
  await call('initialize',{workspacePath:dir});return {child,call,dir,request:params=>call('request',params)};
}
const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function outputUntil(request,id,match) {
  let cursor=0,output='';
  for(let i=0;i<100;i++){const updates=await request({action:'read',cursors:{[id]:cursor}});const update=updates.find(v=>v.info.id===id);cursor=update.output.cursor;output+=Buffer.from(update.output.data,'base64').toString();if(match(output))return output;await delay(30);}
  throw Error(`Terminal output did not match: ${output}`);
}
test('real PTY handles input, resize, exit and preserves output', {skip:process.platform==='win32'},async t=>{
  const {request,dir,call}=await fixture(t);
  await request({action:'settings',settings:{path:'/bin/sh',args:[]}});
  const terminal=await request({action:'create',cols:80,rows:24});assert.equal(terminal.running,true);
  await request({action:'resize',id:terminal.id,cols:101,rows:33});
  await request({action:'input',id:terminal.id,data:"printf '\\nREADY_%s\\n' PTY; pwd; stty size\n"});
  const output=await outputUntil(request,terminal.id,text=>text.includes('READY_PTY')&&text.includes('33 101'));assert(output.includes(dir));
  await request({action:'input',id:terminal.id,data:'exit 7\n'});
  for(let i=0;i<100;i++){if(!(await request({action:'list'})).terminals[0].running)break;await delay(20);}
  const final=(await request({action:'list'})).terminals[0];assert.equal(final.running,false);assert.equal(final.exitCode,7);assert.equal((await call('status')).active,0);
  assert((await request({action:'read',cursors:{}}))[0].output.data.length>0);
});
test('bad shell leaves a failed tab; settings repair starts a fresh terminal',async t=>{
  const {request}=await fixture(t);await request({action:'settings',settings:{path:'/missing/aibo-shell',args:[]}});
  const bad=await request({action:'create'});assert.equal(bad.running,false);assert(bad.error);assert.equal((await request({action:'list'})).terminals.length,1);
  await assert.rejects(request({action:'settings',settings:{path:'x',args:[42]}}));
  await request({action:'close',id:bad.id});assert.equal((await request({action:'list'})).terminals.length,0);
});
test('backend death triggers watchdog cleanup of a live shell and its child', {skip:process.platform==='win32'},async t=>{
  const {request,child}=await fixture(t);await request({action:'settings',settings:{path:'/bin/sh',args:[]}});
  const terminal=await request({action:'create'});
  await request({action:'input',id:terminal.id,data:"sleep 90 & printf '\\nCHILD=%s\\n' $!\n"});
  const output=await outputUntil(request,terminal.id,text=>/CHILD=\d+/.test(text));const pid=Number(output.match(/CHILD=(\d+)/)[1]);
  child.kill('SIGKILL');
  let alive=true;
  for(let i=0;i<100;i++){try{process.kill(pid,0);}catch{alive=false;break;}await delay(30);}
  assert.equal(alive,false,`descendant ${pid} survived backend crash`);
});

test('Windows native PTY accepts a configured local shell and returns its output', {skip:process.platform!=='win32'},async t=>{
  const {request}=await fixture(t);
  await request({action:'settings',settings:{path:process.env.ComSpec??'C:\\Windows\\System32\\cmd.exe',args:['/Q']}});
  const terminal=await request({action:'create',cols:80,rows:24});assert.equal(terminal.running,true,terminal.error);
  await request({action:'resize',id:terminal.id,cols:101,rows:33});
  await request({action:'input',id:terminal.id,data:'echo WINDOWS_PTY_READY\r'});
  await outputUntil(request,terminal.id,text=>text.includes('WINDOWS_PTY_READY'));
  await request({action:'close',id:terminal.id});assert.equal((await request({action:'list'})).terminals.length,0);
});

test('Unix default follows the account login shell', {skip:process.platform==='win32'},async t=>{
  const {request}=await fixture(t);
  const terminal=await request({action:'create'});
  assert.equal(terminal.shell,userInfo().shell);
  assert.equal(terminal.running,true,terminal.error);
  await request({action:'close',id:terminal.id});
});
