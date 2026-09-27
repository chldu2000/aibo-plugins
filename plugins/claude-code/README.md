# Aibo Claude Code

Connects Claude Code sessions to Aibo through the ACP adapter
[`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp).
This plugin is configuration only: `plugin.json`, `acp.json` and the one-line worker from the
[ACP template](../acp-template/), running on host SDK 0.1.3's `serveAcpAgent`. Release **0.1.0**.

## Requirements

- Aibo with host SDK 0.1.3, Node.js 22 or later.
- Claude Code installed and signed in (`claude` works in a terminal). The adapter uses that login;
  Aibo does not store Claude credentials.
- The adapter on `PATH`: `npm install -g @agentclientprotocol/claude-agent-acp`. Aibo does not install it.
  Verified with adapter 0.81.2 and Claude Code 2.1.280.

## Modes

| Aibo control | Claude Code mode | Behaviour |
| --- | --- | --- |
| Manual | `default` | Edits and commands send approval requests that Aibo shows; each approval allows that action once |
| Plan | `plan` | Analyzes and plans without editing files |

The provider uses `agent-managed` execution: Claude Code owns file, command and network permissions,
and Aibo forwards the approvals it actually requests. There is no workspace sandbox.

Not exposed yet, because the host cannot yet represent them faithfully:

- Accept edits and Auto: their approval semantics do not match any host profile (Auto is reviewed by
  Claude's own classifier). Bypass permissions is never selected.
- Approving a plan inside Plan mode: Claude asks to switch to an editing mode, which Aibo declines, so Claude
  keeps planning. Choose Manual in Aibo to implement a plan. Host-committed mode transitions are planned (A5).
- There is no read-only Ask mode; Claude Code has no mode that answers without tools.

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
a file, and a resume in a new worker process. It sends two short prompts. `PROBE_CONFIG_ONLY=1` stops before
any prompt.
