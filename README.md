# Aibo Plugins

**More agents. More capabilities. Your workbench.**

[English](README.md) | [简体中文](README_zh.md)

Connect Cursor and Claude Code to [Aibo](https://github.com/chldu2000/aibo),
create an integration for a compatible ACP agent, or explore how to add capabilities and customize the interface.

[Install a plugin](docs/installation.md) · [Build an extension](docs/plugin-development.md) · [Documentation](docs/README.md)

## Find an integration or a starting point

| Project | What it adds | Start here |
| --- | --- | --- |
| Cursor | Cursor Agent sessions using the official `agent acp` interface | [Setup and capabilities](plugins/cursor/README.md) |
| Claude Code | Claude Code sessions with tool activity, approvals, questions, and reported subscription quota | [Setup and capabilities](plugins/claude-code/README.md) |
| ACP agent template | A configuration-driven starting point for a compatible ACP agent | [Customize the template](plugins/acp-template/README.md) |
| Capability example | A read-only operation, detail view, and refresh action | [Explore the example](plugins/capability/README.md) |
| Presentation example | An Ocean theme and agent status control, inheriting other host controls | [Explore the example](plugins/presentation/README.md) |

Agent capabilities depend on the native implementation, model, and negotiated support.
The template needs configuration before use; agent-specific extensions may require code.

## Install and use

You need a compatible **Aibo desktop build**, the **built plugin directory**, and the native
agent dependencies listed in the plugin guide. You do not need a source checkout or npm to
install a prepared plugin package.

1. Check the [compatibility table](docs/installation.md#compatibility) and prepare the agent's CLI/login.
2. For an agent or capability plugin, install the built directory containing `plugin.json` through
   Aibo's capability plugin manager, then enable it.
3. For a presentation package, use **安装皮肤插件**, select the directory containing
   `presentation.json`, then select that presentation.
4. Create a new session to try a newly installed agent release.

This repository documents local build outputs. If you do not have a prepared package, follow
[Build from source](docs/installation.md#build-from-source). Copying a source directory or
installing a Git repository URL is not this installation workflow.

## Build and develop

Use Node.js 22+, pnpm, npm, and tar. Tests need a matching Aibo source checkout, normally at
`../aibo`, with its dependencies installed. For the current source combination:

```sh
pnpm install
pnpm prepare:deps
AIBO_SDK=local pnpm run verify
```

The current Claude Code plugin requires host SDK 0.1.10, while the host's recorded published
SDK baseline is 0.1.8. The local SDK option builds against the matching host source;
install the result into a desktop build with those host features. See
[compatibility and build details](docs/installation.md).

Build output contains five installation directories under a fresh `dist/build-*` directory.
The ACP template must be configured for a real agent before it is usable. SDK code is supplied
by Aibo at runtime; third-party dependencies needed by a plugin are packaged at build time.

Start with the [development guide](docs/plugin-development.md) for packaging and verification,
or the [ACP template](plugins/acp-template/README.md) for agent integration.

## Help improve an integration

Report the Aibo build, OS/architecture, plugin and CLI versions, reproduction steps, and a
redacted error in an [issue](https://github.com/chldu2000/aibo-plugins/issues).
See [Contributing](CONTRIBUTING.md) before changing an adapter or adding a new one.

This repository is licensed under the [MIT License](LICENSE). Bundled dependencies
and third-party marks retain their respective licenses and ownership.
