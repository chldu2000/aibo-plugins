# ACP agent template

Configuration-only session provider for an agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com).
No code is needed: the host SDK's `@aibo/acp-adapter/worker` reads `plugin.json` and `acp.json`.

1. In `plugin.json`, set `pluginId`, `displayName` and `platforms`, and replace `my-acp-agent` in
   `executableDependencies` with the agent's executable. Rename the `org.example.acp-agent.*`
   capability IDs to your plugin ID; keep the operation schemas unchanged (they must match the host contracts).
2. In `acp.json`, set `label` (used in messages), `command` (the declared executable), `args`
   (the flags that start its ACP server), and `modes`: the agent's native mode IDs for Aibo's
   `ask`, `plan` and `edit`. `edit` is the only mode that runs write turns. Optional fields:
   `authMethodId` (an advertised ACP auth method run before each session), `persistsEmptySessions`
   (default `true`; set `false` if the agent drops sessions that never received a prompt),
   `clientMeta` and `requestPrefix`.
3. Adjust `sessionControls` to the modes you mapped. The provider uses `agent-managed` execution:
   the agent owns file, command and network permissions and Aibo forwards its approval requests.

Capabilities follow the agent's `initialize` response: resume only with `loadSession`, image input
only with image prompts, model and parameter selection only when the agent returns config options.
To offer Aibo's host tools, add `"hostTools": ["aibo.host-tools/v1"]` and the `aibo.session.tool.respond`
operation (see the Cursor plugin). Agent-specific ACP extensions need code: pass an `extension`
to `serveAcpAgent`, as `plugins/cursor` does.

An invalid `acp.json` stops the worker before the Runtime handshake, so the host reports it at startup.
