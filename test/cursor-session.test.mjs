import test from 'node:test';
import assert from 'node:assert/strict';
import { CursorSession, validateExecutionProfile } from '../plugins/cursor/cursor-session.mjs';

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
    if (method === 'session/prompt') return new Promise(resolve => { this.finishPrompt=resolve; });
    throw new Error(`Unexpected request: ${method}`);
  }
  notify(method,params) { this.notifications.push({method,params}); }
  respond(id,result) { this.responses.push({id,result}); }
  respondError(id,code,message) { this.responses.push({id,error:{code,message}}); }
  emitRequest(message) { for (const handler of this.requestHandlers) handler(message); }
  emitNotification(message) { for (const handler of this.notificationHandlers) handler(message); }
  async close() { this.closed=true; }
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

test('创建会话、切换模式、流式输出和权限响应形成闭环', async () => {
  const transport = new FakeTransport();
  const events=[];
  const session = new CursorSession({transportFactory:()=>transport,emit:event=>events.push(event)});
  const opened = await session.open({mode:'create',workspaceId:'w1',workspacePath:'/workspace',executionProfile:editProfile,recovery:null,permissions:['workspace.read','workspace.write']});
  assert.equal(opened.nativeSessionId,'cursor-session-1');
  assert.deepEqual(transport.requests.map(request=>request.method),['initialize','authenticate','session/new','session/set_config_option']);

  const turn = session.prompt({text:'hello',turnId:'turn-1',additionalInstructions:'Be terse'});
  await Promise.resolve();
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'agent_message_chunk',messageId:'m1',content:{type:'text',text:'Hi'}}}});
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call',toolCallId:'t1',title:'Read',kind:'read',status:'pending'}}});
  transport.emitNotification({jsonrpc:'2.0',method:'session/update',params:{sessionId:'cursor-session-1',update:{sessionUpdate:'tool_call_update',toolCallId:'t1',status:'completed'}}});
  transport.emitRequest({jsonrpc:'2.0',id:7,method:'session/request_permission',params:{sessionId:'cursor-session-1',toolCall:{toolCallId:'t2',title:'Edit'},options:[{optionId:'yes-once',kind:'allow_once'},{optionId:'no-once',kind:'reject_once'}]}});
  const approval = events.find(event=>event.type==='approval.requested');
  session.respondApproval(approval.payload.requestId,'accept');
  assert.deepEqual(transport.responses.at(-1),{id:7,result:{outcome:{outcome:'selected',optionId:'yes-once'}}});
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
  const recovery={schema:'dev.aibo.cursor.recovery/v1',nativeSessionId:'old-session',workspaceId:'w1',workspacePath:'/workspace',protocolVersion:1,modeId:'ask'};
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
