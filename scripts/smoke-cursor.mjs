import { spawn } from 'node:child_process';
import { readFile, writeFile, unlink } from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {contract, sdkPreload} from './host.mjs';
import {jsonlRpc} from './jsonl-rpc.mjs';

const packagePath = process.argv[2];
const fakeBin = process.argv[3];
const consumer = process.argv[4];
if (!packagePath || !fakeBin || !consumer) throw new Error('Usage: smoke-cursor.mjs <package> <fake-bin> <sdk-directory>');

const require = createRequire(import.meta.url);
const Ajv = require('ajv/dist/2020').default;
const ajv = new Ajv({strict:false});
const features = await contract('session-features.v1.json');

const child = spawn(process.execPath,['--import',sdkPreload(consumer),path.join(packagePath,'worker.mjs')],{
  cwd:packagePath,env:{...process.env,AIBO_TEST_MCP_CLIENT:pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/index.js')).href,AIBO_TEST_MCP_TRANSPORT:pathToFileURL(require.resolve('@modelcontextprotocol/sdk/client/stdio.js')).href,PATH:`${fakeBin}${path.delimiter}${process.env.PATH ?? ''}`},stdio:['pipe','pipe','inherit'],
});
const events=[];
const {send,close}=jsonlRpc(child,message=>{
  if(message.method==='capability.event'){
    const event=message.params.event;events.push(event);
    if(event.type==='workspace.requested'){
      assert.equal(event.payload.tool,'aibo_read_session');
      const operation=manifest.contributions[0].operations.find(op=>op.capability.id==='aibo.session.tool.respond');
      void send('capability.control',{instanceId:identity.instanceId,generationId:identity.generationId,contributionId:identity.contributionId,invocationId:message.params.invocationId,capability:operation.capability.id,contractVersion:'1.0.0',operationId:operation.id,input:{requestId:event.payload.requestId,result:{source:'persisted-core',sessionId:'source',referenceCapturedAt:'now',readSnapshotId:'snapshot',readCapturedAt:'now',throughMessageId:null,historyScope:'fixture',format:'jsonl',content:'AIBO_HISTORY_MCP_OK',offset:0,nextCursor:null,complete:true}}});
    }
  }
});
const manifest=JSON.parse(await readFile(path.join(packagePath,'plugin.json'),'utf8'));
const identity={protocol:'2.1',instanceId:'smoke-instance',generationId:'smoke-generation',installationId:'smoke-installation',pluginId:manifest.pluginId,pluginVersion:manifest.version,contributionId:'dev.aibo.cursor.agent',privateData:{path:packagePath,formatVersion:1}};
const initialized=await send('capability.initialize',identity);
if(initialized.protocol!=='2.1')throw new Error('Cursor package did not negotiate Runtime 2.1');
const hostTools=await contract('host-tools.v1.json');
const context={hostTools,turnId:null,workspaceId:'smoke-workspace',workspacePath:packagePath,originalCaller:{kind:'window',id:'smoke-window'},permissions:['workspace.read'],callChain:[]};
const invoke=async(invocationId,capability,operationId,input,turnId=null)=>{
  const result=await send('capability.invoke',{invocationId,instanceId:identity.instanceId,generationId:identity.generationId,contributionId:identity.contributionId,capability,contractVersion:'1.0.0',operationId,scope:{kind:'session',id:'smoke-session'},deadlineUnixMs:Date.now()+30_000,context:{...context,turnId},input});
  const operation=manifest.contributions[0].operations.find(op=>op.capability.id===capability);
  assert.ok(operation, capability);
  const validate=ajv.compile(operation.outputSchema);
  assert.ok(validate(result.output), `${capability}: ${JSON.stringify(validate.errors)}`);
  return result;
};
const profile={schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'never',approvalReviewer:'none',filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'agent-managed',model:null,reasoningEffort:null};
const opened=await invoke('open','aibo.session.open','dev.aibo.cursor.session.open',{mode:'create',executionProfile:profile,recovery:null});
assert.ok(opened.output.capabilities.includes('host-tools'));
await invoke('history','aibo.session.turn','dev.aibo.cursor.session.turn',{text:'host history fixture'},'history-turn');
assert.ok(events.some(event=>event.type==='message.completed'&&event.payload.text.includes('AIBO_HISTORY_MCP_OK')));
if(opened.output.nativeSessionId!=='fake-cursor-session')throw new Error('Cursor package did not open the fake ACP session');
if (!opened.output.capabilities.includes('model.select')) throw new Error('Cursor package did not negotiate model selection');
if (!opened.output.capabilities.includes('command.list')) throw new Error('Cursor package did not negotiate command directory');
for (const name of ['model.select','model.reasoning','model.context-window','command.list','approval.respond','user-input.respond']) {
  assert.ok(opened.output.capabilities.includes(name), name);
  const operation=manifest.contributions[0].operations.find(op=>op.capability.id===`${manifest.pluginId}.${name}`);
  assert.ok(features.capabilities[name].some(shape=>isDeepStrictEqual(shape.inputSchema,operation.inputSchema)&&isDeepStrictEqual(shape.outputSchema,operation.outputSchema)),name);
  assert.ok(initialized.operations.some(op=>op.capability===operation.capability.id&&op.version===operation.capability.version&&op.operationId===operation.id),name);
}
const commands = await invoke('commands', 'dev.aibo.cursor.command.list', 'dev.aibo.cursor.operation.command-list', {});
if (!commands.output.commands.some(command => command.name === 'copy-request-id' && command.execution === 'prompt' && command.insertionText === '/copy-request-id ')) throw new Error('Native command missing from menu');
await invoke('native-command', 'aibo.session.turn', 'dev.aibo.cursor.session.turn', { text: '/copy-request-id' }, 'command-turn');
if (!events.some(event => event.type === 'message.completed' && event.payload.text === 'AIBO_NATIVE_COMMAND_OK')) throw new Error('Native command was not sent through the normal turn path');
const catalog = await invoke('models', 'dev.aibo.cursor.model.select', 'dev.aibo.cursor.operation.model-select', { action: 'list' });
if (catalog.output.current !== 'auto' || catalog.output.models.length !== 2) throw new Error('Model catalog missing Auto or premium choice');
await assert.rejects(invoke('invalid-select', 'dev.aibo.cursor.model.select', 'dev.aibo.cursor.operation.model-select', {action:'set'}));
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
const imagePath=path.join(packagePath,'smoke-image.png');
await writeFile(imagePath,Buffer.from('89504e470d0a1a0a','hex'));
try {
  const imageTurn=await invoke('image-turn','aibo.session.turn','dev.aibo.cursor.session.turn',{text:'image smoke',attachments:[{attachmentId:'image',type:'image',path:imagePath,mimeType:'image/png'}]},'image-turn');
  assert.equal(imageTurn.output.status,'completed');
} finally { await unlink(imagePath); }
let recovery = turn.output.recovery;
for (const control of manifest.contributions[0].sessionControls) {
  await invoke(`close-${control.id}`, 'aibo.session.close', 'dev.aibo.cursor.session.close', {});
  const opened = await invoke(`open-${control.id}`, 'aibo.session.open', 'dev.aibo.cursor.session.open', {mode:'resume',executionProfile:{...profile,...control.profile},recovery});
  assert.equal(opened.output.recovery.data.modeId, control.id);
  assert.ok(opened.output.capabilities.includes('host-tools'));
  assert.equal(opened.output.recovery.data.hostMcpServerName,recovery.data.hostMcpServerName);
  const write = control.id === 'agent';
  const capability = write ? 'aibo.session.turn.write' : 'aibo.session.turn';
  const operation = manifest.contributions[0].operations.find(op => op.capability.id === capability);
  if (write) {
    await assert.rejects(invoke('unauthorized-native-write', capability, operation.id, {text:'hello'}, 'unauthorized-turn'), /workspace.write/);
    context.permissions.push('workspace.write');
  }
  const result = await invoke(`turn-${control.id}`, capability, operation.id, {text:'hello'}, `mode-turn-${control.id}`);
  assert.equal(result.output.status, 'completed');
  recovery = result.output.recovery;
  context.permissions = ['workspace.read'];
}
await close();
console.log('Cursor packaged worker smoke test passed');
