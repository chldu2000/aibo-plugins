import test from 'node:test';
import assert from 'node:assert/strict';
import { CursorSession, additionalInstructionsFromSettings, validateExecutionProfile } from '../plugins/cursor/cursor-session.mjs';

class FakeTransport {
  constructor() { this.requests=[];this.responses=[];this.notifications=[];this.requestHandlers=[];this.notificationHandlers=[];this.closed=false; }
  start() { return this; }
  onRequest(handler) { this.requestHandlers.push(handler); return () => {}; }
  onNotification(handler) { this.notificationHandlers.push(handler); return () => {}; }
  async request(method, params) {
    this.requests.push({method,params});
    if (method === 'initialize') return {protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[{id:'cursor_login'}]};
    if (method === 'authenticate') return {};
    if (method === 'session/new') return {sessionId:'cursor-session-1',configOptions:[{id:'mode',currentValue:'ask',options:[{value:'agent'},{value:'plan'},{value:'ask'}]}]};
    if (method === 'session/load') return {configOptions:[{id:'mode',currentValue:'ask',options:[{value:'agent'},{value:'plan'},{value:'ask'}]}]};
    if (method === 'session/set_config_option') return {configOptions:[{id:'mode',currentValue:params.value}]};
    if (method === 'session/prompt') return new Promise((resolve,reject) => { this.finishPrompt=resolve;this.rejectPrompt=reject; });
    throw new Error(`Unexpected request: ${method}`);
  }
  notify(method,params) { this.notifications.push({method,params}); }
  respond(id,result) { this.responses.push({id,result}); }
  respondError(id,code,message) { this.responses.push({id,error:{code,message}}); }
  emitRequest(message) { for (const handler of this.requestHandlers) handler(message); }
  emitNotification(message) { for (const handler of this.notificationHandlers) handler(message); }
  async close() { this.closed=true;this.rejectPrompt?.(new Error('transport closed')); }
  failPrompt(error=new Error('ACP failed')) { this.rejectPrompt?.(error); }
}

const askProfile = {
  schema:'aibo.execution-profile/v1',interactionMode:'ask',approvalPolicy:'never',approvalReviewer:'none',
  filesystemPolicy:'read-only',commandPolicy:'disabled',networkPolicy:'disabled',model:null,reasoningEffort:null,
};
const editProfile = {
  ...askProfile,interactionMode:'edit',approvalPolicy:'on-request',approvalReviewer:'user',
  filesystemPolicy:'workspace-write',commandPolicy:'approved',
};

test('执行配置只开放已实现的安全组合', () => {
  assert.equal(validateExecutionProfile(askProfile,['workspace.read']).mode,'ask');
  assert.equal(validateExecutionProfile(editProfile,['workspace.read','workspace.write']).mode,'agent');
  assert.throws(() => validateExecutionProfile(editProfile,['workspace.read']), /workspace.write/);
  assert.throws(() => validateExecutionProfile({...editProfile,approvalReviewer:'auto-review'},['workspace.read','workspace.write']), /user\/on-request/);
  assert.throws(() => validateExecutionProfile({...askProfile,networkPolicy:'agent-managed'},['workspace.read']), /network/);
  assert.throws(() => validateExecutionProfile({...askProfile,approvalPolicy:'on-request'},['workspace.read']), /no approvals/);
});

test('设置快照必须符合版本与长度约束', () => {
  assert.equal(additionalInstructionsFromSettings(null),'');
  assert.equal(additionalInstructionsFromSettings({schema:'aibo.agent-settings/v1',version:1,values:{additionalInstructions:'Be terse'}}),'Be terse');
  assert.throws(()=>additionalInstructionsFromSettings({schema:'wrong',version:1,values:{additionalInstructions:''}}),/invalid agent settings/);
  assert.throws(()=>additionalInstructionsFromSettings({schema:'aibo.agent-settings/v1',version:1,values:{additionalInstructions:'x'.repeat(8001)}}),/invalid agent settings/);
});

