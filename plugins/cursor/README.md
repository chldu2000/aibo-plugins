# Aibo Cursor Agent

This capability plugin starts the official Cursor CLI as `agent acp` and maps its ACP v1 session to Aibo Runtime 2.1.

Prerequisites:

- Cursor CLI `2026.09.15-d2fe57e` (model catalog validated), or a compatible release.
- Run `agent login` before starting Aibo.
- Node.js 22 or newer.
- For version 0.1.12+, an Aibo build supporting host SDK 0.1.x (`hostSdk`). The plugin no longer bundles Aibo SDK packages.

Supported execution profiles:

- Ask and Plan: read-only filesystem, commands and network disabled, no approval reviewer.
- Edit: workspace-write filesystem, approved commands, network disabled, user/on-request approval.

Aibo selects enforcement from host-authorized installation grants or an implemented Core tool gateway, not the plugin name. Cursor uses ACP native tool execution and does not implement `aibo.session.tool.respond`; it therefore remains unnegotiated and receives only the restricted Ask profile. Edit and Plan support at the plugin boundary does not grant host execution authority or enable those modes in the Aibo UI.

This release intentionally rejects full-access, automatic review and attachments. It does not import Cursor Desktop conversations or expose Aibo tools as MCP tools.

With Aibo `dd2a458` or newer, the host derives `queue.manage` from this plugin's standard Runtime 2.1 open/turn/cancel/close contracts. Waiting messages, stable IDs, FIFO delivery, pause/resume and uncertain-delivery handling remain host-owned. This release does not advertise native `queue.steer`: messages submitted during a running Cursor turn wait for that turn to settle, while send-now remains available when the session is idle.

Cursor task tool calls are projected as Aibo subagent task cards with stable IDs and explicit terminal states. Cursor ACP currently exposes only completion-level task metadata, so this release does not invent `subagent.message` history. It also does not report goal capabilities because ACP has no matching goal lifecycle.

Build from the repository root with `pnpm run verify`, then install the emitted `cursor` directory from Aibo's capability plugin manager.

Version 0.1.8 negotiates `model.select` when Cursor ACP supplies a model config selector. Aibo displays the backend's catalog (including Auto), reads its current value, and switches models through `session/set_config_option`. References are opaque: Auto may be `default[]`, not `auto`. Selection is confirmed against the returned config, persisted in recovery, and reapplied after loading; an explicit host profile model takes precedence. Running turns reject model changes. ACP config updates refresh the cached catalog, including while idle.

Catalog membership does not imply subscription entitlement. Premium models remain listed; Cursor's actual prompt-time permission/subscription errors are preserved. No plan, lock state, or hidden model behind Auto is inferred.

Use the newly installed release for a new Aibo session; existing sessions remain pinned to their original plugin release. `node scripts/probe-cursor-models.mjs --prompt` checks the real catalog, selection, an Auto reply and cross-process recovery in a temporary workspace, then restores the original model configuration.

Version 0.1.9 enables Cursor's `_meta.parameterizedModelPicker` negotiation and adds
`model.reasoning` and `model.context-window`. Levels retain native names and ordering;
multiple thought parameters (e.g. Thinking and Effort) appear as explicit combinations.
Level IDs are model-scoped opaque IDs, so identical labels on different models do not
claim equivalent semantics. Context choices retain native IDs and labels; token counts
are omitted unless explicitly supplied by the backend.

ACP supplies parameter definitions for the current model only. Select a model first to
load its reasoning/context choices. Auto can have no parameter choices. Unsupported
CLIs retain the variant model selector. This extension is verified against CLI
`2026.09.15-d2fe57e`; it is a Cursor-specific compatibility dependency, not core ACP.
Settings are confirmed, saved in recovery and replayed after model selection on resume.
A different explicit profile model discards previous-model parameter choices. Fast and
other unrelated native parameters are left to Cursor. Run
`node scripts/probe-cursor-parameters.mjs` for real selection/recovery checks.

Version 0.1.10 adds `command.list` through `dev.aibo.cursor.command.list`.
Cursor's `available_commands_update` supplies native command names, descriptions and
argument hints for the `/` menu, including workspace commands. The first directory
read waits up to 10 seconds for the asynchronous notification; no notification yields
an empty directory. Later reads use the latest replacement snapshot. Commands are
reloaded from Cursor on resume, never restored from a stale recovery snapshot.

Slash input is sent unchanged through the usual turn/approval path. Additional
instructions apply to ordinary messages only: prefixing a slash command would prevent
Cursor from recognizing it. The plugin directory contains only ACP-advertised commands, not the full interactive
CLI palette. Aibo merges its own capability-gated shortcuts into the menu; host shortcuts
take precedence on name collisions.
Run `node scripts/probe-cursor-commands.mjs` to check the real native/workspace directory
and a local native utility command without sending a model request.


Version 0.1.11 targets Aibo `7865fad` or newer. All six optional operations pin the
host's `session-features.v1.json` input/output contracts. Command, model, reasoning
and context-window replies include `recovery` and the current `capabilities` alongside
their native data; initialization advertises the same versioned operations. Host
availability is the intersection of these declarations, the manifest and runtime
handshake. Invalid or missing model/parameter selections are still rejected by the
provider before calling ACP, even though the shared envelope allows omitted set fields.

Native commands supply `insertionText: "/name "`; no host brand-specific prefix logic
is required. Session tree, branch timeline, forks, compaction and goal lifecycle remain
undeclared because this adapter does not implement those contracts. `session.snapshot`
is not a synonym for this plugin's opaque recovery data.
