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

Use Node.js 22+, pnpm, npm, and tar. No Aibo source checkout is needed:

```sh
pnpm install
pnpm prepare:deps
pnpm build
```

The build prints the installable directories (under a fresh `dist/build-*`). Install those, not the
source folders. `pnpm build --only=cursor,capability` builds a subset; `pnpm verify` runs tests plus
the build. The terminal plugin needs Rust and is skipped without it. All SDK versions the plugins
require are published, so no unpublished SDK is needed; `AIBO_SDK=local` (or `AIBO_ROOT`) is only for
verifying against a host checkout with SDK or contract changes that are not published yet.

The ACP template must be configured for a real agent before it is usable. SDK code is supplied
by Aibo at runtime; third-party dependencies needed by a plugin are packaged at build time.

Start with [Build an Aibo plugin](docs/plugin-development.md): a quick start, a table that maps
what you want to build to the plugin to copy, and the verification steps. Compatibility is in
[docs/installation.md](docs/installation.md).

## Help improve an integration

Report the Aibo build, OS/architecture, plugin and CLI versions, reproduction steps, and a
redacted error in an [issue](https://github.com/chldu2000/aibo-plugins/issues).
See [Contributing](CONTRIBUTING.md) before changing an adapter or adding a new one.

This repository is licensed under the [MIT License](LICENSE). Bundled dependencies
and third-party marks retain their respective licenses and ownership.
