import test from 'node:test';
import assert from 'node:assert/strict';
import { AcpSession } from '@aibolabs/acp-adapter';
import { claudeBackgroundNotification } from '../plugins/claude-code/claude-background-tasks.mjs';

test('Claude async task lifecycle stays readable after prompt completion and does not become a subagent', async () => {
  let notify, finish;
  const transport = {closed:false,start(){return this;},onRequest(){return ()=>{};},onNotification(fn){notify=fn;return ()=>{};},
    async request(method) {
      if(method==='initialize')return {protocolVersion:1,agentCapabilities:{loadSession:true}};
      if(method==='session/new')return {sessionId:'native',modes:{currentModeId:'ask',availableModes:[{id:'ask'}]}};
      if(method==='session/prompt')return new Promise(resolve=>{finish=resolve;});
      throw Error(method);
    },async close(){this.closed=true;},notify(){},respond(){}};
  const events=[];
  const session=new AcpSession({transportFactory:()=>transport,emit:e=>events.push(e),extension:{label:'Claude',command:'claude',recoverySchema:'test',namespace:'test',writableMode:'edit',capabilities:['background-tasks.list'],validateExecutionProfile:profile=>({mode:'ask',profile}),handleNotification:claudeBackgroundNotification}});
  await session.open({mode:'create',workspaceId:'w',workspacePath:'/w',executionProfile:{},permissions:['workspace.read']});
  const turn=session.prompt({text:'run eval',turnId:'parent'});
  const send=update=>notify({method:'session/update',params:{sessionId:'native',update}});
  send({sessionUpdate:'tool_call',toolCallId:'bash',kind:'execute',title:'Terminal',rawInput:{command:'python eval.py'}});
  send({sessionUpdate:'async_task_spawned',asyncTaskId:'job',name:'Eval',toolCallId:'bash'});
  finish({stopReason:'end_turn'});await turn;
  assert.equal(session.turnId,null);
  send({sessionUpdate:'async_task_state_update',asyncTaskId:'job',state:'failed',summary:'exit 2'});
  const tasks=session.listBackgroundTasks().tasks;
  assert.equal(tasks[0].status,'failed');assert.equal(tasks[0].rootTurnId,'parent');assert.equal(tasks[0].command,'python eval.py');
  notify({method:'session/update',params:{sessionId:'foreign',update:{sessionUpdate:'async_task_state_update',asyncTaskId:'job',state:'completed'}}});
  assert.equal(session.listBackgroundTasks().tasks[0].status,'failed');
  assert.ok(!events.some(event=>event.type.startsWith('subagent.')));
});
