# Aibo Claude Code

Connects Claude Code sessions to Aibo through the ACP adapter
[`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp).
This plugin is configuration only: `plugin.json`, `acp.json` and the one-line worker from the
[ACP template](../acp-template/), running on host SDK 0.1.4's `serveAcpAgent`. Release **0.2.0**.

## Requirements

- Aibo with host SDK 0.1.4, Node.js 22 or later.
- Claude Code installed and signed in (`claude` works in a terminal). The adapter uses that login;
  Aibo does not store Claude credentials.
- The adapter on `PATH`: `npm install -g @agentclientprotocol/claude-agent-acp`. Aibo does not install it.
  Verified with adapter 0.81.2 and Claude Code 2.1.280.

## Modes

| Aibo control | Claude Code mode | Behaviour |
| --- | --- | --- |
| Manual | `default` | Edits and commands send approval requests that Aibo shows; each approval allows that action once |
| Auto | `auto` | Claude's own classifier reviews edits and commands; requests it still raises appear in Aibo |
| Plan | `plan` | Analyzes and plans without editing files |

The provider uses `agent-managed` execution: Claude Code owns file, command and network permissions,
and Aibo forwards the approvals it actually requests. There is no workspace sandbox. Auto depends on the
model and organization settings; when Claude Code does not offer it, choosing Auto fails to open the session.

Approving a plan: when Claude finishes planning it asks to leave Plan mode. Aibo's approval card offers
"批准计划并使用 Auto" (when Claude offers Auto), "批准计划，手动审批编辑" and "继续规划". Approving switches the
session to Auto or Manual in the same turn: Aibo saves the new mode before Claude is answered, and the timeline
records the switch. If Claude changes mode any other way during a turn, the turn fails and Aibo's mode is restored.

Not exposed:

- Accept edits: its profile equals Manual's, so the host could not tell them apart. Bypass permissions is never selected.
- The "clear context" plan approvals (planned as A6).
- A read-only Ask mode; Claude Code has no mode that answers without tools.
- When the model does not support Auto, Claude silently falls back to Accept edits; Aibo treats that as an
  unapproved switch and fails the turn.

## Capabilities

Negotiated from the adapter: create and resume sessions (resume uses `session/load` and needs a session that
has received a prompt), text streaming, cancellation, approvals, command directory, image input, model selection
and reasoning effort. Claude Code does not expose context-window options, so that control is not offered.
Claude's own question tool (AskUserQuestion) uses ACP elicitation, which the generic adapter does not implement;
the agent receives Method not found.

## Verification

`node scripts/probe-claude-code.mjs` installs the adapter into a temporary prefix (or uses
`CLAUDE_AGENT_ACP_BIN`) and runs the plugin's worker against real Claude Code: a Plan session with
capabilities, commands and models, a short Plan reply, a Manual write turn approved through Aibo that creates
a file, a Plan turn whose plan approval switches to Manual and then writes a file, and a resume in a new worker
process. It sends three short prompts. Last run: Claude Code 2.1.280 with adapter 0.81.2 (2026-09-27). `PROBE_CONFIG_ONLY=1` stops before
any prompt.