test('创建会话、切换模式、流式输出和权限响应形成闭环', async () => {
  const transport = new FakeTransport();
  const events=[];
  const session = new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  const opened = await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:editProfile,recovery:null,permissions:['workspace.read','workspace.write']});
  assert.equal(opened.nativeSessionId,'cursor-session-1');
  assert.deepEqual(transport.requests.map(request=>request.method),['initialize','authenticate','session/new','session/set_config_option']);

  await assert.rejects(()=>session.prompt({text:'read through edit mode',turnId:'blocked'}),/write-authorized turn/);
  const turn = session.prompt({text:'hello',turnId:'turn-1',additionalInstructions:'Be terse',writable:true});
  await Promise.resolve();
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'agent_message_chunk',messageId:'m1',content:{type:'text',text:'Hi'}}}});
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call',toolCallId:'t1',title:'Read',kind:'read',status:'pending'}}});
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call_update',toolCallId:'t1',status:'completed'}}});
  transport.emitRequest({jsonrpc:'2.0',id:7,method:'session/request_permission',params:{sessionId:'cursor-session-1',toolCall:{toolCallId:'t2',title:'Edit'},options:[{optionId:'yes-once',kind:'allow_once'},{optionId:'no-once',kind:'reject_once'}]}});
  const approval = events.find(event=>event.type==='approval.requested');
  session.respondApproval(approval.payload.requestId,'accept');
  assert.deepEqual(transport.responses.at(-1),{id:7,result:{outcome:{outcome:'selected',optionId:'yes-once'}}});
  transport.emitRequest({jsonrpc:'2.0',id:'network',method:'session/request_permission',params:{sessionId:'cursor-session-1',toolCall:{toolCallId:'t3',title:'Shell',kind:'execute',rawInput:{command:'curl https://example.com'}},options:[{optionId:'yes',kind:'allow_once'},{optionId:'no',kind:'reject_once'}]}});
  assert.deepEqual(transport.responses.at(-1),{id:'network',result:{outcome:{outcome:'selected',optionId:'no'}}});
  transport.emitRequest({jsonrpc:'2.0',id:'foreign',method:'session/request_permission',params:{sessionId:'another-session',options:[]}});
  assert.deepEqual(transport.responses.at(-1),{id:'foreign',result:{outcome:{outcome:'cancelled'}}});
  transport.finishPrompt({stopReason:'end_turn'});
  const result = await turn;
  assert.equal(result.status,'completed');
  assert.equal(events.filter(event=>event.type==='turn.completed').length,1);
  assert.ok(events.some(event=>event.type==='message.delta'));
  assert.ok(events.some(event=>event.type==='message.completed'));
  const tool=events.find(event=>event.type==='tool.completed');
  assert.deepEqual({itemId:tool.payload.itemId,itemType:tool.payload.itemType,summary:tool.payload.summary},{itemId:'t1',itemType:'read',summary:'Read'});
  assert.equal(transport.requests.find(request=>request.method==='session/prompt').params.prompt[0].text,'Be terse\n\nhello');
});

test('问题响应校验选项，恢复绑定工作区并隔离历史回放', async () => {
  const transport = new FakeTransport();
  const events=[];
  const session = new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  const recovery={schema:'dev.aibo.cursor.recovery',version:1,data:{nativeSessionId:'old-session',workspaceId:'w1',workspacePath:'/workspace',protocolVersion:1,modeId:'ask'}};
  await session.open({mode:'resume',workspaceId:'w1',workspacePath:'/workspace',executionProfile:askProfile,recovery,permissions:['workspace.read']});
  assert.equal(session.sessionId,'old-session');
  assert.ok(transport.requests.some(request=>request.method==='session/load'));
  await assert.rejects(() => session.open({mode:'resume',workspaceId:'w2',workspacePath:'/other',executionProfile:askProfile,recovery,permissions:['workspace.read']}), /already open/);

  const turn=session.prompt({text:'choose',turnId:'turn-2'});
  await Promise.resolve();
  transport.emitRequest({jsonrpc:'2.0',id:8,method:'session/request_permission',params:{toolCall:{toolCallId:'blocked',title:'Run command',kind:'execute'},options:[{optionId:'deny',kind:'reject_once'}]}});
  assert.deepEqual(transport.responses.at(-1),{id:8,result:{outcome:{outcome:'selected',optionId:'deny'}}});
  assert.equal(events.some(event=>event.type==='approval.requested'),false);
  transport.emitRequest({jsonrpc:'2.0',id:'q1',method:'cursor/ask_question',params:{questions:[{id:'color',prompt:'Color?',options:[{id:'blue',label:'Blue'}],allowMultiple:false}]}});
  const requested=events.find(event=>event.type==='user_input.requested');
  assert.throws(()=>session.respondUserInput(requested.payload.requestId,{color:'red'}),/invalid option/);
  session.respondUserInput(requested.payload.requestId,{color:'blue'});
  assert.deepEqual(transport.responses.at(-1),{id:'q1',result:{outcome:{outcome:'answered',answers:[{questionId:'color',selectedOptionIds:['blue']}]}}});
  await session.cancel();
  assert.deepEqual(transport.notifications.at(-1),{method:'session/cancel',params:{sessionId:'old-session'}});
  transport.finishPrompt({stopReason:'cancelled'});
  assert.equal((await turn).status,'interrupted');
});

