# Aibo 插件开发文档

本文面向扩展开发者。只安装和使用插件，请先阅读[安装指南](installation.md)。
本文负责本仓库的开发、构建与验证流程。通用合同以目标 Aibo 仓库为准，
Cursor 专用行为见[当前规格](cursor-acp-spec.md)，历史测试结果见[验证记录](cursor-acp-validation.md)。
不从历史提交或插件版本推导已发布宿主的支持范围。

## 项目与合同入口

| 目录 | 用途 | 开始修改前阅读 |
| --- | --- | --- |
| `plugins/claude-code/` | Claude Code ACP 集成与运行依赖 | [插件说明](../plugins/claude-code/README.md) |
| `plugins/acp-template/` | 配置式 ACP 接入模板 | [模板说明](../plugins/acp-template/README.md) |
| `plugins/capability/` | application scope 只读能力与 detail 语义视图 | [宿主插件指南](https://github.com/chldu2000/aibo/blob/main/docs/plugin-development_zh.md) |
| `plugins/cursor/` | Cursor ACP 会话提供者 | [插件说明](../plugins/cursor/README.md)、[当前规格](cursor-acp-spec.md)、[验收清单](cursor-acp-checklist.md) |
| `plugins/presentation/` | Ocean 主题、AgentStatusMark 控件 | [呈现包合同](https://github.com/chldu2000/aibo/blob/main/docs/presentation-package.md) |
| `scripts/build.mjs` | npm SDK（或 `AIBO_SDK=local` 源码 SDK）、独立构建副本及安装目录 | [宿主 SDK](https://github.com/chldu2000/aibo/blob/main/docs/host-sdk.md) |

本文的跨仓库链接指向 GitHub 上的宿主文档；构建默认要求两个仓库并排检出。
使用 `AIBO_ROOT` 时，在指定宿主的对应路径核对实际合同。宿主私有 helper 和内置引擎只能作为行为参考，不能随插件导入。

协议、SDK 和插件 release 分别核对：

| 维度 | 当前包要求 |
| --- | --- |
| 能力清单 | `aibo.plugin-manifest/v2`；host 范围和 platforms 以各包清单为准 |
| Runtime | 能力示例 2.0；Cursor 显式 2.1，支持流式事件与 control |
| 语义视图 | 能力示例 1.0 / `aibo.semantic-view/v1` |
| 宿主 SDK | 能力包使用 `@aibolabs/*`；各包范围见[兼容表](installation.md#compatibility)，Claude Code 当前要求 0.1.10，其余能力包最低 0.1.8 |
| 呈现 | `aibo.presentation-package/v1`，hostApi/coreSemantics 1.0.0；还需核对实际快照和动作合同 |
| Cursor 会话 | 精确可选功能合同、provider `sessionControls`、`agent-managed` 权限归属及 `image.input` 附件合同 |

Cursor 当前包版本见[兼容表](installation.md#compatibility)；0.1.15 起的原生权限声明需要包含 migration 0047 的宿主。
这是源码功能要求，不是一个已发布的宿主版本号；仅满足 hostSdk 范围也不能证明具备这些功能。
验证时记录宿主提交/构建、插件 release、Node 和原生 CLI 精确版本。

## 环境与构建

需要 Node.js 22+、pnpm、npm、tar。测试与 smoke 通过宿主 SDK resolver 模拟运行时，默认宿主路径为 `../aibo`，
先在宿主运行 `pnpm install`。Claude 插件的构建依赖先执行 `pnpm prepare:deps` 下载并按 lockfile 缓存。从本仓库根目录执行：

```sh
pnpm install
pnpm prepare:deps
AIBO_SDK=local pnpm run verify
# 使用其他宿主源码位置
AIBO_ROOT=/absolute/path/to/aibo AIBO_SDK=local pnpm run verify
```

`verify` 运行测试和构建；仅生成当前源码产物可用 `AIBO_SDK=local pnpm run build`。
当前 Claude Code 需要源码 SDK 0.1.10，已登记的发布基线仍为 0.1.8，所以这里使用本地 SDK。
只有所需 SDK 均已发布时，才使用不带 `AIBO_SDK=local` 的 npm SDK 构建路径。
构建器在独立构建副本中按各插件的 `package-lock.json` 执行 `npm ci`，从 npm 安装 `@aibolabs/*` 开发依赖
（项目 `.npmrc` 与构建参数固定该 scope 使用 `https://registry.npmjs.org/`），用本项目的 TypeScript 编译能力示例；
Cursor 的 `.mjs` 直接打包。呈现工具使用本项目依赖中的 `@aibolabs/presentation-tools`，生成资源长度与 SHA-256。
`AIBO_SDK=local` 时改为从宿主源码打包 SDK 与呈现工具 tarball，离线安装，用于验证未发布的 SDK 改动。

每次构建创建 `dist/build-*`，最后输出五个安装目录的绝对路径：

- `capability/`：`plugin.json` 与 `dist/worker.js`。
- `cursor/`：Cursor 清单及 Worker 模块。
- `claude-code/`：Claude Code 清单、启动器和 JavaScript 运行依赖。
- `acp-template/`：ACP 模板，实际使用前须配置真实 Agent。
- `presentation/`：生成的 `presentation.json` 及已声明资源。

其他目录和归档为构建副本、SDK 和检查证据。安装产物不携带 `node_modules/@aibolabs`，
运行时由宿主提供公开 SDK；本地 Worker smoke 使用宿主 preload。使用 bundler 时将 SDK 入口设为 external。
第三方运行库须自行 bundle 或显式包含在安装产物中；仅写 dependencies 或执行 `npm pack`
不会自动补齐文件，Aibo 安装时不执行 `npm install`。检查解包后的依赖、路径和符号链接。

## 修改能力示例

起点是 [plugin.json](../plugins/capability/plugin.json) 和 [worker.ts](../plugins/capability/worker.ts)。

1. 将 `dev.aibo.starter.greeting` 替换为自己的命名空间，同步插件、贡献、能力及 operation ID。
   Worker 握手的 `{capability, version, operationId}` 必须与清单一致。
2. 同步 npm 包、清单及 Worker 上报的 release 版本；准确声明 scope、effect、permissions、
   timeoutMs、idempotent 和输入输出 schema，不凭构建成功扩大平台范围。
3. 实现允许列表内的操作。示例接收 `{ actionId: "refresh", itemId: null, offset: 0 }`，
   返回 `state`、`view`、`actions`；快照身份及 revision 由宿主补齐。
4. stdout 只承载协议，日志写 stderr。响应 `tools.signal`，声明依赖通过 `tools.call` 调用。
   写操作需要相应 effect/permissions；取消或结果未知后不能盲目重试。

该示例不是会话 Agent。新增会话提供者先阅读[会话协商](https://github.com/chldu2000/aibo/blob/main/docs/session-capability-negotiation.md)
与[会话控件](https://github.com/chldu2000/aibo/blob/main/docs/session-controls.md)，贯通清单、Runtime 握手、open 能力、路由和响应封套。
模型/命令目录也须返回合同规定的 recovery 和 capabilities。功能支持、当前可用性和执行授权分别判断。
Cursor 的具体映射集中在当前规格，不应复制成其他提供者的默认行为。

## 接入 ACP Agent

兼容通用适配器的 Agent 从 [ACP 模板](../plugins/acp-template/) 起步，基础接入通过配置完成：
在 `plugin.json` 中替换插件 ID、平台与可执行依赖，在 `acp.json` 中填写启动命令、参数和 `ask`/`plan`/`edit` 到原生模式的映射。
`worker.mjs` 调用宿主 SDK 的 `serveAcpAgent`（模板当前要求见兼容表），能力按 Agent 的 `initialize` 响应收窄。字段说明见模板 README，
通用层行为见宿主的 [`@aibolabs/acp-adapter`](https://github.com/chldu2000/aibo/blob/main/packages/acp-adapter/README.md)。[Claude Code 插件](../plugins/claude-code/) 是按此方式接入的真实例子。需要厂商扩展方法时参照 Cursor 插件传入 `extension`。
`test/acp-template.test.mjs` 检查模板清单与宿主合同一致；复制模板后保留这类测试。

## 修改呈现示例

源清单为 [presentation.source.json](../plugins/presentation/presentation.source.json)，
构建生成正式清单，不手写摘要。当前 [worker.js](../plugins/presentation/worker.js)
仅为 AgentStatusMark 返回含宿主 label 的状态节点；其他 controls 返回 null，继承宿主实现。
该骨架不声明 semantic/workbench，也不自动绘制可选 Agent 图标。

- 主题使用成对的 `themes` / `defaultThemeId`；Worker 使用成对的 `entry` / `surfaces`。
- 入口须自包含；打包工具不自动捆绑 import，也不转换 Svelte/DOM 组件。
- 按包合同返回有稳定 key 的受限视觉树，只绑定宿主当前提供的不透明动作 token。
- null 继承适用于 controls；新增 semantic 或 workbench 时按合同保留所需业务语义。
- 业务持久状态、审批、设置管理和恢复仍由宿主维护；内部 `UiKitAdapter` 控件不自动成为外部 controls。

新增图标、会话创建菜单、模型控件或整窗呈现前，查阅下表中的呈现合同及对应专项合同，
核对 SDK 类型与目标宿主快照，避免在此维护第二份字段表。

## 按任务查阅宿主合同

| 改动 | 权威说明 |
| --- | --- |
| 清单、发现、图标、公共 SDK、安装包 | [插件指南](https://github.com/chldu2000/aibo/blob/main/docs/plugin-development_zh.md)、[宿主 SDK](https://github.com/chldu2000/aibo/blob/main/docs/host-sdk.md) |
| 可选能力、schema、响应封套与降级 | [会话协商](https://github.com/chldu2000/aibo/blob/main/docs/session-capability-negotiation.md) |
| 模式菜单、执行配置及原生权限归属 | [会话控件](https://github.com/chldu2000/aibo/blob/main/docs/session-controls.md) |
| 设置声明、三层继承、有效空值与版本隔离 | [Agent 设置](https://github.com/chldu2000/aibo/blob/main/docs/agent-plugin-settings.md) |
| 模型、推理、Fast、上下文选择及用量 | [模型配置](https://github.com/chldu2000/aibo/blob/main/docs/model-configuration.md) |
| 目标生命周期、暂停/恢复与准入 | [目标](https://github.com/chldu2000/aibo/blob/main/docs/goal-lifecycle.md) |
| 子任务事件、根轮次、过程历史和降级 | [子 Agent 历史](https://github.com/chldu2000/aibo/blob/main/docs/subagent-history.md) |
| 宿主持久队列与原生 steering | [消息队列](https://github.com/chldu2000/aibo/blob/main/docs/message-queue.md) |
| 视觉树、图标、导航、外部控件及动作 | [呈现包合同](https://github.com/chldu2000/aibo/blob/main/docs/presentation-package.md) |

## 安装与验证

1. 执行 `AIBO_SDK=local pnpm run verify`，记录测试结果及五个输出目录。
2. 在能力插件管理入口安装并启用 `capability/`，从命令入口打开 **Aibo starter greeting**，
   检查“你好，Aibo！”及刷新。Cursor 安装和依赖见其插件说明。
3. 在呈现包管理入口安装并选择 `presentation/`，检查 Ocean 主题、状态标签及其余控件的默认继承。
4. 检查停用、重启、升级与恢复；呈现故障可用 Ctrl/Command+Shift+Backspace 恢复宿主呈现。

本仓库 verify 覆盖单测、TypeScript 编译、能力归档完整性、呈现清单/资源/控件及默认继承，
并用假 ACP 引擎对打包 Cursor Worker 做握手、流式事件和响应合同 smoke。
它不启动真实桌面或模型；直接启动 Worker 等待 stdin 也不算 smoke 成功。

会话或呈现行为改动按专项合同补充真实原生与 UI 验收，覆盖受影响的内置 Material 3、ak-ui 明暗主题及外部呈现。
Cursor 使用[验收清单](cursor-acp-checklist.md)记录剩余门槛；旧勾选项不代替本次验证。
修改宿主时在宿主运行 `pnpm run verify`，并遵循[回归矩阵](https://github.com/chldu2000/aibo/blob/main/docs/plugin-boundaries-and-regression.md#regression-gate)。
区分模拟 ACP、打包 Worker、真实 CLI、隔离宿主合同探针及实际桌面交互，保留未验证项。

运行代码或构建产物变更时同步 release 版本；纯文档整理无需升版。
相同 ID/版本但内容不同的产物不能覆盖已安装 release。新会话验证新版本，
旧会话继续固定原 installation/contribution；不要静默换绑。

## 通用宿主工具

SDK 0.1.1 提供 `@aibolabs/capability-runtime/host-tools`。新增 Agent 插件声明版本化目录与标准
response 操作后，只需适配原生工具注册或 MCP 配置；完整查询由宿主处理，无需新增品牌分支。
见[宿主工具接入合同](https://github.com/chldu2000/aibo/blob/main/docs/session-history-tool-design.md)和 Cursor 0.1.18 示例。

## 自包含运行依赖

Claude Code 当前要求见[兼容表](installation.md#compatibility)，使用包内 `launch-acp.mjs` 启动器，按宿主 PATH 查找用户安装的
`claude`，通过 `CLAUDE_CODE_EXECUTABLE` 交给 ACP。清单声明必需的 Claude Code >=2.1.280。
ACP 和 SDK 的 JavaScript 依赖仍由插件携带，用户无需另装 Node、npm 或全局 ACP。

准备及构建使用 `npm ci --omit=dev --omit=optional`，排除 SDK 原生可选包；lockfile 保留其元数据。
去掉类型文件和 source map，保留 JS、资源和许可证。产物不得包含原生 Claude 可执行文件，
且解包大小不得超过 32 MiB；宿主原有 4096 文件/256 MiB 限制仍适用。
宿主安装不运行 npm；Worker 和 ACP 共用宿主私有 Node。当前只发布 darwin-arm64，其他平台尚未验收。
升级依赖时更新 runtime package.json 和 lockfile，并验证与用户 CLI 版本的兼容性。
0.4.0/0.4.1 的完整原生程序打包记录属于历史版本；旧会话继续绑定旧 release。

## 顺序选择模型与参数

Claude Code 0.4.1 与 Cursor 0.2.3 要求 hostSdk >=0.1.7，并使用 model.select 新输出变体声明 `parameterScope: current-model`。配置式插件写在 acp.json，代码插件写在 AcpExtension；完整合同及旧版本缺省行为见[模型配置](https://github.com/chldu2000/aibo/blob/main/docs/model-configuration.md)。升级后新建会话使用新 release，既有会话不重绑。

## 交互式终端与 toolView

`plugins/terminal/` 使用宿主 0.1.1 的独立 `toolView` 合同，在插件内部提供前端和原生后端。
它是与既有语义/呈现插件分离的合同；参考 [插件说明](../plugins/terminal/README.md) 和
[宿主合同](../../aibo/docs/tool-view-contract.md)。完整构建增加 `terminal/` 安装目录，首次验证前
执行 `pnpm prepare:terminal`。终端编译需要 Rust，但安装产物的用户不需要编译工具或 Node。
