# Claude Code integration changes

[Current setup and capabilities](README.md)

These notes describe version milestones. Current installation requirements and limitations
are maintained in the README and manifest.

## 0.4.7

Requires host SDK 0.1.10 and maps native subscription quota observations into the host's quota display.

## 0.4.6

Added native CLI login and authentication status actions in the plugin manager. Requires the
matching host authentication contract; the terminal login entry currently supports macOS.

## 0.4.5

Added native background-task events through the host SDK 0.1.9 background-task contract.

## Earlier integration changes

Release 0.4.1 declares `parameterScope: current-model`. Aibo selects the model first, refreshes its native parameters, and then offers reasoning strength. Only labels are displayed; parameter IDs remain opaque. Requires host SDK 0.1.7.

Release 0.4.2 changes the runtime requirement: install Claude Code yourself. Install this as a new release; existing sessions remain bound to their original plugin and do not automatically switch engines.
