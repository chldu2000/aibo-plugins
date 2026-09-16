# Aibo Cursor Agent

This capability plugin starts the official Cursor CLI as `agent acp` and maps its ACP v1 session to Aibo Runtime 2.1.

Prerequisites:

- Cursor CLI `2026.09.10-fd3934a` or a compatible release.
- Run `agent login` before starting Aibo.
- Node.js 22 or newer.

Supported execution profiles:

- Ask and Plan: read-only filesystem, commands and network disabled, no approval reviewer.
- Edit: workspace-write filesystem, approved commands, network disabled, user/on-request approval.

The current Aibo host classifies third-party providers as an unnegotiated enforcement backend and therefore dispatches only its restricted Ask profile to this plugin. Edit support is implemented at the plugin boundary but requires host enforcement negotiation before it is available in the Aibo UI.

This release intentionally rejects full-access, automatic review, model selection, reasoning selection and attachments. It does not import Cursor Desktop conversations or expose Aibo tools as MCP tools.

With Aibo `dd2a458` or newer, the host derives `queue.manage` from this plugin's standard Runtime 2.1 open/turn/cancel/close contracts. Waiting messages, stable IDs, FIFO delivery, pause/resume and uncertain-delivery handling remain host-owned. This release does not advertise native `queue.steer`: messages submitted during a running Cursor turn wait for that turn to settle, while send-now remains available when the session is idle.

Cursor ACP does not currently provide the native goal or subagent history contracts required by Aibo, so this release does not report goal or subagent capabilities and does not synthesize their events from ordinary tools.

Build from the repository root with `pnpm run verify`, then install the emitted `cursor` directory from Aibo's capability plugin manager.
