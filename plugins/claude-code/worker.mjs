import { readFileSync } from 'node:fs';
import { acpAgentConfig, extensionFromConfig, serveAcpAgent } from '@aibolabs/acp-adapter/worker';
import { claudeBackgroundNotification } from './claude-background-tasks.mjs';
import { claudeCommandCategory } from './claude-commands.mjs';

// The shared configuration-driven worker, plus Claude Code's skill classification.
const manifestUrl = new URL('./plugin.json', import.meta.url);
const manifest = JSON.parse(readFileSync(manifestUrl, 'utf8'));
const config = acpAgentConfig(JSON.parse(readFileSync(new URL('./acp.json', import.meta.url), 'utf8')), manifest);
const base = extensionFromConfig(config, manifest, manifestUrl);
serveAcpAgent({ manifestUrl, extension: { ...base, capabilities: [...base.capabilities, 'background-tasks.list'],
  clientMeta: { ...base.clientMeta, 'jetbrains': { air: { version: 1, capabilities: ['asyncTasks'] } } },
  handleNotification: claudeBackgroundNotification, commandCategory: claudeCommandCategory } });
