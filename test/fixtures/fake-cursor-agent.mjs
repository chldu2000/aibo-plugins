#!/usr/bin/env node
import { createInterface } from 'node:readline';

let model = 'auto', mode = 'agent';
const config = () => ({ configOptions: [
  { id: 'mode', currentValue: mode, options: ['agent', 'plan', 'ask'].map(value => ({ value })) },
  { id: 'model', category: 'model', type: 'select', currentValue: model, options: [{ value: 'auto', name: 'Auto' }, { value: 'premium', name: 'Premium' }] },
] });
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === 'initialize') return send({jsonrpc:'2.0',id,result:{protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[{id:'cursor_login'}]}});
  if (method === 'authenticate') return send({jsonrpc:'2.0',id,result:{}});
  if (method === 'session/new') return send({jsonrpc:'2.0',id,result:{sessionId:'fake-cursor-session',...config()}});
  if (method === 'session/load') return send({jsonrpc:'2.0',id,result:config()});
  if (method === 'session/set_config_option') {
    if (params.configId === 'model') model = params.value; else mode = params.value;
    return send({jsonrpc:'2.0',id,result:config()});
  }
  if (method === 'session/prompt') {
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',messageId:'fake-message',content:{type:'text',text:model === 'premium' ? 'AIBO_CURSOR_PREMIUM_OK' : 'AIBO_CURSOR_OK'}}}});
    return send({jsonrpc:'2.0',id,result:{stopReason:'end_turn'}});
  }
  if (method === 'session/cancel') return;
  if (id !== undefined) send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
});
