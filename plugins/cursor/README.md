# Cursor for Aibo

Use Cursor Agent in an Aibo workspace: stream replies and tool activity, choose native modes
and models, respond to questions and approvals, and continue supported saved sessions.
The plugin connects through the official Cursor CLI's `agent acp` interface.

[Install](../../docs/installation.md) · [Compatibility](../../docs/installation.md#compatibility) · [Changes](CHANGELOG.md)

## Requirements

- Current package: **0.2.4**; **macOS arm64** as declared in [plugin.json](plugin.json).
- Aibo with host SDK **`>=0.1.8 <0.2.0`**, optional-session-feature contracts, provider
  `sessionControls`, `agent-managed` execution, image attachments, and `aibo.host-tools/v1`.
- Cursor CLI installed and authenticated with `agent login`.
- A compatible Node.js 22+ runtime resolved by Aibo.

Model/parameter behavior was checked against CLI `2026.09.15-d2fe57e`, and skill markers
against `2026.09.18-9a7762b`. These are feature-specific baselines, not proof that every CLI version
or model works. See the [specification](../../docs/cursor-acp-spec.md) and
[validation record](../../docs/cursor-acp-validation.md).

## Install and start a conversation

1. Prepare the CLI and login above.
2. Obtain a built package using the [build guide](../../docs/installation.md#build-from-source).
3. Install and enable the emitted `cursor/` directory in Aibo's capability plugin manager.
4. Create a new Cursor session, choose a supported mode/model, and send a short request.

Existing sessions retain their original provider release until a supported migration succeeds.
Aibo supplies the runtime SDK; the source directory is not an installable build artifact.

## Modes and permissions

The plugin owns the **Agent**, **Ask**, and **Plan** menu through `sessionControls`.
They map to Aibo `edit`, `ask`, and `plan`, respectively. Each selection must be confirmed by Cursor ACP.
Debug is absent because the CLI interface used by this adapter does not offer it.

- **Agent:** Cursor manages filesystem, command, network and MCP permissions. Aibo admits the top-level
  write turn in a trusted workspace and forwards native approvals, using `allow_once` or `reject_once`.
- **Ask / Plan:** Cursor's native modes provide read-only behavior. Only a structured, current-turn tool call
  matching this process's private host MCP server and a declared read-only tool receives `allow_once`.
  Other tool permission requests remain rejected. Display titles never grant permission.
- These are native behavior contracts. Aibo does not inject Cursor permission rules, intercept every native
  tool call, or provide an OS sandbox, workspace-only writes or blocked network. Cursor user/project rules remain
  effective; already-allowed operations may not generate a prompt. Native permissions grant no Aibo Core tool access.

Opening Agent mode uses `workspace.read`; executing its turn separately requires
`aibo.session.turn.write` and `workspace.write`. Aibo automatic review and host-enforced sandbox profiles are rejected.

## Models, commands and images

| Feature | Behavior |
| --- | --- |
| Model selection | Negotiates `model.select` when ACP supplies a valid selector; native IDs, including Auto, remain opaque. |
| Reasoning and context | Uses Cursor's parameterized picker when available; options belong to the selected model. Native labels/order are preserved, and token counts are omitted unless explicitly provided. |
| Commands and Skills | Uses ACP `available_commands_update`, with a first-read wait of up to 10 seconds and later replacement snapshots. |
| Image input | Advertised only when ACP declares `agentCapabilities.promptCapabilities.image: true`; descriptors become native image content blocks. |

Model/parameter changes require an idle session and native confirmation. Selections are saved in recovery and
replayed after model selection; an explicit host model takes precedence and discards old-model parameters.
Multiple reasoning dimensions appear as explicit combinations. Auto may have no parameter choices.
The parameterized-picker negotiation is a Cursor extension, not a guarantee of core ACP.
Catalog visibility does not imply subscription entitlement or reveal the model routed behind Auto;
actual provider errors are preserved.

Commands are reloaded on resume. Slash text and arguments pass unchanged through the normal turn and approval path;
`additionalInstructions` applies only to ordinary messages. Aibo adds its own capability-gated shortcuts and wins name collisions.
Descriptions ending in `(builtin skill)`, `(project skill)` or `(user skill)` are classified as Skills;
unknown formats retain their description and Agent-command semantics. This is the ACP directory, not the full interactive CLI palette.

Images support PNG, JPEG, GIF and WebP: at most 8 per message, 10 MiB each and 20 MiB total.
Invalid descriptors, missing files, symbolic links, unsupported types and oversized images fail before the native turn.
Outgoing prompt frames allow 32 MiB for Base64; incoming frames remain limited to 8 MiB.
Host attachment references remain in accompanying text; image bytes are sent separately as ACP content.
CLI image capability does not guarantee that every selected model supports vision.

## Recovery and limits

Cursor does not persist empty sessions. Only a recovery binding explicitly marked `hasPrompt: false`
may create a replacement native session. After a prompt has been sent, or if an older binding lacks the marker,
resume must load the original session and fail explicitly if it cannot. Recovery replays confirmed model parameters
and applies the host-selected mode. It does not import Cursor Desktop conversations or reconstruct missing event tails.

The host derives the waiting queue from standard lifecycle contracts; IDs, FIFO, pause/resume and uncertain-delivery
handling remain host-owned. Native `queue.steer` is not advertised, so messages during a running turn wait for it to settle.
Cursor task metadata produces subagent cards, without invented `subagent.message` history.
Fast/service-tier, goal lifecycle, forks, remote session trees, branch timelines and thread snapshots remain undeclared.
Opaque recovery data is not `session.snapshot`. Only the host-authorized tool catalog is bridged into Cursor MCP.

## Development and validation

Run these from the repository root in an appropriate local environment:

- `pnpm run verify`: tests and packaged-worker smoke with a fake ACP engine; no real model or desktop acceptance.
- `node scripts/probe-cursor-models.mjs --prompt`: real catalog, model selection, Auto prompt and cross-process recovery.
- `node scripts/probe-cursor-parameters.mjs`: an Auto model prompt followed by real parameter selection and recovery.
- `node scripts/probe-cursor-commands.mjs`: native/workspace command directory and a local utility command.
- `node scripts/probe-cursor-question-browser.mjs`: documented question fixture through the Cursor adapter,
  host event projection and real App in Chromium, in both kits and themes; no native question emission claim.
- `node scripts/probe-cursor-ui.mjs`: real App in an isolated macOS WKWebView, system mouse/keyboard
  menu and send/cancel interactions, pasted image, native questions/approvals when emitted, and app restart.
  Takes the foreground. Writes `/private/tmp/aibo-cursor-ui-result.json`; `not-observed` is not a pass.
  Uses the committed 0.1.18 baseline (`d2616e4`) to check pinned old releases.
- `node scripts/probe-cursor-desktop.mjs --contract-only`: isolated host installation/menu contracts and
  Plan → Agent → Ask recovery without a model prompt; it does not replace visual interaction acceptance.

Native probes use temporary workspaces and attempt to restore changed model/parameter selections before closing.
Review each script's native requests and cleanup before running it. Consult the repository's
[checklist](../../docs/cursor-acp-checklist.md) for remaining acceptance work; this README does not claim it all passed.

## Icon attribution

The provider icon uses `General Logos/Cube/SVG/CUBE_2D_DARK.svg` from the
[Cursor brand assets](https://cursor.com/brand), uniformly scaled to 22 units high and centered in the host's
24 × 24 viewBox. The host supplies theme color. Cursor and its logo belong to Anysphere, Inc.;
the mark identifies this integration and is not covered by this repository's code license.

## Referenced conversation history

The plugin consumes the host catalog without hard-coding history tool names or database queries.
The host supplies `aibo_read_session` for references actually accepted in the current turn; it checks
workspace trust and reference ownership on every page. Concatenate JSONL `content` fragments until
`complete` is true. Limits and persisted-history scope are defined by the
[host tool contract](https://github.com/chldu2000/aibo/blob/main/docs/session-history-tool-design.md).

A separate, randomly named MCP server is passed to each ACP session. Credentials remain in the
stdio child's environment and are recreated after restart; they are not saved in recovery.
Cursor may discover MCP tools lazily on the first prompt, so open does not wait for `tools/list`.
This does not configure global MCP servers or auto-approve unrelated tools. Host history reads do
not enable Aibo Core filesystem/command tools. Old releases without the catalog continue normally.