test('多段消息和工具只生成各自唯一终态，未知停止原因失败', async () => {
  const transport=new FakeTransport();const events=[];
  const session=new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:askProfile,recovery:null,permissions:['workspace.read']});
  await assert.rejects(()=>session.prompt({text:'write through ask mode',turnId:'blocked',writable:true}),/requires edit mode/);
  const turn=session.prompt({text:'hello',turnId:'turn-segments'});await Promise.resolve();
  const update=value=>transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:value}});
  update({sessionUpdate:'agent_message_chunk',messageId:'m1',content:{type:'text',text:'first'}});
  update({sessionUpdate:'agent_message_chunk',messageId:'m2',content:{type:'text',text:'second'}});
  update({sessionUpdate:'tool_call',toolCallId:'done',title:'Done immediately',kind:'read',status:'completed'});
  update({sessionUpdate:'tool_call_update',toolCallId:'done',status:'completed'});
  transport.finishPrompt({stopReason:'future_reason'});
  assert.equal((await turn).status,'failed');
  assert.deepEqual(events.filter(event=>event.type==='message.completed').map(event=>event.payload.text),['first','second']);
  assert.equal(events.filter(event=>event.type==='tool.completed').length,1);
  assert.equal(events.filter(event=>event.type==='turn.failed').length,1);
  assert.equal(events.filter(event=>event.type==='turn.completed').length,0);
});

test('prompt transport failure closes the generation and host close stays stopped', async () => {
  const transport=new FakeTransport();const events=[];
  const session=new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:askProfile,recovery:null,permissions:['workspace.read']});
  const failed=session.prompt({text:'fail',turnId:'turn-fail'});await Promise.resolve();
  transport.failPrompt(new Error('connection lost'));
  await assert.rejects(failed,/connection lost/);
  assert.equal(transport.closed,true);
  assert.equal(session.phase,'failed');
  assert.equal(events.filter(event=>event.type==='turn.failed').length,1);

  const secondTransport=new FakeTransport();
  const second=new CursorSession({transportFactory:()=>secondTransport});
  await second.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:askProfile,recovery:null,permissions:['workspace.read']});
  const pending=second.prompt({text:'close',turnId:'turn-close'});await Promise.resolve();
  await second.close();
  await assert.rejects(pending,/transport closed/);
  assert.equal(second.phase,'stopped');
});

test('强制取消关闭传输、结算交互并返回 interrupted', async () => {
  const transport=new FakeTransport();const events=[];
  const session=new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event),cancelGraceMs:5});
  await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:editProfile,recovery:null,permissions:['workspace.read','workspace.write']});
  const turn=session.prompt({text:'wait',turnId:'turn-cancel',writable:true});await Promise.resolve();
  transport.emitRequest({jsonrpc:'2.0',id:'approval',method:'session/request_permission',params:{sessionId:'cursor-session-1',toolCall:{toolCallId:'edit',title:'Edit'},options:[{optionId:'allow',kind:'allow_once'}]}});
  transport.emitRequest({jsonrpc:'2.0',id:'question',method:'cursor/ask_question',params:{sessionId:'cursor-session-1',questions:[{id:'q',options:[],allowMultiple:false}]}});
  await session.cancel();
  assert.deepEqual(transport.notifications.at(-1),{method:'session/cancel',params:{sessionId:'cursor-session-1'}});
  assert.equal(transport.responses.filter(response=>response.result?.outcome?.outcome==='cancelled').length,2);
  await new Promise(resolve=>setTimeout(resolve,15));
  assert.equal(transport.closed,true);
  assert.equal((await turn).status,'interrupted');
  assert.equal(events.filter(event=>event.type==='turn.completed').length,1);
  assert.equal(events.filter(event=>event.type==='turn.failed').length,0);
  assert.equal(events.filter(event=>event.type==='approval.resolved').length,1);
  assert.equal(events.filter(event=>event.type==='user_input.resolved').length,1);
});

