#!/usr/bin/env node
import { createInterface } from 'node:readline';

const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === 'initialize') return send({jsonrpc:'2.0',id,result:{protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[{id:'cursor_login'}]}});
  if (method === 'authenticate') return send({jsonrpc:'2.0',id,result:{}});
  if (method === 'session/new') return send({jsonrpc:'2.0',id,result:{sessionId:'fake-cursor-session',configOptions:[{id:'mode',currentValue:'agent',options:[{value:'agent'},{value:'plan'},{value:'ask'}]}]}});
  if (method === 'session/set_config_option') return send({jsonrpc:'2.0',id,result:{configOptions:[{id:'mode',currentValue:params.value}]}});
  if (method === 'session/prompt') {
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',messageId:'fake-message',content:{type:'text',text:'AIBO_CURSOR_OK'}}}});
    return send({jsonrpc:'2.0',id,result:{stopReason:'end_turn'}});
  }
  if (method === 'session/cancel') return;
  if (id !== undefined) send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
});
