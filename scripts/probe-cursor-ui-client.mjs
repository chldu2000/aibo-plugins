import '/src/app.css';
import { invoke } from '@tauri-apps/api/core';
import { mount, tick } from 'svelte';
import App from '/src/App.svelte';
import { setUiKit, toggleUiColorScheme } from '/src/lib/ui-kit/registry.ts';

const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(find, label, timeout = 90000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) { const value = await find(); if (value) return value; await delay(150); }
  throw Error('timeout: ' + label);
}
const check = (name, detail = {}) => fetch('/__cursor_ui_check', { method: 'POST', body: JSON.stringify({ name, ...detail }) });
const query = selector => document.querySelector(selector);
const visible = element => element && element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().height > 0;
const buttons = selector => [...document.querySelectorAll(selector)];
async function input(step) {
  const result = await (await fetch('/__cursor_ui_input', { method: 'POST', body: JSON.stringify(step) })).json();
  if (!result.ok) throw Error(result.error);
  await delay(180);
}
async function click(element) {
  if (!element || element.disabled) throw Error('Missing or disabled UI control: ' + (element?.outerHTML ?? 'null'));
  element.scrollIntoView({ block: 'nearest', inline: 'nearest' }); await delay(100);
  const r = element.getBoundingClientRect();
  if (!r.width || !r.height) throw Error('UI control is not visible');
  await input({ action: 'click', x: r.left + r.width / 2, y: r.top + r.height / 2, width: innerWidth, height: innerHeight });
}
const key = key => input({ action: 'key', key });
async function fill(text) {
  const element = await until(() => query('[data-composer-input]:not(:disabled)'), 'composer');
  element.value = text; element.dispatchEvent(new Event('input', { bubbles: true })); await tick();
}
let config, workspace, session, legacy, installation, legacyInstallation, originalModel;
const state = async () => (await invoke('list_sessions', { workspaceId: workspace.id })).find(item => item.id === session.id);
const timeline = () => invoke('get_timeline', { sessionId: session.id });
async function send(text) {
  const before = new Set((await timeline()).map(item => item.id));
  await fill(text);
  await click(await until(() => query('button[aria-label="发送"]:not(:disabled)'), 'send enabled'));
  return before;
}
async function completed(before, label) {
  return until(async () => {
    const current = await state();
    if (current.state === 'failed') throw Error(label + ': session failed');
    if (current.state !== 'idle') return null;
    const response = (await timeline()).filter(item => !before.has(item.id) && item.role === 'assistant' && item.status === 'completed').map(item => item.content).join('\n');
    if (/resource_exhausted|unauthenticated|rate.limit/i.test(response)) throw Error(label + ': ' + response.slice(0, 400));
    return response || null;
  }, label, 180000);
}
async function mode(id) {
  await click(await until(() => query('.composer-access-control'), 'mode trigger'));
  const names = { ask: 'Ask', plan: 'Plan', agent: 'Agent' };
  await click(await until(() => buttons('[role="menuitemradio"]').find(node => node.querySelector('strong')?.textContent === names[id]), 'mode option ' + id));
  await until(async () => (await invoke('get_session_execution_profile', { sessionId: session.id })).enforced.interactionMode === (id === 'agent' ? 'edit' : id), 'confirmed mode ' + id);
  await invoke('get_session_models', { sessionId: session.id });
}
async function model(label) {
  await click(await until(() => query('.composer-model-control'), 'model trigger'));
  await click(await until(() => buttons('.ui-model-matrix tbody tr').find(row => row.querySelector('th span')?.textContent === label)?.querySelector('td button:not(:disabled)'), 'model option ' + label));
  await until(async () => (await invoke('get_session_models', { sessionId: session.id })).current?.label === label, 'model confirmed ' + label);
}
async function selectSession() {
  const workspaceButton = await until(() => buttons('button').find(node => node.getAttribute('aria-label')?.startsWith(workspace.label + '，')), 'workspace row');
  if (!query('.session-list')) await click(workspaceButton);
  await click(await until(() => buttons('button.session-item').find(node => node.getAttribute('aria-label')?.startsWith(session.label + '，')), 'session row'));
  await until(() => query('[data-composer-input]:not(:disabled)') && query('.composer-model-control'), 'selected session composer');
}
async function exerciseInteraction(kind) {
  await mode(kind === 'question' ? 'plan' : 'agent');
  const request = kind === 'question'
    ? 'Before making a plan, use your AskQuestion tool to ask me to choose between ORCHID and MAPLE. Wait for my selection; do not answer for me. After I choose, reply with my choice and do not make a plan or modify files.'
    : 'Use your terminal tool to run this exact command in the current workspace: printf AIBO_APPROVAL_OK > approved.txt . Request user permission if required. Then report the result.';
  const before = await send(request), observed = [];
  await until(async () => {
    const question = query('.user-input-card');
    const approval = query('.approval-card');
    if (visible(question)) {
      await click(question.querySelector('.user-input-options button'));
      await click(buttons('.user-input-actions button').find(node => node.textContent.includes('提交回答')));
      await until(() => !question.isConnected, 'question response accepted');
      observed.push('question');
      await check('interaction-response', { kind: 'question' });
    } else if (visible(approval)) {
      const accept = [...approval.querySelectorAll('button')].find(node => /允许|批准|同意/.test(node.textContent));
      if (!accept) throw Error('Approval has no accept button');
      await click(accept);
      await until(() => !approval.isConnected, 'approval response accepted');
      observed.push('approval');
      await check('interaction-response', { kind: 'approval' });
    }
    const current = await state();
    if (current.state === 'failed') throw Error(kind + ': native turn failed');
    return current.state === 'idle' && (await timeline()).some(item => !before.has(item.id) && item.role === 'assistant');
  }, kind + ' interaction', 180000);
  const response = await completed(before, kind + ' turn');
  await check(kind, { status: observed.includes(kind) ? 'passed' : 'not-observed', observed, response: response.slice(0, 500) });
}

