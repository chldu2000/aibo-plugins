# ACP agent template

Configuration-only session provider for an agent that speaks the [Agent Client Protocol](https://agentclientprotocol.com).
For agents compatible with the generic adapter, basic integration is configuration-only: the host SDK's `@aibolabs/acp-adapter/worker` reads `plugin.json` and `acp.json`.

Current requirements are in the [compatibility table](../../docs/installation.md#compatibility).
This template is a starting point, not a ready-to-use agent integration.

## Configure your agent

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

With host SDK 0.1.4, an agent that switches modes from an approval (for example approving a plan) can declare
it: map an `auto` write mode if the agent has one, add `transitions` to the source control, switch
`approval.respond` to its `{ requestId, optionId }` input, and list the native options in `acp.json`
`approvalOptions` with a `sessionControl`. See `plugins/claude-code` and the
[adapter documentation](https://github.com/chldu2000/aibo/blob/main/packages/acp-adapter/README.md).
With host SDK 0.1.5, set `"elicitation": true` and add the `user-input.respond` operation to show the agent's
ACP form requests as Aibo questions.

Capabilities follow the agent's `initialize` response: resume only with `loadSession`, image input
only with image prompts, model and parameter selection only when the agent returns config options.
To offer Aibo's host tools, add `"hostTools": ["aibo.host-tools/v1"]` and the `aibo.session.tool.respond`
operation (see the Cursor plugin). Agent-specific ACP extensions need code: pass an `extension`
to `serveAcpAgent`, as `plugins/cursor` does.

An invalid `acp.json` stops the worker before the Runtime handshake, so the host reports it at startup.

## Build and try it

Follow the [build guide](../../docs/installation.md#build-from-source) using a matching Aibo checkout.
Install and enable the emitted `acp-template/` directory in the capability plugin manager,
then create a new session. Validate native login, a real prompt, cancellation, and supported
recovery before claiming your integration is ready. See [development verification](../../docs/plugin-development.md#安装与验证).