test('计划和多选问题按带类型请求 ID 独立闭环', async () => {
  const transport=new FakeTransport();const events=[];
  const session=new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:editProfile,recovery:null,permissions:['workspace.read','workspace.write']});
  const turn=session.prompt({text:'plan',turnId:'turn-interactions',writable:true});await Promise.resolve();
  transport.emitRequest({jsonrpc:'2.0',id:1,method:'cursor/create_plan',params:{sessionId:'cursor-session-1',name:'Plan',plan:'1. Inspect\n2. Edit'}});
  transport.emitRequest({jsonrpc:'2.0',id:'1',method:'cursor/ask_question',params:{sessionId:'cursor-session-1',questions:[{id:'files',prompt:'Files?',options:[{id:'a',label:'A'},{id:'b',label:'B'}],allowMultiple:true}]}});
  const plan=events.find(event=>event.type==='approval.requested'&&event.payload.kind==='plan');
  const question=events.find(event=>event.type==='user_input.requested');
  assert.notEqual(plan.payload.requestId,question.payload.requestId);
  session.respondApproval(plan.payload.requestId,'accept');
  session.respondUserInput(question.payload.requestId,{files:['a','b']});
  assert.deepEqual(transport.responses.find(response=>response.id===1),{id:1,result:{outcome:{outcome:'accepted'}}});
  assert.deepEqual(transport.responses.find(response=>response.id==='1'),{id:'1',result:{outcome:{outcome:'answered',answers:[{questionId:'files',selectedOptionIds:['a','b']}]}}});
  assert.ok(events.some(event=>event.type==='extension.updated'&&event.payload.kind==='plan'&&event.payload.plan.includes('Inspect')));
  transport.finishPrompt({stopReason:'end_turn'});
  assert.equal((await turn).status,'completed');
});

test('Cursor task 映射为无重复工具卡的子 Agent 生命周期', async () => {
  const transport=new FakeTransport();const events=[];
  const session=new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:askProfile,recovery:null,permissions:['workspace.read']});
  const turn=session.prompt({text:'delegate',turnId:'turn-subagent'});await Promise.resolve();
  const notify=(method,params)=>transport.emitNotification({jsonrpc:'2.0',method,params});
  notify('session/update',{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call',toolCallId:'task-1',title:'Task: inspect tests',kind:'other',status:'pending',rawInput:{_toolName:'task',prompt:'Inspect tests',description:'Repository explorer',subagentType:'explore'}}});
  notify('session/update',{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call_update',toolCallId:'task-1',status:'completed'}});
  notify('cursor/task',{toolCallId:'task-1',description:'Repository explorer',prompt:'Inspect tests',subagentType:'explore',agentId:'native-child',durationMs:42});
  transport.finishPrompt({stopReason:'end_turn'});
  assert.equal((await turn).status,'completed');
  const updates=events.filter(event=>event.type==='subagent.updated');
  assert.deepEqual(updates.map(event=>event.payload.status),['running','waiting','completed']);
  assert.ok(updates.every(event=>event.turnId===null&&event.payload.rootTurnId==='turn-subagent'));
  assert.deepEqual(updates.at(-1).payload,{id:'task-1',parentId:'cursor-session-1',rootTurnId:'turn-subagent',name:'explore',task:'Inspect tests',status:'completed',activity:'Completed in 42 ms.'});
  assert.equal(events.some(event=>event.type.startsWith('tool.')&&event.correlation?.toolCallId==='task-1'),false);
  assert.equal(events.some(event=>event.type==='subagent.message'),false);
});

test('缺少 Cursor task 尾部通知时子 Agent 明确降级为 unavailable', async () => {
  const transport=new FakeTransport();const events=[];
  const session=new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:askProfile,recovery:null,permissions:['workspace.read']});
  const turn=session.prompt({text:'delegate',turnId:'turn-missing-task'});await Promise.resolve();
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call',toolCallId:'task-missing',title:'Task',kind:'other',status:'pending',rawInput:{_toolName:'task',prompt:'Inspect'}}}});
  transport.finishPrompt({stopReason:'end_turn'});
  await turn;
  assert.equal(events.filter(event=>event.type==='subagent.updated').at(-1).payload.status,'unavailable');
});

