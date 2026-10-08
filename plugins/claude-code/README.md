# Claude Code for Aibo

Use Claude Code in an Aibo workspace with streamed replies, tool activity, plan approvals,
questions, native background-task updates, and reported subscription quota.

The plugin packages the JavaScript ACP adapter and launches your locally installed Claude Code.
It uses [`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp)
and Aibo's configuration-driven ACP Worker. Current package: **0.4.7**.

[Install](../../docs/installation.md) · [Compatibility](../../docs/installation.md#compatibility) · [Changes](CHANGELOG.md)

## Requirements

- Aibo with host SDK **0.1.10**, a host-resolved Node runtime, and the matching authentication, background-task and quota contracts. Verify the actual host build; this is a source requirement.
- macOS arm64, as declared in [plugin.json](plugin.json).
- Install Claude Code **2.1.280 or later** separately and complete its login. Run `claude --version` to check the installation. Credentials remain owned by Claude; Aibo does not store them.
- The required `claude` dependency must be discoverable by Aibo. The host includes common install locations such as `~/.local/bin` and Homebrew paths; custom locations must be on its PATH.
- No separate Node, npm or global ACP installation is required by the plugin. It packages ACP 0.81.2 and the JavaScript SDK dependencies, **without the native Claude executable**.
- Missing or older Claude installations block plugin activation through the host's dependency diagnostics. `launch-acp.mjs` resolves `claude` from the host PATH and sets ACP's `CLAUDE_CODE_EXECUTABLE`; it does not fall back to a bundled engine or inherit an unrelated override.
- The minimum matches the tested SDK/CLI pair. Newer user-installed CLI releases are not pinned by the plugin and may require compatibility updates.

## Install and start a conversation

1. Install the required Claude Code CLI and complete its native login.
2. Obtain the built package using the [source build guide](../../docs/installation.md#build-from-source).
   This source combination uses `AIBO_SDK=local` and a matching Aibo checkout.
3. Install the emitted `claude-code/` directory in Aibo's **插件与能力** settings, then enable it.
4. Create a new Claude Code session, choose a supported model and mode, and send a short request.

Existing sessions retain their original release binding until a supported migration succeeds.
Use a new session to test a newly installed version. The package does not include model access.

## Login and authentication

In **插件与能力**, select and enable Claude Code, then choose **登录 / 授权**. Aibo opens the
system Terminal with `claude auth login`. Complete the browser authorization and return to
**检查登录状态**, which runs `claude auth status`. This terminal entry currently supports macOS
and requires the host's `plugin_authentication_action` and manifest `authentication` contracts.

After login, manually retry the failed request. Opening Terminal is not proof of login, and a
local status check does not prove the remote token is still valid. Reauthorize if OAuth expiry
continues. Aibo does not save Claude credentials, automatically resend failed messages, or change
session bindings during login.

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
Command directory: ACP drops the SDK's `builtin` marker, so `claude-commands.mjs` files commands under Aibo's Skill
category when the description ends in a skill origin (`(project)`, `(user)`, `(claude.ai sync)`) or the name is a
plugin skill `<plugin>:<skill>` (MCP prompts, `mcp:…`, excluded). Skills bundled with Claude Code carry no marker and stay under Agent.
Questions: Claude's AskUserQuestion appears as an Aibo question. Each question offers Claude's options and an "other" text
answer. Multi-select questions accept one pick in Aibo; skipping a question is not available. The same channel carries
forms from MCP servers and Claude's "retry with the fallback model?" prompt after a refusal. Retrying switches the model
inside Claude, and Aibo's model selection is not updated to match.

## Background tasks

Native `async_task_spawned`, `async_task_progress`, and `async_task_state_update` events become
background-command snapshots, separate from subagent history. Aibo can show the task name,
command, running/completed/failed/stopped/unknown state, summary, and output path. Output paths
are displayed, not used to read arbitrary files. Completion notifications can arrive after the
main reply; the host polls task state every two seconds while viewing the session.

After reconnection, historical running tasks first show an unknown state. Recovery data does
not prove a process is alive. Commands launched with `nohup` or `&` are not inferred as tracked
tasks when the native agent emits no task event. This requires the host's background-task contract.

## Subscription quota

Release 0.4.7 maps Claude's `_claude/rateLimit` events into 5-hour, weekly and available Opus/Sonnet weekly windows. Values are last observations, updated by events, not live account queries. Missing windows retain their prior observation within the current session runtime. At reset time the host shows unknown until new data arrives; a missing reset time is explicitly unknown. Reconnection clears observations. Extra paid usage is not included.

Requires the matching host SDK 0.1.10 build; reinstalling the previous plugin or using an older host is insufficient. While this SDK remains unpublished, build with `AIBO_SDK=local pnpm run verify`. See the [quota specification](../../docs/claude-quota-spec.md) and [validation](../../docs/claude-quota-validation.md).

## Development and validation

Build dependencies are prepared with `pnpm prepare:deps`, then `AIBO_SDK=local pnpm run verify` builds offline from the cache.
`runtime/package-lock.json` pins the dependency graph. Build and preparation use `--omit=optional` to exclude the SDK's native platform packages; lockfile records for those optional packages remain for reproducibility. `vendor/` contains JS, package metadata, resources and licenses; type files and source maps are omitted. Packaging checks reject native Claude files and packages over 32 MiB.
The host SDK stays external. Install the generated `dist/build-*/claude-code/`, not this source directory.

`CLAUDE_PLUGIN_PATH=/absolute/path/to/built/claude-code node scripts/probe-claude-code.mjs`
runs the packaged worker with the host private Node and no global ACP directory against real Claude Code: a Plan session with
capabilities, commands and models, a short Plan reply, a Manual write turn approved through Aibo that creates
a file, an AskUserQuestion answered through Aibo, a Plan turn whose plan approval switches to Manual and then writes a file, and a resume in a new worker
process. It sends four short prompts. `PROBE_PLAN_CHOICE` picks the plan approval: `manual` (default),
`auto` or `clear-auto`. Last run: Claude Code 2.1.280 with adapter 0.81.2 (2026-09-27). `PROBE_CONFIG_ONLY=1` stops before
any prompt.

The build also runs `scripts/smoke-claude-package.mjs`: with empty PATH it starts the packaged Worker
and checks the launcher's missing-CLI guidance. With a temporary fake external CLI it verifies delegation
and negotiates real ACP initialize. It rejects bundled native SDK packages. It sends no model requests
and does not prove login, permissions, real turns or desktop installation. See
[packaging validation](../../docs/claude-external-runtime-validation.md) for this change's evidence.
