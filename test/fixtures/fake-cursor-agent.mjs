#!/usr/bin/env node
import { createInterface } from 'node:readline';

let model = 'auto', mode = 'agent';
const parameters = { reasoning: 'medium', context: 'standard' };
const config = () => ({ configOptions: [
  { id: 'mode', currentValue: mode, options: ['agent', 'plan', 'ask'].map(value => ({ value })) },
  { id: 'model', description: 'Controls which model is used for responses', category: 'model', type: 'select', currentValue: model, options: [{ value: 'auto', name: 'Auto' }, { value: 'premium', name: 'Premium' }] },
  ...(model === 'premium' ? [
    { id: 'reasoning', category: 'thought_level', type: 'select', currentValue: parameters.reasoning, options: ['medium', 'high'].map(value => ({ value, name: value })) },
    { id: 'context', category: 'model_config', type: 'select', currentValue: parameters.context, options: ['standard', 'long'].map(value => ({ value, name: value })) },
  ] : []),
] });
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', line => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === 'initialize') return send({jsonrpc:'2.0',id,result:{protocolVersion:1,agentCapabilities:{loadSession:true},authMethods:[{id:'cursor_login'}]}});
  if (method === 'authenticate') return send({jsonrpc:'2.0',id,result:{}});
  if (method === 'session/new' || method === 'session/load') {
    send({jsonrpc:'2.0',id,result:method === 'session/new' ? {sessionId:'fake-cursor-session',...config()} : config()});
    setTimeout(() => send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fake-cursor-session',update:{sessionUpdate:'available_commands_update',availableCommands:[{name:'copy-request-id',description:'Copy request ID'},{name:'review',description:'Review changes',input:{hint:'[scope]'}}]}}}), 20);
    return;
  }
  if (method === 'session/set_config_option') {
    if (params.configId === 'model') model = params.value; else if (params.configId === 'mode') mode = params.value; else parameters[params.configId] = params.value;
    return send({jsonrpc:'2.0',id,result:config()});
  }
  if (method === 'session/prompt') {
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',messageId:'fake-message',content:{type:'text',text:params.prompt[0].text === '/copy-request-id' ? 'AIBO_NATIVE_COMMAND_OK' : model === 'premium' ? 'AIBO_CURSOR_PREMIUM_OK' : 'AIBO_CURSOR_OK'}}}});
    return send({jsonrpc:'2.0',id,result:{stopReason:'end_turn'}});
  }
  if (method === 'session/cancel') return;
  if (id !== undefined) send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
});