test('取消父回合时未完成的 Cursor 子 Agent 收敛为 interrupted', async () => {
  const transport=new FakeTransport();const events=[];
  const session=new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:askProfile,recovery:null,permissions:['workspace.read']});
  const turn=session.prompt({text:'delegate',turnId:'turn-cancel-task'});await Promise.resolve();
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call',toolCallId:'task-cancel',title:'Task',kind:'other',status:'pending',rawInput:{_toolName:'task',prompt:'Inspect'}}}});
  await session.cancel();transport.finishPrompt({stopReason:'cancelled'});
  assert.equal((await turn).status,'interrupted');
  assert.equal(events.filter(event=>event.type==='subagent.updated').at(-1).payload.status,'interrupted');
});

class ModelTransport extends FakeTransport {
  constructor() { super(); this.model = 'auto'; this.mode = 'ask'; }
  config() { return { configOptions: [
    { id: 'mode', type: 'select', currentValue: this.mode, options: ['ask', 'agent', 'plan'].map(value => ({ value })) },
    { id: 'model', category: 'model', type: 'select', currentValue: this.model, options: [
      { value: 'auto', name: 'Auto' }, { value: 'premium', name: 'Premium', description: 'A model listed before entitlement checking' },
    ] },
  ] }; }
  async request(method, params) {
    if (['session/new', 'session/load', 'session/set_config_option'].includes(method)) {
      this.requests.push({ method, params });
      if (method === 'session/set_config_option') {
        if (this.rejectSelection) throw new Error('Model selection denied');
        if (this.deferSelection) await this.deferSelection;
        if (params.configId === 'mode') this.mode = params.value;
        else if (!this.ignoreSelection) this.model = params.value;
      }
      return { sessionId: 'cursor-session-1', ...this.config() };
    }
    return super.request(method, params);
  }
}
const openModelSession = (session, overrides = {}) => session.open({ mode: 'create', workspaceId: 'w1', workspacePath: '/workspace', executionProfile: askProfile, permissions: ['workspace.read'], ...overrides });

test('model catalog preserves Auto and premium choices; selection affects the next ACP turn', async () => {
  const transport = new ModelTransport(), session = new CursorSession({ transportFactory: () => transport });
  const opened = await openModelSession(session);
  assert.ok(opened.capabilities.includes('model.select'));
  const catalog = await session.models({ action: 'list' });
  assert.equal(catalog.current, 'auto');
  assert.deepEqual(catalog.models.map(model => model.displayName), ['Auto', 'Premium']);
  assert.equal((await session.models({ action: 'set', reference: 'premium' })).current, 'premium');
  assert.equal(session.recovery().data.modelId, 'premium');
  const turn = session.prompt({ text: 'hello', turnId: 'model-turn' });
  assert.equal(transport.model, 'premium');
  await assert.rejects(session.models({ action: 'set', reference: 'auto' }), /idle session/);
  transport.finishPrompt({ stopReason: 'end_turn' });
  await turn;
  await session.close();
});

test('model restore applies saved selection; host profile overrides recovery and old recovery remains valid', async () => {
  const first = new CursorSession({ transportFactory: () => new ModelTransport() });
  await openModelSession(first);
  await first.models({ action: 'set', reference: 'premium' });
  const recovery = first.recovery(); await first.close();
  for (const [model, expected] of [[null, 'premium'], ['auto', 'auto']]) {
    const transport = new ModelTransport(), session = new CursorSession({ transportFactory: () => transport });
    await openModelSession(session, { mode: 'resume', recovery, executionProfile: { ...askProfile, model } });
    assert.equal(transport.model, expected);
    assert.equal((await session.models({ action: 'list' })).current, expected);
    await session.close();
  }
  delete recovery.data.modelId;
  const legacy = new CursorSession({ transportFactory: () => new ModelTransport() });
  await openModelSession(legacy, { mode: 'resume', recovery });
  assert.equal((await legacy.models({ action: 'list' })).current, 'auto');
  await legacy.close();
});

test('missing model config does not advertise model selection or silently accept requested models', async () => {
  const session = new CursorSession({ transportFactory: () => new FakeTransport() });
  assert.equal((await openModelSession(session)).capabilities.includes('model.select'), false);
  await assert.rejects(session.models({ action: 'list' }), /did not provide/);
  await session.close();
  await assert.rejects(openModelSession(session, { executionProfile: { ...askProfile, model: 'auto' } }), /did not provide/);
});

