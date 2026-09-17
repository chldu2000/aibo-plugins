import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { readFile } from 'node:fs/promises';
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
const manifest=JSON.parse(await readFile(path.join(packagePath,'plugin.json'),'utf8'));
const identity={protocol:'2.1',instanceId:'smoke-instance',generationId:'smoke-generation',installationId:'smoke-installation',pluginId:manifest.pluginId,pluginVersion:manifest.version,contributionId:'dev.aibo.cursor.agent',privateData:{path:packagePath,formatVersion:1}};
const initialized=await send('capability.initialize',identity);
if(initialized.protocol!=='2.1')throw new Error('Cursor package did not negotiate Runtime 2.1');
const context={turnId:null,workspaceId:'smoke-workspace',workspacePath:packagePath,originalCaller:{kind:'window',id:'smoke-window'},permissions:['workspace.read'],callChain:[]};
const invoke=(invocationId,capability,operationId,input,turnId=null)=>send('capability.invoke',{invocationId,instanceId:identity.instanceId,generationId:identity.generationId,contributionId:identity.contributionId,capability,contractVersion:'1.0.0',operationId,scope:{kind:'session',id:'smoke-session'},deadlineUnixMs:Date.now()+30_000,context:{...context,turnId},input});
const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'never',approvalReviewer:'none',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',model:null,reasoningEffort:null};
const opened=await invoke('open','aibo.session.open','dev.aibo.cursor.session.open',{mode:'create',executionProfile:profile,recovery:null});
if(opened.output.nativeSessionId!=='fake-cursor-session')throw new Error('Cursor package did not open the fake ACP session');
if (!opened.output.capabilities.includes('model.select')) throw new Error('Cursor package did not negotiate model selection');
const catalog = await invoke('models', 'dev.aibo.cursor.model.select', 'dev.aibo.cursor.operation.model-select', { action: 'list' });
if (catalog.output.current !== 'auto' || catalog.output.models.length !== 2) throw new Error('Model catalog missing Auto or premium choice');
const selected = await invoke('select', 'dev.aibo.cursor.model.select', 'dev.aibo.cursor.operation.model-select', { action: 'set', reference: 'premium' });
if (selected.output.current !== 'premium' || selected.output.recovery.data.modelId !== 'premium') throw new Error('Model selection was not persisted');
const levels = await invoke('reasoning-list', 'dev.aibo.cursor.model.reasoning', 'dev.aibo.cursor.operation.model-reasoning', { action: 'list' });
const level = levels.output.levels.at(-1).id;
const reasoning = await invoke('reasoning-set', 'dev.aibo.cursor.model.reasoning', 'dev.aibo.cursor.operation.model-reasoning', { action: 'set', level });
if (reasoning.output.current !== level) throw new Error('Reasoning selection not confirmed');
const window = await invoke('context-set', 'dev.aibo.cursor.model.context-window', 'dev.aibo.cursor.operation.model-context-window', { action: 'set', contextWindow: 'long' });
if (window.output.current !== 'long' || window.output.recovery.data.contextWindow !== 'long') throw new Error('Context selection not persisted');
const premium = await invoke('premium', 'aibo.session.turn', 'dev.aibo.cursor.session.turn', { text: 'hello' }, 'premium-turn');
if (premium.output.status !== 'completed' || !events.some(event => event.payload?.delta === 'AIBO_CURSOR_PREMIUM_OK')) throw new Error('Selected model was not used for the next turn');
await invoke('auto', 'dev.aibo.cursor.model.select', 'dev.aibo.cursor.operation.model-select', { action: 'set', reference: 'auto' });
const turn=await invoke('turn','aibo.session.turn','dev.aibo.cursor.session.turn',{text:'hello'},'smoke-turn');
if(turn.output.status!=='completed'||!events.some(event=>event.type==='message.delta'&&event.payload.delta==='AIBO_CURSOR_OK')||!events.some(event=>event.type==='turn.completed'))throw new Error('Cursor package did not stream and complete the fake turn');
child.stdin.end();
await new Promise((resolve,reject)=>{child.once('exit',code=>code===0?resolve():reject(new Error(`Cursor worker exited ${code}`)));setTimeout(()=>{child.kill('SIGKILL');reject(new Error('Cursor worker did not exit'));},3_000).unref();});
console.log('Cursor packaged worker smoke test passed');
