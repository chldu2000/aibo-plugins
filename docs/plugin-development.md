# Build an Aibo plugin

[English](plugin-development.md) | [简体中文](plugin-development_zh.md)

This guide is for people who build or change plugins. To only install and use one, read the
[installation guide](installation.md). Version requirements live in one place, the
[compatibility table](installation.md#compatibility); this guide does not repeat them.

## Quick start

Requirements: Node.js 22+, pnpm, npm and tar. No Aibo source checkout is needed.

```sh
cd aibo-plugins && pnpm install
pnpm prepare:deps                       # once: Claude Code runtime dependencies
pnpm build
```

`pnpm build` ends by printing the installable directories:

```text
Install these directories in Aibo (not the source folders under plugins/):
  capability    …/aibo-plugins/dist/build-AbC123/capability
  cursor        …/dist/build-AbC123/cursor
  acp-template  …/dist/build-AbC123/acp-template
  claude-code   …/dist/build-AbC123/claude-code
  presentation  …/dist/build-AbC123/presentation
```

Install one of them (for example `capability/`) through **插件与能力** in Aibo and enable it. Presentation
packages are installed through **安装皮肤插件**. Always install the printed directory, never a folder
under `plugins/`. An installed release is not overwritten by a rebuild with the same ID and version: see
[releases](#releases-and-versions).

Neither `pnpm build` nor `pnpm test` reads host sources: the SDK comes from npm, and the host contracts the tests
check against ship in `@aibolabs/plugin-protocol`. A host checkout is only needed to
[verify against unpublished host changes](#build-commands) and for the [maintainer probes](#host-probes).

## What do you want to build?

| I want to… | Copy | Edit | Check |
| --- | --- | --- | --- |
| Connect an ACP-compatible agent | [`acp-template`](../plugins/acp-template/README.md) | `plugin.json`, `acp.json` | `test/acp-plugins.test.mjs`; open a session |
| Add a read-only operation and a detail view | [`capability`](../plugins/capability/README.md) | `plugin.json`, `worker.ts` | Run the command from global search |
| Change the theme or a host control | [`presentation`](../plugins/presentation/README.md) | `presentation.source.json`, `worker.js` | Select it in the presentation manager |
| Add an interactive panel with its own UI and backend | [`terminal`](../plugins/terminal/README.md) | `frontend.js`, `style.css`, `backend/` | `pnpm test:terminal` (needs Rust) |
| Add an agent with vendor-specific methods | [`cursor`](../plugins/cursor/README.md) | `worker.mjs`, extension | [Cursor spec](cursor-acp-spec.md) |

Sections below show each path in more detail. Cross-repository links point to the host
documentation on GitHub; when you verify against a host checkout, check the contract there.
Host-private helpers and built-in engines are behavior references only; never import them into a plugin.

## Build commands

| Goal | Command |
| --- | --- |
| Build everything (default) | `pnpm build` |
| Build only some plugins | `pnpm build --only=cursor,capability` (names: `capability`, `cursor`, `acp-template`, `claude-code`, `presentation`, `terminal`) |
| Build the terminal plugin | install Rust, then `pnpm prepare:terminal && pnpm build --only=terminal` |
| Run the tests | `pnpm test` |
| Tests and a full build | `pnpm verify` |
| Verify against a host checkout (unreleased SDK or contracts) | `AIBO_SDK=local pnpm verify` (uses `../aibo`) or `AIBO_ROOT=/absolute/path/to/aibo pnpm verify` |

Without `--only`, `terminal` is built only when `cargo` is found; otherwise it is skipped with a notice.
`pnpm test` skips the terminal backend tests without Rust; `pnpm test:terminal` runs them.

**Default (npm SDK).** Each plugin is built in an isolated copy with `npm ci` from its `package-lock.json`.
The `@aibolabs/*` development dependencies come from `https://registry.npmjs.org/` (pinned by `.npmrc` and the
build flags, even when a mirror is configured). The build compiles the capability example with this project's
TypeScript, bundles Cursor's `.mjs` directly, and builds presentation resources with `@aibolabs/presentation-tools`
(length and SHA-256 are generated, not handwritten). The two packaged-worker smoke checks load the SDK from that
isolated copy, and `pnpm test` from this repository's `node_modules`, the way Aibo injects it at runtime; manifests and
operation schemas are checked against the contracts in `@aibolabs/plugin-protocol`. Use this for daily work and for
any revision whose SDK versions are already published.

**`AIBO_SDK=local` / `AIBO_ROOT`.** Packs the SDK and presentation tools from the host source (`../aibo`, or
`AIBO_ROOT`) and installs them offline. Tests and smoke checks then load the SDK through the host's own resolver
and read contracts from that checkout, which is also how to check compatibility with a specific host revision.
Use it only to verify SDK or contract changes that are not published yet. The packages must still be published, and the
compatibility table updated, before a release depends on them.

Installable output never contains `node_modules/@aibolabs`; the host supplies the public SDK at runtime. When you
use a bundler, mark SDK entry points as external. Bundle third-party runtime libraries yourself or include them
in the output: Aibo does not run `npm install` on installation, and neither `dependencies` nor `npm pack` adds them.
Check the unpacked dependencies, paths and symlinks.

## Modify the capability example

Start from [plugin.json](../plugins/capability/plugin.json) and [worker.ts](../plugins/capability/worker.ts).

1. Replace `dev.aibo.starter.greeting` with your own namespace in the plugin, contribution, capability and operation
   IDs. The worker handshake `{capability, version, operationId}` must match the manifest.
2. Keep the npm package, manifest and the release version reported by the worker in sync. Declare scope, effect,
   permissions, `timeoutMs`, idempotency and input/output schemas accurately; a successful build does not widen the
   supported platforms.
3. Implement the allowed operations. The example receives `{ actionId: "refresh", itemId: null, offset: 0 }` and
   returns `state`, `view` and `actions`; the host adds snapshot identity and revision.
4. stdout carries only the protocol; write logs to stderr. Honor `tools.signal` and call declared dependencies
   through `tools.call`. Writes need matching effects and permissions. After a cancellation or unknown result, do not
   retry blindly.

This example is not a session agent. Before adding a session provider read
[session negotiation](https://github.com/chldu2000/aibo/blob/main/docs/session-capability-negotiation.md) and
[session controls](https://github.com/chldu2000/aibo/blob/main/docs/session-controls.md), and carry the contract
through the manifest, runtime handshake, open capabilities, routing and response envelopes. Model and command
catalogs must also return the recovery and capabilities the contract requires. Feature support, current availability
and authorization to execute are judged separately. Cursor-specific mappings live in the current spec and must not
become defaults for other providers.

## Connect an ACP agent

An agent that works with the generic adapter starts from the [ACP template](../plugins/acp-template/). Basic
integration is configuration: in `plugin.json` replace the plugin ID, platforms and executable dependencies; in
`acp.json` give the launch command, arguments and the mapping from `ask` / `plan` / `edit` to the native modes.
`worker.mjs` calls the host SDK's `serveAcpAgent`, and capabilities narrow to the agent's `initialize` response.
Field descriptions are in the template README; generic behavior is in the host's
[`@aibolabs/acp-adapter`](https://github.com/chldu2000/aibo/blob/main/packages/acp-adapter/README.md). The
[Claude Code plugin](../plugins/claude-code/) is a real example of this route. For vendor-specific methods, pass
`extension` as the Cursor plugin does. `test/acp-plugins.test.mjs` checks the template manifest against the host
contract; keep a similar test after copying it.

## Modify the presentation example

The source manifest is [presentation.source.json](../plugins/presentation/presentation.source.json); the build
generates the final manifest, so never write digests by hand. The current
[worker.js](../plugins/presentation/worker.js) returns a status node (including the host label) only for
AgentStatusMark; other controls return `null` and inherit the host implementation. The skeleton declares no
semantic or workbench surface and does not draw optional agent icons.

- Themes use paired `themes` / `defaultThemeId`; the worker uses paired `entry` / `surfaces`.
- An entry must be self-contained. Bundlers do not inline imports for you and Svelte/DOM components are not converted.
- Return a restricted visual tree with stable keys, and bind only the opaque action tokens the host currently provides.
- `null` inheritance applies to controls. When adding semantic or workbench surfaces, keep the business semantics the
  contract requires.
- The host keeps persistent business state, approvals, settings management and recovery. Internal `UiKitAdapter`
  controls do not automatically become external controls.

Before adding icons, a session-creation menu, model controls or whole-window presentation, check the presentation
contract below and the specific contracts, and compare the SDK types with the target host snapshot. This guide does
not keep a second field table.

## Interactive terminal and toolView

[`plugins/terminal/`](../plugins/terminal/README.md) uses the host's separate `toolView` contract: the plugin
provides its own frontend and a native backend. This contract is independent of semantic and presentation plugins.
The full build adds a `terminal/` directory; run `pnpm prepare:terminal` before the first build. Compiling needs Rust,
but users of the built package need neither a toolchain nor Node. Visual rules (host tokens, one-row toolbar, no
permanent recovery row) are in the host [tool view contract](https://github.com/chldu2000/aibo/blob/main/docs/tool-view-contract.md)
and the [terminal design](terminal-plugin-design.md).

## Find the host contract for a task

| Change | Authoritative document |
| --- | --- |
| Manifest, discovery, icons, public SDK, install packages | [Plugin guide](https://github.com/chldu2000/aibo/blob/main/docs/plugin-development.md), [host SDK](https://github.com/chldu2000/aibo/blob/main/docs/host-sdk.md) |
| Optional capabilities, schemas, response envelopes, degradation | [Session negotiation](https://github.com/chldu2000/aibo/blob/main/docs/session-capability-negotiation.md) |
| Mode menu, execution settings, native permission ownership | [Session controls](https://github.com/chldu2000/aibo/blob/main/docs/session-controls.md) |
| Setting declarations, three-level inheritance, effective empty values, version isolation | [Agent settings](https://github.com/chldu2000/aibo/blob/main/docs/agent-plugin-settings.md) |
| Models, reasoning, Fast, context selection and usage | [Model configuration](https://github.com/chldu2000/aibo/blob/main/docs/model-configuration.md) |
| Goal lifecycle, pause/resume, admission | [Goals](https://github.com/chldu2000/aibo/blob/main/docs/goal-lifecycle.md) |
| Subtask events, root turns, process history, degradation | [Subagent history](https://github.com/chldu2000/aibo/blob/main/docs/subagent-history.md) |
| Durable host queue and native steering | [Message queue](https://github.com/chldu2000/aibo/blob/main/docs/message-queue.md) |
| Visual trees, icons, navigation, external controls, actions | [Presentation package](https://github.com/chldu2000/aibo/blob/main/docs/presentation-package.md) |
| Terminal-style tool views | [Tool view contract](https://github.com/chldu2000/aibo/blob/main/docs/tool-view-contract.md) |

## Install and verify

1. Run `pnpm verify` and record the test result and the printed directories.
2. Install and enable `capability/` in the capability plugin manager, open **Aibo starter greeting** from the command
   entry, and check “你好，Aibo！” and refresh. For Cursor, see its plugin README for installation and dependencies.
3. Install and select `presentation/` in the presentation manager. Check the Ocean theme, the status label and the
   default inheritance of other controls.
4. Check disable, restart, upgrade and recovery. If a presentation fails, press Ctrl/Command+Shift+Backspace to
   restore the host presentation.

`verify` covers unit tests, TypeScript compilation, capability archive integrity, presentation manifest/resource/
control checks with default inheritance, and a smoke test of the packaged Cursor worker (handshake, streaming events,
response contract) against a fake ACP engine, plus the packaged Claude Code worker. It does not start a real desktop
or model; launching a worker and waiting on stdin is not a smoke success.

Session or presentation changes also need native and UI acceptance per the specific contract, covering the built-in
Material 3, ak-ui light and dark themes, and external presentations. Cursor records remaining gates in its
[checklist](cursor-acp-checklist.md); old ticks do not replace this run. When you change the host, run `pnpm run verify`
there and follow the
[regression matrix](https://github.com/chldu2000/aibo/blob/main/docs/plugin-boundaries-and-regression.md#regression-gate).
Keep simulated ACP, packaged worker, real CLI, isolated host probe and real desktop interaction apart, and keep what
was not verified.

## Releases and versions

Change the release version whenever runtime or build output changes (manifest, `package.json` and the version the
worker reports); documentation-only changes need no version bump. An artifact with the same ID and version but
different content must not overwrite an installed release. Test a new version in a new session; old sessions keep their
original installation and contribution, and are not silently rebound. When recording a verification, note the host
commit or build, plugin release, Node version and exact native CLI version.

Protocol, SDK and plugin releases are checked separately:

| Dimension | Where to check |
| --- | --- |
| Manifest schema | `aibo.plugin-manifest/v2`; host range and platforms in each package manifest |
| Host SDK range | The [compatibility table](installation.md#compatibility) and each `hostSdk` field |
| Runtime | Capability example 2.0; Cursor declares 2.1 for streaming events and control |
| Semantic view | Capability example 1.0 / `aibo.semantic-view/v1` |
| Presentation | `aibo.presentation-package/v1`, hostApi/coreSemantics 1.0.0; also check real snapshots and the action contract |
| Cursor sessions | Exact optional-feature contracts, provider `sessionControls`, `agent-managed` permission ownership, `image.input` attachments |

A source version is not a published host version. Satisfying the `hostSdk` range alone does not prove a plugin's
required host features exist (for example Cursor's native permission declaration from 0.1.15 needs a host with
migration 0047).

## Maintainer reference

### Generic host tools

SDK 0.1.1 provides `@aibolabs/capability-runtime/host-tools`. A new agent plugin declares a versioned catalog and
standard response operations, then only adapts native tool registration or MCP configuration; the host handles full
queries, with no brand branches. See the
[host tool contract](https://github.com/chldu2000/aibo/blob/main/docs/session-history-tool-design.md) and the Cursor
0.1.18 example.

### Self-contained Claude Code runtime

The Claude Code plugin uses its packaged `launch-acp.mjs`, finds the user-installed `claude` on the host PATH, and
passes it to ACP through `CLAUDE_CODE_EXECUTABLE`. The manifest requires Claude Code >=2.1.280. The ACP and SDK
JavaScript dependencies ship inside the plugin, so users need no separate Node, npm or global ACP.

Prepare and build with `npm ci --omit=dev --omit=optional`, which excludes the SDK's native optional packages (the
lockfile keeps their metadata). Type files and source maps are removed; JS, resources and licenses stay. The output
must not contain a native Claude executable, and the unpacked size must stay under 32 MiB; the host's own 4096 files /
256 MiB limit still applies. Installation does not run npm; the worker and ACP share the host's private Node.
Only darwin-arm64 is published now; other platforms are not accepted yet. When upgrading dependencies, update the
runtime `package.json` and lockfile, and verify compatibility with the user's CLI. The complete native-program
bundling of 0.4.0 / 0.4.1 is history; old sessions stay bound to the old release.

### Host probes

The `probe-*` scripts (for example `pnpm probe:cursor:desktop`) are manual diagnostics, not part of `pnpm verify`.
They need a host checkout with its dependencies installed (`../aibo` or `AIBO_ROOT`), because they use its Vite,
Playwright, Node runtime and plugin resolver.

### Sequential model and parameter selection

Claude Code 0.4.1 and Cursor 0.2.3 require hostSdk >=0.1.7 and declare `parameterScope: current-model` through the
new `model.select` output variant. Configuration-based plugins write it in `acp.json`; code plugins in `AcpExtension`.
See [model configuration](https://github.com/chldu2000/aibo/blob/main/docs/model-configuration.md) for the contract
and the behavior of older versions. After an upgrade, new sessions use the new release; existing sessions are not
rebound.
