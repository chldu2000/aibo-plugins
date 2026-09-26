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
let mcp;
const send = message => process.stdout.write(`${JSON.stringify(message)}\n`);
createInterface({ input: process.stdin, crlfDelay: Infinity }).on('line', async line => {
  const message = JSON.parse(line);
  const { id, method, params } = message;
  if (method === 'initialize') return send({jsonrpc:'2.0',id,result:{protocolVersion:1,agentCapabilities:{loadSession:true,promptCapabilities:{image:true}},authMethods:[{id:'cursor_login'}]}});
  if (method === 'authenticate') return send({jsonrpc:'2.0',id,result:{}});
  if (method === 'session/new' || method === 'session/load') {
    if(params.mcpServers?.length){
      const {Client}=await import(process.env.AIBO_TEST_MCP_CLIENT);
      const {StdioClientTransport}=await import(process.env.AIBO_TEST_MCP_TRANSPORT);
      const server=params.mcpServers[0];
      mcp=new Client({name:'fake-cursor',version:'1.0.0'});
      await mcp.connect(new StdioClientTransport({...server,env:Object.fromEntries(server.env.map(({name,value})=>[name,value]))}));
      if(!(await mcp.listTools()).tools.some(tool=>tool.name==='aibo_read_session')) throw Error('History tool not discovered');
    }
    send({jsonrpc:'2.0',id,result:method === 'session/new' ? {sessionId:'fake-cursor-session',...config()} : config()});
    setTimeout(() => send({jsonrpc:'2.0',method:'session/update',params:{sessionId:'fake-cursor-session',update:{sessionUpdate:'available_commands_update',availableCommands:[{name:'copy-request-id',description:'Copy request ID'},{name:'review',description:'Review changes',input:{hint:'[scope]'}}]}}}), 20);
    return;
  }
  if (method === 'session/set_config_option') {
    if (params.configId === 'model') model = params.value; else if (params.configId === 'mode') mode = params.value; else parameters[params.configId] = params.value;
    return send({jsonrpc:'2.0',id,result:config()});
  }
  if (method === 'session/prompt') {
    if(params.prompt[0].text==='image smoke' && (params.prompt[1]?.type!=='image' || params.prompt[1].mimeType!=='image/png' || params.prompt[1].data!=='iVBORw0KGgo=')) return send({jsonrpc:'2.0',id,error:{code:-32602,message:'Image bytes missing or changed'}});
    const history=params.prompt[0].text==='host history fixture'?await mcp.callTool({name:'aibo_read_session',arguments:{referenceId:'ref',sessionId:'source'}}):null;
    send({jsonrpc:'2.0',method:'session/update',params:{sessionId:params.sessionId,update:{sessionUpdate:'agent_message_chunk',messageId:'fake-message',content:{type:'text',text:history?history.content[0].text:params.prompt[0].text === '/copy-request-id' ? 'AIBO_NATIVE_COMMAND_OK' : model === 'premium' ? 'AIBO_CURSOR_PREMIUM_OK' : 'AIBO_CURSOR_OK'}}}});
    return send({jsonrpc:'2.0',id,result:{stopReason:'end_turn'}});
  }
  if (method === 'session/cancel') return;
  if (id !== undefined) send({jsonrpc:'2.0',id,error:{code:-32601,message:'Method not found'}});
});
process.stdin.on('end',()=>{void mcp?.close();});