test('configuration updates refresh idle model state and ignore foreign sessions', async () => {
  const transport = new ModelTransport(), session = new CursorSession({ transportFactory: () => transport });
  await openModelSession(session);
  transport.model = 'premium';
  const notify = sessionId => transport.emitNotification({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'config_option_update', ...transport.config() } } });
  notify('foreign'); assert.equal((await session.models({ action: 'list' })).current, 'auto');
  notify(session.sessionId); assert.equal((await session.models({ action: 'list' })).current, 'premium');
  await session.close();
});

test('model validation and backend rejection never fake selection success', async () => {
  const transport = new ModelTransport(), session = new CursorSession({ transportFactory: () => transport });
  await openModelSession(session);
  const before = transport.requests.length;
  await assert.rejects(session.models({ action: 'set', reference: 'unknown' }), /not in the session catalog/);
  assert.equal(transport.requests.length, before);
  transport.rejectSelection = true;
  await assert.rejects(session.models({ action: 'set', reference: 'premium' }), /Model selection denied/);
  assert.equal((await session.models({ action: 'list' })).current, 'auto');
  transport.rejectSelection = false; transport.ignoreSelection = true;
  await assert.rejects(session.models({ action: 'set', reference: 'premium' }), /did not confirm/);
  assert.equal((await session.models({ action: 'list' })).current, 'auto');
  await session.close();
});

test('late model response cannot modify a closed session', async () => {
  const transport = new ModelTransport(), session = new CursorSession({ transportFactory: () => transport });
  await openModelSession(session);
  let finish;
  transport.deferSelection = new Promise(resolve => { finish = resolve; });
  const selection = session.models({ action: 'set', reference: 'premium' });
  await session.close(); finish();
  await assert.rejects(selection, /session changed/);
  assert.equal(session.phase, 'stopped');
  assert.equal(session.capabilities().includes('model.select'), false);
});

test('listed premium model can fail at prompt time and preserves the actual entitlement error', async () => {
  const transport = new ModelTransport(), events = [], session = new CursorSession({ transportFactory: () => transport, emit: event => events.push(event) });
  await openModelSession(session);
  await session.models({ action: 'set', reference: 'premium' });
  const turn = session.prompt({ text: 'hello', turnId: 'denied' });
  transport.failPrompt(new Error('This model requires a paid subscription'));
  await assert.rejects(turn, /requires a paid subscription/);
  assert.equal(events.find(event => event.type === 'turn.failed').payload.message, 'This model requires a paid subscription');
});

class ParameterTransport extends FakeTransport {
  constructor() { super(); this.model = 'auto'; this.values = { thinking: 'true', effort: 'medium', context: '200k', fast: 'false' }; }
  configs() {
    const select = (id, category, values) => ({ id, name: id, category, type: 'select', currentValue: this.values[id], options: values.map(value => ({ value, name: value.toUpperCase() })) });
    return [{ id: 'mode', currentValue: 'ask', options: [{ value: 'ask' }] },
      { id: 'model', type: 'select', category: 'model', description: 'Controls which model is used for responses', currentValue: this.model, options: ['auto', 'claude', 'gpt'].map(value => ({ value, name: value })) },
      ...(this.model === 'auto' ? [] : [
        ...(this.model === 'claude' ? [select('thinking', 'thought_level', ['false', 'true'])] : []),
        select('effort', 'thought_level', ['low', 'medium', 'max']),
        select('context', 'model_config', ['200k', '1m']), select('fast', 'model_config', ['false', 'true']),
      ])];
  }
  async request(method, params) {
    if (['session/new', 'session/load', 'session/set_config_option'].includes(method)) {
      this.requests.push({ method, params });
      if (method === 'session/set_config_option') {
        if (this.reject) throw new Error('configuration denied');
        if (!this.ignore) {
          if (params.configId === 'model') this.model = params.value;
          else this.values[params.configId] = params.value;
        }
      }
      return { sessionId: 'cursor-session-1', configOptions: this.configs() };
    }
    return super.request(method, params);
  }
}
const parameterOpen = { mode: 'create', workspaceId: 'w1', workspacePath: '/workspace', executionProfile: askProfile, permissions: ['workspace.read'] };

