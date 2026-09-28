# Aibo Claude Code

Connects Claude Code sessions to Aibo through the ACP adapter
[`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp).
The integration is configuration only: `plugin.json`, `acp.json` and the one-line worker from the
[ACP template](../acp-template/), running on host SDK 0.1.6's `serveAcpAgent`. Release **0.4.0**.

## Requirements

- Aibo with host SDK 0.1.6 and the bundled Node runtime (this source change; verify your host build).
- A valid Claude login. Credentials remain owned by Claude; Aibo does not store them.
- No separate Node, npm or global ACP installation. The darwin-arm64 package includes ACP 0.81.2,
  its lockfile-pinned production dependencies, and the SDK's native Claude 2.1.280 binary.
  Authentication provisioning is separate from runtime packaging; a fresh-machine login flow is not added here.

Build dependencies are prepared with `pnpm prepare:deps`, then `pnpm verify` builds offline from the cache.
`runtime/package-lock.json` pins the full dependency graph. `vendor/` in the release contains JS,
platform binaries, package metadata, resources and licenses; type files and source maps are omitted.
The host SDK stays external. Install the generated `dist/build-*/claude-code/`, not this source directory.

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
"清空上下文，批准计划并使用 Auto" and "批准计划并使用 Auto" (when Claude offers Auto), "批准计划，手动审批编辑" and "继续规划". Approving switches the
session to Auto or Manual in the same turn: Aibo saves the new mode before Claude is answered, and the timeline
records the switch. If Claude changes mode any other way during a turn, the turn fails and Aibo's mode is restored.

Clearing context continues the plan in a fresh Claude context in the same turn, and later turns use that context.
Limitation of adapter 0.81.2: after Aibo or the worker restarts, resuming the session restores the conversation from
before the clear, because the fresh context is stored under an ID the adapter does not expose. Claude then does not
remember the implementation; the timeline keeps it, and Aibo notes this once on the first resume.

Not exposed:

- Accept edits: its profile equals Manual's, so the host could not tell them apart. Bypass permissions is never selected.
- Clearing context without Auto ("clear context and auto-accept edits"), since Accept edits is not exposed.
- A read-only Ask mode; Claude Code has no mode that answers without tools.
- When the model does not support Auto, Claude silently falls back to Accept edits; Aibo treats that as an
  unapproved switch and fails the turn.

## Capabilities

Negotiated from the adapter: create and resume sessions (resume uses `session/load` and needs a session that
has received a prompt), text streaming, cancellation, approvals, questions, command directory, image input, model selection
and reasoning effort. Claude Code does not expose context-window options, so that control is not offered.
Questions: Claude's AskUserQuestion appears as an Aibo question. Each question offers Claude's options and an "other" text
answer. Multi-select questions accept one pick in Aibo; skipping a question is not available. The same channel carries
forms from MCP servers and Claude's "retry with the fallback model?" prompt after a refusal. Retrying switches the model
inside Claude, and Aibo's model selection is not updated to match.

## Verification

`CLAUDE_PLUGIN_PATH=/absolute/path/to/built/claude-code node scripts/probe-claude-code.mjs`
runs the packaged worker with the host private Node and no global ACP directory against real Claude Code: a Plan session with
capabilities, commands and models, a short Plan reply, a Manual write turn approved through Aibo that creates
a file, an AskUserQuestion answered through Aibo, a Plan turn whose plan approval switches to Manual and then writes a file, and a resume in a new worker
process. It sends four short prompts. `PROBE_PLAN_CHOICE` picks the plan approval: `manual` (default),
`auto` or `clear-auto`. Last run: Claude Code 2.1.280 with adapter 0.81.2 (2026-09-27). `PROBE_CONFIG_ONLY=1` stops before
any prompt.

The build also runs `scripts/smoke-claude-package.mjs`: with empty PATH it starts the packaged Worker,
negotiates real ACP initialize and executes the package-owned native CLI's `--version`. It sends no model
requests and does not prove login, permissions, real turns or desktop installation. See
[packaging validation](../../docs/self-contained-runtime-validation.md) for this change's evidence.
