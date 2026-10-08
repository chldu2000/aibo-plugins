# Contributing to Aibo Plugins

Report problems in [issues](https://github.com/chldu2000/aibo-plugins/issues). Include the expected
and actual behavior, reproduction steps, host build/commit, plugin and CLI versions, OS/architecture,
and redacted diagnostics. For application-wide behavior, use [Aibo issues](https://github.com/chldu2000/aibo/issues).

## Change or add an integration

Read [AGENTS.md](AGENTS.md), the [development guide](docs/plugin-development.md), and the
specific adapter's current requirements. Start a compatible ACP integration from the
[template](plugins/acp-template/README.md), and keep vendor-specific behavior in its extension.
Declare only implemented and verified capabilities.

Use a matching host checkout. Follow [build instructions](docs/installation.md#build-from-source)
and run `pnpm run verify` with the SDK source required by the revision. Runtime or UI changes also
need the relevant native and desktop checks. Report which layers were tested; a fake ACP smoke
is not proof of real account access or desktop behavior.

For documentation-only changes, check content against manifests and current contracts, validate
links, and review the diff. Keep the English and Chinese catalog aligned. Update the compatibility
table when changing package requirements, and put release history in the plugin changelog.

If a change also modifies Aibo, follow its contracts and verification requirements. Do not include
credentials, private conversation logs, or local development paths in packages or issue attachments.

This repository has no repository-wide LICENSE. Dependency licenses and vendor marks do not
establish a license for all repository code.
