# Aibo Cursor Agent

This capability plugin starts the official Cursor CLI as `agent acp` and maps its ACP v1 session to Aibo Runtime 2.1.

Prerequisites:

- Cursor CLI `2026.09.15-d2fe57e` (model catalog validated), or a compatible release.
- Run `agent login` before starting Aibo.
- Node.js 22 or newer.

Supported execution profiles:

- Ask and Plan: read-only filesystem, commands and network disabled, no approval reviewer.
- Edit: workspace-write filesystem, approved commands, network disabled, user/on-request approval.

The current Aibo host classifies third-party providers as an unnegotiated enforcement backend and therefore dispatches only its restricted Ask profile to this plugin. Edit support is implemented at the plugin boundary but requires host enforcement negotiation before it is available in the Aibo UI.

This release intentionally rejects full-access, automatic review, reasoning selection and attachments. It does not import Cursor Desktop conversations or expose Aibo tools as MCP tools.

With Aibo `dd2a458` or newer, the host derives `queue.manage` from this plugin's standard Runtime 2.1 open/turn/cancel/close contracts. Waiting messages, stable IDs, FIFO delivery, pause/resume and uncertain-delivery handling remain host-owned. This release does not advertise native `queue.steer`: messages submitted during a running Cursor turn wait for that turn to settle, while send-now remains available when the session is idle.

Cursor task tool calls are projected as Aibo subagent task cards with stable IDs and explicit terminal states. Cursor ACP currently exposes only completion-level task metadata, so this release does not invent `subagent.message` history. It also does not report goal capabilities because ACP has no matching goal lifecycle.

Build from the repository root with `pnpm run verify`, then install the emitted `cursor` directory from Aibo's capability plugin manager.

Version 0.1.8 negotiates `model.select` when Cursor ACP supplies a model config selector. Aibo displays the backend's catalog (including Auto), reads its current value, and switches models through `session/set_config_option`. References are opaque: Auto may be `default[]`, not `auto`. Selection is confirmed against the returned config, persisted in recovery, and reapplied after loading; an explicit host profile model takes precedence. Running turns reject model changes. ACP config updates refresh the cached catalog, including while idle.

Catalog membership does not imply subscription entitlement. Premium models remain listed; Cursor's actual prompt-time permission/subscription errors are preserved. No plan, lock state, or hidden model behind Auto is inferred. Separate reasoning controls remain unsupported.

Use the newly installed release for a new Aibo session; existing sessions remain pinned to their original plugin release. `node scripts/probe-cursor-models.mjs --prompt` checks the real catalog, selection, an Auto reply and cross-process recovery in a temporary workspace, then restores the original model configuration.
