# Capability example

Add a read-only operation and a semantic detail view to Aibo. This example displays
“Aibo starter greeting” with a refresh action; it is a development starting point, not an agent.

## Try it

Follow the [build guide](../../docs/installation.md#build-from-source), then install and enable the
emitted `capability/` directory in Aibo's capability plugin manager. Open global search, find
**Aibo starter greeting** in commands, and run it. Check the greeting detail and refresh action.

The current manifest is the source of truth for [requirements](plugin.json); a summary is in
[compatibility](../../docs/installation.md#compatibility).

## Make it yours

Start with [plugin.json](plugin.json) and [worker.ts](worker.ts). Rename plugin, contribution,
capability, and operation IDs together. Keep the Worker handshake aligned with the manifest,
and implement only declared operations. See [the development guide](../../docs/plugin-development.md#修改能力示例)
for permissions, cancellation, packaging, and verification.
