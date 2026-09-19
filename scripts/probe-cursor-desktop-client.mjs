import { invoke as tauriInvoke } from '@tauri-apps/api/core';

async function invoke(command, args) {
  try { return await tauriInvoke(command, args); }
  catch (error) { throw new Error(`${command}: ${typeof error === 'string' ? error : JSON.stringify(error)}`); }
}

const delay=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function until(find,label,attempts=600){for(let n=0;n<attempts;n++){const value=await find();if(value)return value;await delay(100);}throw Error(`timeout: ${label}`);}
async function prompt(sessionId,workspaceId,text){
  for(let attempt=1;attempt<=3;attempt++){
    const before=new Set((await invoke('get_timeline',{sessionId})).map(item=>item.id));
    await invoke('send_agent_prompt',{sessionId,input:text});
    const completed=await until(async()=>{
      const sessions=await invoke('list_sessions',{workspaceId});
      const current=sessions.find(item=>item.id===sessionId);
      if(current?.state==='failed')throw Error('Cursor desktop turn failed');
      if(current?.state!=='idle')return null;
      const timeline=await invoke('get_timeline',{sessionId});
      return timeline.find(item=>!before.has(item.id)&&item.role==='assistant'&&item.status==='completed');
    },`Cursor desktop response ${attempt}`);
    if(!completed.content.includes('resource_exhausted'))return completed;
    if(attempt<3)await delay(3_000);
    else throw Error(`Cursor backend remained resource_exhausted after ${attempt} attempts`);
  }
}

async function run(){try {
  const config=await(await fetch('/__cursor_probe_config')).json();
  const workspace=await invoke('add_workspace',{path:config.workspacePath});
  await invoke('set_workspace_trust',{workspaceId:workspace.id,trusted:true});
  const installation=await invoke('install_agent_plugin',{path:config.packagePath});
  if(!installation.runnable||installation.activationIssues?.length)throw Error(`Cursor plugin is not runnable: ${JSON.stringify(installation.activationIssues)}`);
  await invoke('set_agent_plugin_enabled',{id:installation.id,enabled:true});
  const listed=(await invoke('list_plugin_installations')).find(item=>item.id===installation.id);
  const provider=listed?.contributions?.find(item=>item.id==='dev.aibo.cursor.agent');
  if(!listed?.enabled||!provider)throw Error('Cursor provider was not discovered after installation');
  const session=await invoke('create_agent_session',{workspaceId:workspace.id,agentId:'dev.aibo.cursor.agent',installationId:installation.id,requestedProfile:null});
  if(!session.capabilities.includes('turn.send')||!session.capabilities.includes('session.resume'))throw Error(`Cursor capabilities missing: ${JSON.stringify(session.capabilities)}`);
  if(!session.capabilities.includes('queue.manage'))throw Error(`Host queue capability missing: ${JSON.stringify(session.capabilities)}`);
  if(session.capabilities.includes('queue.steer'))throw Error(`Cursor unexpectedly negotiated native steering: ${JSON.stringify(session.capabilities)}`);
  if (!session.capabilities.includes('model.select')) throw Error('Cursor model selection capability missing');
  const [catalog, commandResult] = await Promise.all([
    invoke('get_session_models', { sessionId: session.id }),
    invoke('invoke_agent_capability', { sessionId: session.id, capability: 'command.list', input: {} }),
  ]);
  if (!commandResult.commands?.some(command => command.name === 'copy-request-id')) throw Error(`Host command directory missing native command: ${JSON.stringify(commandResult)}`);
  const auto = catalog.models.find(model => model.label.toLowerCase() === 'auto');
  if (!auto || !catalog.current) throw Error('Host model catalog must include Auto and the current model');
  const selected = await invoke('invoke_agent_capability', { sessionId: session.id, capability: 'model.select', input: { action: 'set', reference: catalog.current.reference } });
  if (selected.current !== catalog.current.reference) throw Error('Host model selection did not round-trip');
  if(config.contractOnly){
    const modes = [];
    for (const controlId of ['plan', 'agent', 'ask']) {
      const profile = await invoke('get_session_execution_profile', {sessionId:session.id});
      if (!profile.agentManagedPermissions || profile.nativeSandbox) throw Error('Native permission ownership not exposed');
      if (profile.sessionControls.map(control=>control.id).join(',') !== 'agent,ask,plan') throw Error('Cursor mode menu missing');
      const changed = await invoke('update_session_execution_profile', {sessionId:session.id,controlId});
      if (changed.enforced.interactionMode !== (controlId === 'agent' ? 'edit' : controlId)) throw Error('Mode selection did not persist');
      // This reopens the pinned native session and checks ACP mode selection.
      await invoke('get_session_models', {sessionId:session.id});
      modes.push(controlId);
    }
    await invoke('close_agent_session',{sessionId:session.id});
    await invoke('set_agent_plugin_enabled',{id:installation.id,enabled:false});
    await invoke('uninstall_agent_plugin',{id:installation.id});
    await fetch('/__cursor_probe_report',{method:'POST',body:JSON.stringify({ok:true,mode:'contract-only',modes,commandCount:commandResult.commands.length,modelCount:catalog.models.length,auto:auto.reference,pluginVersion:listed.version,sessionId:session.id,capabilities:session.capabilities})});
    return;
  }
  const completed=await prompt(session.id,workspace.id,'Reply with exactly: AIBO_CURSOR_DESKTOP_OK');
  if(completed.content!=='AIBO_CURSOR_DESKTOP_OK')throw Error(`Unexpected Cursor response: ${completed.content}`);
  await invoke('close_agent_session',{sessionId:session.id});
  await invoke('resume_agent_session',{sessionId:session.id});
  const resumed=await until(async()=>{
    const sessions=await invoke('list_sessions',{workspaceId:workspace.id});
    return sessions.find(item=>item.id===session.id&&item.state==='idle');
  },'Cursor desktop resume');
  const events=await invoke('list_capability_events',{scope:{kind:'session',id:session.id},afterSequence:0,limit:500});
  await invoke('close_agent_session',{sessionId:session.id});
  await invoke('set_agent_plugin_enabled',{id:installation.id,enabled:false});
  await invoke('uninstall_agent_plugin',{id:installation.id});
  await fetch('/__cursor_probe_report',{method:'POST',body:JSON.stringify({ok:true,pluginVersion:listed.version,sessionId:session.id,response:completed.content,resumed:!!resumed,eventCount:events.length,capabilities:session.capabilities})});
} catch(error) {
  await fetch('/__cursor_probe_report',{method:'POST',body:JSON.stringify({ok:false,error:String(error),stack:error?.stack})});
}}
await run();
