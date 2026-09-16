import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import path from 'node:path';

const packagePath = process.argv[2];
const fakeBin = process.argv[3];
if (!packagePath || !fakeBin) throw new Error('Usage: smoke-cursor.mjs <package> <fake-bin>');

const child = spawn(process.execPath,[path.join(packagePath,'worker.mjs')],{
  cwd:packagePath,env:{...process.env,PATH:`${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`},stdio:['pipe','pipe','inherit'],
});
let nextId=0;
const pending=new Map();
const events=[];
const send=(method,params)=>new Promise((resolve,reject)=>{
  const id=nextId++;pending.set(id,{resolve,reject});child.stdin.write(`${JSON.stringify({jsonrpc:'2.0',id,method,params})}\n`);
});
createInterface({input:child.stdout,crlfDelay:Infinity}).on('line',line=>{
  const message=JSON.parse(line);
  if(message.method==='capability.event'){events.push(message.params.event);return;}
  const waiter=pending.get(message.id);if(!waiter)return;pending.delete(message.id);
  message.error?waiter.reject(new Error(message.error.message)):waiter.resolve(message.result);
});
const identity={protocol:'2.1',instanceId:'smoke-instance',generationId:'smoke-generation',installationId:'smoke-installation',pluginId:'dev.aibo.cursor',pluginVersion:'0.1.0',contributionId:'dev.aibo.cursor.agent',privateData:{path:packagePath,formatVersion:1}};
const initialized=await send('capability.initialize',identity);
if(initialized.protocol!=='2.1')throw new Error('Cursor package did not negotiate Runtime 2.1');
const context={turnId:null,workspaceId:'smoke-workspace',workspacePath:packagePath,originalCaller:{kind:'window',id:'smoke-window'},permissions:['workspace.read'],callChain:[]};
const invoke=(invocationId,capability,operationId,input,turnId=null)=>send('capability.invoke',{invocationId,instanceId:identity.instanceId,generationId:identity.generationId,contributionId:identity.contributionId,capability,contractVersion:'1.0.0',operationId,scope:{kind:'session',id:'smoke-session'},deadlineUnixMs:Date.now()+30_000,context:{...context,turnId},input});
const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'never',approvalReviewer:'none',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',model:null,reasoningEffort:null};
const opened=await invoke('open','aibo.session.open','dev.aibo.cursor.session.open',{mode:'create',executionProfile:profile,recovery:null});
if(opened.output.nativeSessionId!=='fake-cursor-session')throw new Error('Cursor package did not open the fake ACP session');
const turn=await invoke('turn','aibo.session.turn','dev.aibo.cursor.session.turn',{text:'hello'},'smoke-turn');
if(turn.output.status!=='completed'||!events.some(event=>event.type==='message.delta'&&event.payload.delta==='AIBO_CURSOR_OK')||!events.some(event=>event.type==='turn.completed'))throw new Error('Cursor package did not stream and complete the fake turn');
child.stdin.end();
await new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(new Error(`Cursor worker exited ${code}`)));setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Cursor worker did not exit'));},3_000).unref();});
console.log('Cursor packaged worker smoke test passed');