try {
  config = await (await fetch('/__cursor_ui_config')).json();
  await check('client-started', { phase: config.phase });
  if (config.phase === 'initial') {
    workspace = await invoke('add_workspace', { path: config.workspacePath });
    await invoke('set_workspace_trust', { workspaceId: workspace.id, trusted: true });
    legacyInstallation = await invoke('install_agent_plugin', { path: config.legacyPath });
    await invoke('set_agent_plugin_enabled', { id: legacyInstallation.id, enabled: true });
    legacy = await invoke('create_agent_session', { workspaceId: workspace.id, agentId: 'dev.aibo.cursor.agent', installationId: legacyInstallation.id, requestedProfile: null });
    installation = await invoke('install_agent_plugin', { path: config.packagePath });
    await invoke('set_agent_plugin_enabled', { id: installation.id, enabled: true });
    session = await invoke('create_agent_session', { workspaceId: workspace.id, agentId: 'dev.aibo.cursor.agent', installationId: installation.id, requestedProfile: null });
    session = await invoke('rename_session', { sessionId: session.id, label: 'Cursor A1 UI acceptance' });
    const sessions = await invoke('list_sessions', { workspaceId: workspace.id });
    if (sessions.find(item => item.id === legacy.id).pluginInstallationId !== legacyInstallation.id || session.pluginInstallationId !== installation.id) throw Error('Release binding changed');
    if (!session.capabilities.includes('user-input.respond') || !session.capabilities.includes('session.resume')) throw Error('Cursor capabilities lost');
    originalModel = (await invoke('get_session_models', { sessionId: session.id })).current?.reference;
    await check('installation-and-pinned-releases', { oldVersion: legacyInstallation.manifest?.version ?? legacyInstallation.version, newVersion: installation.manifest?.version ?? installation.version });
  } else {
    ({ workspace, session, legacy, installation, legacyInstallation } = config.previous);
    await invoke('resume_agent_session', { sessionId: session.id });
  }
  mount(App, { target: document.getElementById('app') });
  await selectSession();
  if (config.phase === 'initial') {
    for (const kit of config.skipMenus ? [] : ['material3', 'ak-ui']) {
      setUiKit(kit); await tick(); await delay(500);
      for (const appearance of ['first', 'opposite']) {
        if (appearance === 'opposite') { toggleUiColorScheme(); await tick(); await delay(500); }
        await fill('/');
        const command = await until(() => buttons('[role="option"]').find(node => node.textContent.includes('/copy-request-id')), 'slash command');
        await click(command);
        if (query('[data-composer-input]:not(:disabled)').value !== '/copy-request-id ') throw Error('Slash command insertion failed');
        await fill('/'); await click(await until(() => query('[data-composer-input]:not(:disabled)'), 'input ready')); await key('Escape');
        await until(() => !query('[aria-label="命令建议"]'), 'slash close'); await fill('');
        await click(await until(() => query('.composer-model-control'), 'model trigger ready'));
        await until(() => query('.ui-model-matrix tbody tr'), 'model menu');
        await click(await until(() => query('.composer-model-control'), 'model menu close'));
        await until(() => !query('.composer-model-menu'), 'model menu closed');
        await check('menus-visible-and-operable', { kit, appearance });
      }
    }
    for (const id of config.skipMenus ? [] : ['plan', 'agent', 'ask']) { await mode(id); await check('mode-selection', { id }); }
    const catalog = await invoke('get_session_models', { sessionId: session.id });
    const auto = catalog.models.find(item => item.label.toLowerCase() === 'auto');
    if (!auto) throw Error('Auto missing');
    await model(auto.label);
    const before = await send('Remember the verification word ORCHID-742 for this conversation. Reply with exactly AIBO_CURSOR_UI_OK.');
    const response = await completed(before, 'initial UI turn');
    if (response.trim() !== 'AIBO_CURSOR_UI_OK') throw Error('Unexpected UI response: ' + response);
    await check('send-and-timeline', { response });

    const canvas = document.createElement('canvas'); canvas.width = 128; canvas.height = 128;
    const ctx = canvas.getContext('2d'); ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 128, 128);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
    const data = new DataTransfer(); data.items.add(new File([blob], 'red-square.png', { type: 'image/png' }));
    query('[data-composer-input]:not(:disabled)').dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    await until(() => { const image = query('[aria-label="上下文附件"] img'); return image?.complete && image.naturalWidth === 128; }, 'image attachment preview');
    const imageBefore = await send('What is the dominant color of the attached image? Reply with exactly RED, BLUE or GREEN.');
    const imageResponse = await completed(imageBefore, 'image turn');
    // Cursor may emit a progress sentence before its final answer in the same message.
    if (!/RED[.!]?$/i.test(imageResponse.trim())) throw Error('Image understanding failed: ' + imageResponse);
    await check('image-paste-preview-and-understanding', { response: imageResponse });

    await send('Write a very long numbered list from 1 to 10000, with a sentence explaining each number.');
    await click(await until(() => query('button[aria-label="中止"]:not(:disabled)'), 'cancel button'));
    await until(async () => ['idle', 'interrupted'].includes((await state()).state), 'cancel terminal');
    await until(() => !query('button[aria-label="中止"]'), 'cancel UI settled');
    await check('cancel-through-ui', { state: (await state()).state });
    await exerciseInteraction('question');
    await exerciseInteraction('approval');
    await mode('ask');
    if (originalModel) await invoke('invoke_agent_capability', { sessionId: session.id, capability: 'model.select', input: { action: 'set', reference: originalModel } });
    await check('idle-before-app-restart');
  } else {
    const sessions = await invoke('list_sessions', { workspaceId: workspace.id });
    if (sessions.find(item => item.id === legacy.id)?.pluginInstallationId !== legacyInstallation.id) throw Error('Old release rebound after restart');
    if ((await state()).pluginInstallationId !== installation.id) throw Error('New release rebound after restart');
    originalModel = (await invoke('get_session_models', { sessionId: session.id })).current?.reference;
    const auto = (await invoke('get_session_models', { sessionId: session.id })).models.find(item => item.label.toLowerCase() === 'auto');
    await model(auto.label);
    const before = await send('What verification word did I ask you to remember earlier? Reply with that word only.');
    const response = await completed(before, 'restarted UI turn');
    if (!response.includes('ORCHID-742')) throw Error('Native context was not restored: ' + response);
    await check('app-restart-context-and-binding', { response });
    if (originalModel) await invoke('invoke_agent_capability', { sessionId: session.id, capability: 'model.select', input: { action: 'set', reference: originalModel } });
    await invoke('close_agent_session', { sessionId: session.id });
    await invoke('resume_agent_session', { sessionId: legacy.id });
    const oldModels = await invoke('get_session_models', { sessionId: legacy.id });
    if (!oldModels.models.length) throw Error('Old release cannot resume');
    await invoke('close_agent_session', { sessionId: legacy.id });
    await check('old-release-still-operates', { version: legacyInstallation.manifest?.version ?? legacyInstallation.version });
  }
  await fetch('/__cursor_ui_report', { method: 'POST', body: JSON.stringify({ ok: true, context: { workspace, session, legacy, installation: { id: installation.id, version: installation.manifest?.version ?? installation.version }, legacyInstallation: { id: legacyInstallation.id, version: legacyInstallation.manifest?.version ?? legacyInstallation.version } } }) });
} catch (error) {
  let cleanupError;
  try {
    if (session) {
      if (['running', 'waiting_approval', 'waiting_user'].includes((await state()).state)) {
        await invoke('cancel_agent_turn', { sessionId: session.id });
        await until(async () => ['idle', 'interrupted', 'failed'].includes((await state()).state), 'cleanup cancellation');
      }
      if (originalModel) {
        await invoke('resume_agent_session', { sessionId: session.id });
        await invoke('invoke_agent_capability', { sessionId: session.id, capability: 'model.select', input: { action: 'set', reference: originalModel } });
        await invoke('close_agent_session', { sessionId: session.id });
      }
    }
  } catch (failure) { cleanupError = String(failure); }
  await fetch('/__cursor_ui_report', { method: 'POST', body: JSON.stringify({ ok: false, error: String(error), cleanupError, stack: error.stack, text: document.body.innerText.slice(-3500) }) });
}
