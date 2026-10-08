# Aibo Claude Code

Connects Claude Code sessions to Aibo through the ACP adapter
[`@agentclientprotocol/claude-agent-acp`](https://github.com/agentclientprotocol/claude-agent-acp).
The plugin uses `plugin.json`, `acp.json` and the configuration-driven worker from the
[ACP template](../acp-template/), adding skill classification, background task events and subscription quota mapping, running on host SDK 0.1.10's `serveAcpAgent`. A small launcher resolves the locally installed Claude executable. Release **0.4.7**.

## Requirements

- Aibo with host SDK **0.1.10** and a host-resolved Node runtime (this source change; verify your host build).
- Install Claude Code **2.1.280 or later** separately and complete its login. Run `claude --version` to check the installation. Credentials remain owned by Claude; Aibo does not store them.
- The required `claude` dependency must be discoverable by Aibo. The host includes common install locations such as `~/.local/bin` and Homebrew paths; custom locations must be on its PATH.
- No separate Node, npm or global ACP installation is required by the plugin. It packages ACP 0.81.2 and the JavaScript SDK dependencies, **without the native Claude executable**.
- Missing or older Claude installations block plugin activation through the host's dependency diagnostics. `launch-acp.mjs` resolves `claude` from the host PATH and sets ACP's `CLAUDE_CODE_EXECUTABLE`; it does not fall back to a bundled engine or inherit an unrelated override.
- The minimum matches the tested SDK/CLI pair. Newer user-installed CLI releases are not pinned by the plugin and may require compatibility updates.

Build dependencies are prepared with `pnpm prepare:deps`, then `pnpm verify` builds offline from the cache.
`runtime/package-lock.json` pins the dependency graph. Build and preparation use `--omit=optional` to exclude the SDK's native platform packages; lockfile records for those optional packages remain for reproducibility. `vendor/` contains JS, package metadata, resources and licenses; type files and source maps are omitted. Packaging checks reject native Claude files and packages over 32 MiB.
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
Command directory: ACP drops the SDK's `builtin` marker, so `claude-commands.mjs` files commands under Aibo's Skill
category when the description ends in a skill origin (`(project)`, `(user)`, `(claude.ai sync)`) or the name is a
plugin skill `<plugin>:<skill>` (MCP prompts, `mcp:…`, excluded). Skills bundled with Claude Code carry no marker and stay under Agent.
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

The build also runs `scripts/smoke-claude-package.mjs`: with empty PATH it starts the packaged Worker
and checks the launcher's missing-CLI guidance. With a temporary fake external CLI it verifies delegation
and negotiates real ACP initialize. It rejects bundled native SDK packages. It sends no model requests
and does not prove login, permissions, real turns or desktop installation. See
[packaging validation](../../docs/claude-external-runtime-validation.md) for this change's evidence.

Release 0.4.1 declares `parameterScope: current-model`. Aibo selects the model first, refreshes its native parameters, and then offers reasoning strength. Only labels are displayed; parameter IDs remain opaque. Requires host SDK 0.1.7.

Release 0.4.2 changes the runtime requirement: install Claude Code yourself. Install this as a new release; existing sessions remain bound to their original plugin and do not automatically switch engines.

### 后台命令状态（0.4.5）

需要提供 SDK 0.1.9 / `background-tasks.list` 合同的宿主。插件向 ACP 声明 AIR `asyncTasks`，将原生 `async_task_spawned`、`async_task_progress`、`async_task_state_update` 映射成后台命令快照，和子 Agent 历史分开。主回复结束后仍接收完成通知；宿主查看会话时每两秒读取状态。显示任务名称、命令、运行/完成/失败/停止/未知、摘要和输出路径；路径仅展示，不读取任意文件。

重新建立原生连接后，历史运行中任务先显示“状态未知”，不能把 recovery 当进程存活证明。旧版本绑定、未暴露原生任务的 `nohup` / `&` 不会被推测为可追踪任务。当前 SDK 0.1.9 是协同开发版本，发布前使用 `AIBO_SDK=local pnpm run verify` 构建；npm 默认安装需等待相应 SDK 发布。

### 登录与授权（0.4.6）

需要包含 `plugin_authentication_action` 和 manifest `authentication` 合同的 Aibo 构建；
旧宿主不能安装带此字段的插件。SDK 仍为 0.1.9；仅满足 SDK 版本范围不代表宿主已支持此入口。

在「插件与能力」选择 Claude Code 并启用插件后，点击「登录 / 授权」。Aibo 在系统 Terminal 中
运行本机 `claude auth login`，按官方提示完成浏览器授权，再回到插件页点击「检查登录状态」
（`claude auth status`）。CLI 报告已登录后返回原会话手动重试；状态检查不证明远端 token 仍有效，
若继续提示 OAuth 过期，可重新授权。Aibo 不自动重发失败消息、不修改会话绑定、不保存凭据。
当前登录终端入口支持 macOS。已打开终端不等于登录成功；外部终端中的流程需由用户完成或取消。

## Subscription quota

Release 0.4.7 maps Claude's `_claude/rateLimit` events into 5-hour, weekly and available Opus/Sonnet weekly windows. Values are last observations, updated by events, not live account queries. Missing windows retain their prior observation within the current session runtime. At reset time the host shows unknown until new data arrives; a missing reset time is explicitly unknown. Reconnection clears observations. Extra paid usage is not included.

Requires the matching host SDK 0.1.10 build; reinstalling the previous plugin or using an older host is insufficient. While this SDK remains unpublished, build with `AIBO_SDK=local pnpm run verify`. See the [quota specification](../../docs/claude-quota-spec.md) and [validation](../../docs/claude-quota-validation.md).