test('parameterized negotiation, model-scoped reasoning combinations and independent context selection', async () => {
  const transport = new ParameterTransport();
  const session = new CursorSession({ transportFactory: () => transport });
  const opened = await session.open(parameterOpen);
  assert.ok(opened.capabilities.includes('model.reasoning'));
  assert.ok(opened.capabilities.includes('model.context-window'));
  assert.equal(transport.requests[0].params.clientCapabilities._meta.parameterizedModelPicker, true);
  assert.deepEqual((await session.configure('reasoning', { action: 'list' })).levels, []);
  await session.models({ action: 'set', reference: 'claude' });
  const catalog = await session.models({ action: 'list' });
  assert.equal(catalog.models.find(model => model.id === 'claude').reasoningEfforts.length, 6);
  assert.deepEqual(catalog.models.find(model => model.id === 'gpt').contextWindows, []);
  assert.deepEqual(catalog.models.find(model => model.id === 'claude').contextWindows, [{ id: '200k', label: '200K' }, { id: '1m', label: '1M' }]);
  const level = (await session.configure('reasoning', { action: 'list' })).levels.find(level => level.label === 'thinking: FALSE · effort: MAX');
  assert.equal((await session.configure('reasoning', { action: 'set', level: level.id })).current, level.id);
  await session.configure('context', { action: 'set', contextWindow: '1m' });
  assert.equal((await session.models({ action: 'list' })).currentContextWindow, '1m');
  assert.equal(transport.values.fast, 'false');
  assert.equal(transport.values.effort, 'max');
  const turn = session.prompt({ text: 'test', turnId: 'parameters' });
  await assert.rejects(session.configure('context', { action: 'set', contextWindow: '200k' }), /idle session/);
  transport.finishPrompt({ stopReason: 'end_turn' }); await turn;
  await session.models({ action: 'set', reference: 'gpt' });
  await assert.rejects(session.configure('reasoning', { action: 'set', level: level.id }), /current model catalog/);
  await session.close();
});

test('parameter recovery replays native values and explicit model change discards old settings', async () => {
  let transport = new ParameterTransport();
  const session = new CursorSession({ transportFactory: () => transport });
  await session.open({ ...parameterOpen, executionProfile: { ...askProfile, model: 'claude' } });
  const level = (await session.configure('reasoning', { action: 'list' })).levels.at(-1).id;
  await session.configure('reasoning', { action: 'set', level });
  await session.configure('context', { action: 'set', contextWindow: '1m' });
  const recovery = session.recovery(); await session.close(); transport = new ParameterTransport();
  await session.open({ ...parameterOpen, mode: 'resume', recovery });
  assert.equal((await session.configure('reasoning', { action: 'list' })).current, level);
  assert.equal((await session.models({ action: 'list' })).currentContextWindow, '1m');
  await session.close(); transport = new ParameterTransport();
  await session.open({ ...parameterOpen, mode: 'resume', recovery, executionProfile: { ...askProfile, model: 'gpt' } });
  assert.equal(transport.values.effort, 'medium');
  assert.equal(transport.values.context, '200k');
  await session.close();
});

test('parameter validation, denied and unconfirmed changes retain truthful state', async () => {
  const transport = new ParameterTransport();
  const session = new CursorSession({ transportFactory: () => transport });
  await session.open({ ...parameterOpen, executionProfile: { ...askProfile, model: 'gpt' } });
  await assert.rejects(session.configure('context', { action: 'set', contextWindow: 'fake' }), /current model catalog/);
  transport.reject = true;
  await assert.rejects(session.configure('context', { action: 'set', contextWindow: '1m' }), /denied/);
  transport.reject = false; transport.ignore = true;
  await assert.rejects(session.configure('context', { action: 'set', contextWindow: '1m' }), /did not confirm/);
  assert.equal((await session.models({ action: 'list' })).currentContextWindow, '200k');
  assert.equal(session.phase, 'ready');
  await session.close();
});

test('late parameter response cannot revive a closed session', async () => {
  const transport = new ParameterTransport();
  const session = new CursorSession({ transportFactory: () => transport });
  await session.open({ ...parameterOpen, executionProfile: { ...askProfile, model: 'gpt' } });
  let finish;
  transport.request = () => new Promise(resolve => { finish = resolve; });
  const setting = session.configure('context', { action: 'set', contextWindow: '1m' });
  await session.close(); finish({ configOptions: transport.configs() });
  await assert.rejects(setting, /session changed/);
  assert.equal(session.phase, 'stopped');
  assert.equal(session.modelConfig, null);
});

