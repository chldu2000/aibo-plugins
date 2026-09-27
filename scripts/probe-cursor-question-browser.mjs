// Replays the documented Cursor question through its real adapter, host projection and App UI.
// This is a browser fixture, not evidence that the native CLI emits AskQuestion.
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import './host-sdk.mjs';
import { aiboRoot } from './host-sdk.mjs';
const { cursorExtension } = await import('../plugins/cursor/cursor-session.mjs');
process.chdir(aiboRoot);
const { createServer } = await import(pathToFileURL(path.join(aiboRoot, 'node_modules/vite/dist/node/index.js')));
const { chromium } = await import(pathToFileURL(path.join(aiboRoot, 'node_modules/playwright/index.mjs')));
let payload, answer, request;
const responses = [];
cursorExtension.handleRequest({ await(_requestId, _rpcId, interaction) { answer = interaction.answer; return true; }, event(_type, value) { payload = value; } }, { id: 'q', method: 'cursor/ask_question' }, {
  questions: [{ id: 'tree', prompt: 'Choose a tree', options: [{ id: 'native-orchid', label: 'ORCHID' }, { id: 'native-maple', label: 'MAPLE' }], allowMultiple: false }],
}, 'cursor-s-q');
const server = await createServer({ root: aiboRoot, server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false, watch: null }, plugins: [{
  name: 'cursor-question-fixture', enforce: 'pre',
  configureServer(vite) {
    vite.middlewares.use('/__cursor_question_answer', (req, res) => {
      let text = ''; req.on('data', chunk => { text += chunk; }); req.on('end', () => {
        try { const result = answer(JSON.parse(text)); responses.push(result); res.end('ok'); }
        catch (error) { res.statusCode = 400; res.end(String(error)); }
      });
    });
  },
  transform(code, id) {
    if (!id.endsWith('/src/App.svelte')) return;
    const guard = 'if (!desktop || request.sessionId !== selectedSessionId) return;';
    const call = 'await resolveAgentUserInput(request.sessionId, request.requestId, answers);';
    assert.ok(code.includes(guard) && code.includes(call) && code.includes('workspaces = previewWorkspaces;'), 'question fixture anchors changed');
    return code.replace('workspaces = previewWorkspaces;', `workspaces = previewWorkspaces;
      workspaceSessionMap = { 'preview-workspace': [{ id:'question-session',workspaceId:'preview-workspace',agent:'dev.aibo.cursor.agent',label:'Question probe',state:'waiting_user',archived:false,externalSessionId:null,pluginInstallationId:'fixture',capabilities:['user-input.respond'],createdAt:'2026-09-27',updatedAt:'2026-09-27' }] };
      setTimeout(() => { selectedSessionId = 'question-session'; pendingUserInputs = [${JSON.stringify(request)}]; }, 100);`)
      .replace(guard, 'if (request.sessionId !== selectedSessionId) return;')
      .replace(call, `const response = await fetch('/__cursor_question_answer', {method:'POST',body:JSON.stringify(answers)}); if (!response.ok) throw new Error(await response.text());`);
  },
}] });
let browser;
try {
  const { handleAgentEvent } = await server.ssrLoadModule('/src/lib/app/agent-event-handler.ts');
  handleAgentEvent({ eventId:'q-event',sessionId:'question-session',workspaceId:'preview-workspace',turnId:'question-turn',type:'user_input.requested',occurredAt:'2026-09-27',source:{agentId:'dev.aibo.cursor.agent'},payload }, {
    selectedSessionId:'question-session',timeline:[],pendingApprovals:[],pendingUserInputs:[],lastSubmittedPrompt:null,
    setAgentActivity(){},updateWorkspaceSessions(){},setPendingUserInputs(value){request=value[0];},setPendingApprovals(){},setUsageSnapshot(){},setQueueSnapshot(){},setTimeline(){},setRetry(){},setNotice(){},refreshSessions(){},
  });
  assert.equal(request?.questions[0].question, 'Choose a tree', 'question must survive the host event projection');
  await server.listen(); browser = await chromium.launch({ headless: true });
  for (const kit of ['material3', 'ak-ui']) for (const dark of [false, true]) {
    const page = await browser.newPage();
    await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/`);
    await page.evaluate(async ({kit,dark}) => { const ui = await import('/src/lib/ui-kit/registry.ts'); ui.setUiKit(kit); ui.setUiTheme(dark?'dark':'light'); }, {kit,dark});
    const card = page.locator('.user-input-card');
    await card.getByText('Choose a tree', { exact:true }).waitFor();
    await card.getByRole('button', { name:'ORCHID', exact:true }).click();
    const before = responses.length;
    await card.getByRole('button', { name:'提交回答', exact:true }).click();
    await card.waitFor({ state:'detached' });
    assert.equal(responses.length, before + 1);
    assert.deepEqual(responses.at(-1).outcome.answers, [{questionId:'tree',selectedOptionIds:['native-orchid']}]);
    console.log(`${kit} ${dark?'dark':'light'}: adapter -> host projection -> question UI -> native option ID passed`);
    await page.close();
  }
} finally { await browser?.close(); await server.close(); }
