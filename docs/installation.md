# Install Aibo plugins / 安装 Aibo 插件

[Back to the catalog / 返回插件目录](../README.md)

Install a **built package** into a compatible Aibo desktop build. The source checkout is only
needed if you build the package yourself. 安装需要构建产物；仅自行构建时才需要源码环境。

## Compatibility

This table describes the manifests in this checkout. A source version is not evidence of a
published release. 宿主版本、宿主 SDK 和原生 CLI 要分别满足要求。

| Package | Plugin version | Host SDK | Declared platforms / other requirements |
| --- | --- | --- | --- |
| [Cursor](../plugins/cursor/README.md) | 0.2.4 | `>=0.1.8 <0.2.0` | macOS arm64; Cursor CLI and native login |
| [Claude Code](../plugins/claude-code/README.md) | 0.4.7 | `>=0.1.10 <0.2.0` | macOS arm64; Claude Code >=2.1.280; matching authentication, background-task and quota host features |
| [ACP template](../plugins/acp-template/README.md) | 0.1.1 | `>=0.1.8 <0.2.0` | macOS arm64 as shipped; configure the target agent and verify its platform |
| [Capability example](../plugins/capability/README.md) | 1.0.2 | `>=0.1.8 <0.2.0` | macOS arm64 / x64 declared |
| [Presentation example](../plugins/presentation/README.md) | 1.0.0 | Uses presentation host API `1.0.0` | Core semantics `1.0.0`; inherits host controls it does not implement |

Capability manifests also require host `>=0.1.0 <0.2.0`. Passing the version checks does not prove
all required features or native dependencies are available. Platform declarations are distinct
from desktop acceptance evidence. See the
[host platform matrix](https://github.com/chldu2000/aibo/blob/main/docs/plugin-platform-support-matrix.md).

Host SDK 0.1.11 and every earlier release required here are published on npm, so a default
build needs no unpublished SDK. The host's
[release registry](https://github.com/chldu2000/aibo/blob/main/packages/plugin-host/sdk-releases.json)
lists the published versions. Do not infer that an older installed Aibo contains newer source features.

## Install a prepared package

1. Read the plugin's requirements. Install and authenticate its native CLI when required.
2. Extract the package if needed. Find the **built directory** containing `plugin.json`
   (capability/agent) or `presentation.json` (presentation).
3. In Aibo, install agent/capability packages through **插件与能力** and enable them.
   Install presentation packages through **安装皮肤插件**, then select the installed presentation.
4. For an agent plugin, create a new session and send a short request. For a presentation,
   check the selected theme and the inherited controls.

用户安装时不运行 `npm install`，也不需要相邻的 Aibo 源码。Agent 依赖仍需单独准备。
The host provides a compatible Node runtime and its SDK; the package carries its other required
JavaScript dependencies. Missing Node can be resolved under **运行与诊断**.

Existing sessions retain their original release binding until a supported host migration succeeds.
A new installation alone does not silently update every old conversation. Read the plugin's recovery limits.

## Build from source

Requires Node.js 22+, pnpm, npm and tar, and a side-by-side Aibo checkout (`../aibo`).
需要 Node.js 22+、pnpm、npm、tar，以及并排放置的 Aibo 源码：

```sh
cd aibo && pnpm install
cd ../aibo-plugins && pnpm install && pnpm prepare:deps
pnpm build
```

The build prints absolute paths to the installable directories under a new `dist/build-*`.
Install that directory, not `plugins/claude-code/` or another source directory. Full command table,
`--only` selection, the terminal plugin (needs Rust) and `AIBO_SDK=local` for unpublished SDK changes:
[Build an Aibo plugin](plugin-development.md#build-commands) ·
[构建 Aibo 插件](plugin-development_zh.md#构建命令).

| Directory | Contents and use |
| --- | --- |
| `cursor/` | Cursor agent package |
| `claude-code/` | Claude Code agent package, launcher and packaged JavaScript dependencies |
| `acp-template/` | Template package; customize its agent configuration before real use |
| `capability/` | Greeting operation and detail view example |
| `presentation/` | Generated presentation manifest, theme and Worker |
| `terminal/` | Interactive terminal tool view; built only when Rust is installed |

`pnpm verify` checks automated tests and packaged-worker behavior; it does not establish real model
access or desktop acceptance. See [development verification](plugin-development.md#install-and-verify).

## Troubleshooting / 常见问题

| Symptom | Check |
| --- | --- |
| Plugin cannot activate | Host and SDK ranges, declared OS/architecture, required CLI and Node diagnostics |
| Agent opens but cannot answer | Native login, account/model access, quota, and the provider's actual error |
| Claude plugin fails on an older Aibo build | Install a host build with SDK >=0.1.10 and the required host features |
| Installation cannot find an entrypoint or resource | Use the complete built directory; do not install source files individually |
| Old conversation behaves like the previous version | Check its pinned release; create a new session to try the new installation |
| SDK package version cannot be downloaded during build | Check that the version is published on registry.npmjs.org (a mirror can lag); use `AIBO_SDK=local` only for SDK changes that are not published yet |
| `pnpm build` skips or fails on the terminal plugin | It needs Rust (`cargo`); install it, or build the others with `--only=` |

Report unresolved issues with exact host/plugin/CLI versions and redacted diagnostics.