test('partial reasoning failure exposes confirmed state without claiming the full combination', async () => {
  const transport = new ParameterTransport();
  const session = new CursorSession({ transportFactory: () => transport });
  await session.open({ ...parameterOpen, executionProfile: { ...askProfile, model: 'claude' } });
  const level = (await session.configure('reasoning', { action: 'list' })).levels.find(level => level.label === 'thinking: FALSE · effort: MAX').id;
  const request = transport.request.bind(transport);
  transport.request = (method, params) => {
    if (params.configId === 'effort') throw new Error('effort denied');
    return request(method, params);
  };
  await assert.rejects(session.configure('reasoning', { action: 'set', level }), /effort denied/);
  const actual = await session.configure('reasoning', { action: 'list' });
  assert.notEqual(actual.current, level);
  assert.equal(actual.levels.find(level => level.id === actual.current).label, 'thinking: FALSE · effort: MEDIUM');
  assert.equal(actual.recovery.data.reasoningEffort, actual.current);
  await session.close();
});

const commandUpdate = (sessionId, availableCommands) => ({ method: 'session/update', params: { sessionId, update: { sessionUpdate: 'available_commands_update', availableCommands } } });

test('native command menu waits for the initial notification, then replaces idle updates', async () => {
  const transport = new FakeTransport();
  const session = new CursorSession({ transportFactory: () => transport, commandWaitMs: 50 });
  await session.open(parameterOpen);
  assert.ok(session.capabilities().includes('command.list'));
  const pending = session.commands();
  transport.emitNotification(commandUpdate(session.sessionId, [{ name: 'review', description: 'Review changes', input: { hint: '[scope]' } }]));
  const result = await pending;
  assert.deepEqual(result.commands, [{ name: 'review', description: 'Review changes', source: 'agent', category: 'agent', execution: 'prompt', argumentHint: '[scope]' }]);
  transport.emitNotification(commandUpdate('foreign', [{ name: 'wrong' }]));
  assert.deepEqual(await session.commands(), result);
  transport.emitNotification(commandUpdate(session.sessionId, []));
  assert.deepEqual(await session.commands(), { commands: [] });
  await session.close();
});

test('commands arriving before open/load response survive without leaking old generation data', async () => {
  let transport = new FakeTransport();
  const session = new CursorSession({ transportFactory: () => transport, commandWaitMs: 5 });
  const wrap = (transport, id) => {
    const original = transport.request.bind(transport);
    transport.request = async (method, params) => {
      if (['session/new', 'session/load'].includes(method)) transport.emitNotification(commandUpdate(id, [{ name: 'native' }]));
      return original(method, params);
    };
  };
  wrap(transport, 'cursor-session-1');
  await session.open(parameterOpen);
  assert.equal((await session.commands()).commands[0].name, 'native');
  const recovery = session.recovery(), old = transport;
  await session.close(); transport = new FakeTransport(); wrap(transport, recovery.data.nativeSessionId);
  await session.open({ ...parameterOpen, mode: 'resume', recovery });
  old.emitNotification(commandUpdate(recovery.data.nativeSessionId, [{ name: 'stale' }]));
  assert.equal((await session.commands()).commands[0].name, 'native');
  await session.close();
});

test('missing command notifications time out; close releases pending reads and malformed entries are excluded', async () => {
  const transport = new FakeTransport();
  const session = new CursorSession({ transportFactory: () => transport, commandWaitMs: 5 });
  await session.open(parameterOpen);
  assert.deepEqual(await session.commands(), { commands: [] });
  transport.emitNotification(commandUpdate(session.sessionId, [null, {}, { name: '/bad' }, { name: 'two words' }, { name: 'okay' }, { name: 'okay' }]));
  assert.deepEqual((await session.commands()).commands.map(command => command.name), ['okay']);
  await session.close();
  const next = new CursorSession({ transportFactory: () => new FakeTransport(), commandWaitMs: 1000 });
  await next.open(parameterOpen);
  const pending = next.commands();
  await next.close();
  await assert.rejects(pending, /session changed/);
});

test('slash commands retain their leading slash and exact arguments despite additional instructions', async () => {
  const transport = new FakeTransport();
  const session = new CursorSession({ transportFactory: () => transport });
  await session.open(parameterOpen);
  const turn = session.prompt({ text: '/review staged', turnId: 'command', additionalInstructions: 'Be terse' });
  assert.deepEqual(transport.requests.at(-1).params.prompt, [{ type: 'text', text: '/review staged' }]);
  transport.finishPrompt({ stopReason: 'end_turn' }); await turn;
  await session.close();
});
