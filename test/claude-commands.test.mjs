import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { claudeCommandCategory } from '../plugins/claude-code/claude-commands.mjs';

test('Claude Code skills are classified by origin suffix and plugin namespace', () => {
  // Shapes observed from claude-agent-acp 0.81.2 with Claude Code 2.1.280.
  assert.equal(claudeCommandCategory({ name: 'ak-ui', description: 'Integrate ak-ui interfaces. (project)' }), 'skill');
  assert.equal(claudeCommandCategory({ name: 'notes', description: 'Personal notes. (user)' }), 'skill');
  assert.equal(claudeCommandCategory({ name: 'anthropic-skills:pdf', description: 'Use this skill for PDFs. (claude.ai sync)' }), 'skill');
  assert.equal(claudeCommandCategory({ name: 'svelte:svelte-code-writer', description: 'CLI tools for Svelte 5.' }), 'skill');
});

test('Claude Code builtin and MCP commands stay agent commands', () => {
  assert.equal(claudeCommandCategory({ name: 'compact', description: 'Free up context by summarizing the conversation so far' }), 'agent');
  // Builtins with parenthesised suffixes that are not skill origins.
  assert.equal(claudeCommandCategory({ name: 'fast', description: 'Toggle fast mode (Opus 5.5)' }), 'agent');
  assert.equal(claudeCommandCategory({ name: 'clear', description: 'Start a new conversation (resumable with /resume)' }), 'agent');
  assert.equal(claudeCommandCategory({ name: 'mcp:server:prompt', description: 'An MCP prompt' }), 'agent');
  assert.equal(claudeCommandCategory({ name: 'project', description: null }), 'agent');
});

test('Claude Code worker uses the classifier and ships it', async () => {
  const worker = await readFile(new URL('../plugins/claude-code/worker.mjs', import.meta.url), 'utf8');
  assert.match(worker, /commandCategory: claudeCommandCategory/);
  const files = JSON.parse(await readFile(new URL('../plugins/claude-code/package.json', import.meta.url), 'utf8')).files;
  assert.ok(files.includes('claude-commands.mjs'));
});
