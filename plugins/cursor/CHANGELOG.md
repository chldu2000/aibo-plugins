# Cursor integration changes

[Current setup and capabilities](README.md)

These notes preserve earlier implementation baselines. Current requirements are in the README
and manifest; historical minimum SDK versions do not override the current package requirements.

## 0.2.4

The package now declares host SDK `>=0.1.8 <0.2.0` and uses the `@aibolabs/*` SDK packages.

## 0.2.3

Release 0.2.3 requires host SDK 0.1.7 and declares `parameterScope: current-model`. Aibo selects a model before offering its reasoning and context options. Auto may have no parameter options.

## Earlier integration changes

Release 0.2.2 runs on the host SDK's generic ACP Worker (`serveAcpAgent` from `@aibolabs/acp-adapter/worker`,
host SDK 0.1.3) with `cursorExtension`; routing, host tools and lifecycle are unchanged, now shared with
configuration-only ACP plugins. It requires host SDK 0.1.3.

Release 0.2.1 explicitly declares Cursor question support after the generic adapter stopped assuming
that every ACP agent implements vendor questions. Resume is advertised only when the native agent
confirms load support. It also maps native question prompts to host question text and converts selected
display labels back to native option IDs, rejecting ambiguous matches. This is a new installation;
existing sessions retain their pinned release.

Release 0.2.0 moves the generic ACP transport, session mapping, model configuration and image input
into the host SDK's `@aibolabs/acp-adapter`; this plugin keeps only Cursor behaviour (authentication,
mode mapping, recovery schema, `cursor/*` methods and command and model heuristics). Behaviour is
unchanged from 0.1.18. It requires host SDK 0.1.2. Install it as a new release; existing sessions
retain their pinned installation.

Release 0.1.18 added the generic host-tool catalog through a private MCP stdio bridge, which needs
the `aibo.host-tools/v1` host contract.
