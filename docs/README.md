# Documentation

[English](README.md) | [简体中文](README_zh.md) · [Catalog](../README.md) · [Aibo](https://github.com/chldu2000/aibo)

## Use a plugin

- [Install and compatibility](installation.md): install a prepared package, version requirements, build from source, troubleshooting.
- [Cursor](../plugins/cursor/README.md): first session, modes, models, images, recovery limits.
- [Claude Code](../plugins/claude-code/README.md): first session, authorization, approvals, background tasks, quota, recovery limits.

## Build an extension

- [Build an Aibo plugin](plugin-development.md): quick start, what to copy for what you want to build, build commands, contracts, verification.
- [ACP agent template](../plugins/acp-template/README.md): connect a compatible agent by configuration.
- [Capability example](../plugins/capability/README.md): a read-only operation and a semantic view.
- [Presentation example](../plugins/presentation/README.md): a theme and default control inheritance.
- [Terminal](../plugins/terminal/README.md): an interactive tool view with its own frontend and backend.
- [Contributing](../CONTRIBUTING.md): report issues and submit changes.

## Specifications and acceptance evidence (maintainers)

Validation records describe the version and environment at the time; they do not show that later versions or platforms pass. These documents are in Chinese.

- Cursor: [spec](cursor-acp-spec.md), [checklist](cursor-acp-checklist.md), [validation](cursor-acp-validation.md), [research](cursor-integration-research.md).
- Claude Code: [external runtime validation](claude-external-runtime-validation.md), [quota spec](claude-quota-spec.md), [quota validation](claude-quota-validation.md).
- Terminal: [design](terminal-plugin-design.md), [validation](terminal-plugin-validation.md).
- [Self-contained runtime validation (history)](self-contained-runtime-validation.md): an early packaging approach; current install requirements are in the plugin README.
- Changelogs: [Cursor](../plugins/cursor/CHANGELOG.md), [Claude Code](../plugins/claude-code/CHANGELOG.md).
