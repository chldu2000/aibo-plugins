# 构建 Aibo 插件

[English](plugin-development.md) | [简体中文](plugin-development_zh.md)

本文面向要开发或修改插件的人。只安装和使用插件，请阅读[安装指南](installation.md)。
版本要求只在一处维护，即[兼容表](installation.md#compatibility)，本文不重复。

## 60 秒跑通

需要 Node.js 22+、pnpm、npm 和 tar，不需要检出 Aibo 源码。

```sh
cd aibo-plugins && pnpm install
pnpm prepare:deps                       # 只需一次：Claude Code 运行依赖
pnpm build
```

`pnpm build` 结束时会打印可安装目录：

```text
Install these directories in Aibo (not the source folders under plugins/):
  capability    …/aibo-plugins/dist/build-AbC123/capability
  cursor        …/dist/build-AbC123/cursor
  acp-template  …/dist/build-AbC123/acp-template
  claude-code   …/dist/build-AbC123/claude-code
  presentation  …/dist/build-AbC123/presentation
```

在 Aibo 的 **插件与能力** 中安装其中一个（例如 `capability/`）并启用；呈现包通过 **安装皮肤插件** 安装。
安装的永远是打印出来的目录，不是 `plugins/` 下的源码目录。同 ID、同版本的重建产物不会覆盖已安装的 release，
见[发布与版本](#发布与版本)。

`pnpm build` 和 `pnpm test` 都不读取宿主源码：SDK 来自 npm，测试所对照的宿主合同随 `@aibolabs/plugin-protocol` 发布。
只有[对照未发布的宿主改动验证](#构建命令)和[维护者探针](#宿主探针)才需要宿主检出。

## 你想做什么

| 我想… | 复制 | 修改 | 验证 |
| --- | --- | --- | --- |
| 接入兼容 ACP 的 Agent | [`acp-template`](../plugins/acp-template/README.md) | `plugin.json`、`acp.json` | `test/acp-plugins.test.mjs`；打开一个会话 |
| 增加只读操作和详情视图 | [`capability`](../plugins/capability/README.md) | `plugin.json`、`worker.ts` | 在全局搜索里运行该命令 |
| 修改主题或宿主控件 | [`presentation`](../plugins/presentation/README.md) | `presentation.source.json`、`worker.js` | 在呈现管理里选用 |
| 增加有自己界面和后端的交互面板 | [`terminal`](../plugins/terminal/README.md) | `frontend.js`、`style.css`、`backend/` | `pnpm test:terminal`（需要 Rust） |
| 接入带厂商扩展方法的 Agent | [`cursor`](../plugins/cursor/README.md) | `worker.mjs`、扩展 | [Cursor 规格](cursor-acp-spec.md) |

下面按类型展开。跨仓库链接指向 GitHub 上的宿主文档；对照宿主检出验证时，在该检出中核对合同。
宿主私有 helper 和内置引擎只能作为行为参考，不能随插件导入。

## 构建命令

| 目的 | 命令 |
| --- | --- |
| 构建全部（默认） | `pnpm build` |
| 只构建部分插件 | `pnpm build --only=cursor,capability`（名称：`capability`、`cursor`、`acp-template`、`claude-code`、`presentation`、`terminal`） |
| 构建终端插件 | 安装 Rust 后执行 `pnpm prepare:terminal && pnpm build --only=terminal` |
| 运行测试 | `pnpm test` |
| 测试加完整构建 | `pnpm verify` |
| 对照宿主检出验证（未发布的 SDK 或合同） | `AIBO_SDK=local pnpm verify`（使用 `../aibo`）或 `AIBO_ROOT=/absolute/path/to/aibo pnpm verify` |

不带 `--only` 时，只有找到 `cargo` 才会构建 `terminal`，否则提示后跳过。
没有 Rust 时 `pnpm test` 会跳过终端后端测试，`pnpm test:terminal` 才运行它们。

**默认（npm SDK）。** 每个插件在独立副本中按 `package-lock.json` 执行 `npm ci`，`@aibolabs/*` 开发依赖来自
`https://registry.npmjs.org/`（`.npmrc` 和构建参数固定了这一点，即使配置了镜像）。构建用本项目的 TypeScript
编译能力示例，直接打包 Cursor 的 `.mjs`，并用 `@aibolabs/presentation-tools` 生成呈现资源（长度和 SHA-256 由工具生成，
不手写）。两个打包 Worker 的 smoke 检查从该独立副本加载 SDK，`pnpm test` 从本仓库的 `node_modules` 加载，
方式与 Aibo 运行时注入一致；manifest 和操作 schema 对照 `@aibolabs/plugin-protocol` 里的合同校验。
日常开发，以及 SDK 版本都已发布的修订，都用这条路径。

**`AIBO_SDK=local` / `AIBO_ROOT`。** 从宿主源码（`../aibo` 或 `AIBO_ROOT`）打包 SDK 与呈现工具，离线安装。
测试和 smoke 检查改用宿主自己的 resolver 加载 SDK，并从该检出读取合同，这也是检查与特定宿主修订兼容性的方式。
只用于验证尚未发布的 SDK 或合同改动；
发布插件前，所依赖的 SDK 必须先发布，兼容表也要同步更新。

安装产物不携带 `node_modules/@aibolabs`，运行时由宿主提供公开 SDK；使用 bundler 时把 SDK 入口设为 external。
第三方运行库须自行 bundle 或放进产物：Aibo 安装时不执行 `npm install`，仅写 `dependencies` 或执行 `npm pack`
不会补齐文件。检查解包后的依赖、路径和符号链接。

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
`worker.mjs` 调用宿主 SDK 的 `serveAcpAgent`，能力按 Agent 的 `initialize` 响应收窄。字段说明见模板 README，
通用层行为见宿主的 [`@aibolabs/acp-adapter`](https://github.com/chldu2000/aibo/blob/main/packages/acp-adapter/README.md)。
[Claude Code 插件](../plugins/claude-code/) 是按此方式接入的真实例子。需要厂商扩展方法时参照 Cursor 插件传入 `extension`。
`test/acp-plugins.test.mjs` 检查模板清单与宿主合同一致；复制模板后保留这类测试。

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

## 交互式终端与 toolView

[`plugins/terminal/`](../plugins/terminal/README.md) 使用宿主独立的 `toolView` 合同，在插件内部提供前端和原生后端，
与语义/呈现插件的合同相互独立。完整构建会增加 `terminal/` 目录，首次构建前执行 `pnpm prepare:terminal`。
编译需要 Rust，但安装产物的用户不需要编译工具或 Node。视觉规则（宿主令牌、一行工具栏、不放常驻恢复入口）见宿主
[toolView 合同](https://github.com/chldu2000/aibo/blob/main/docs/tool-view-contract.md)和[终端设计](terminal-plugin-design.md)。

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
| 终端类工具视图 | [toolView 合同](https://github.com/chldu2000/aibo/blob/main/docs/tool-view-contract.md) |

## 安装与验证

1. 执行 `pnpm verify`，记录测试结果及打印出的输出目录。
2. 在能力插件管理入口安装并启用 `capability/`，从命令入口打开 **Aibo starter greeting**，
   检查“你好，Aibo！”及刷新。Cursor 安装和依赖见其插件说明。
3. 在呈现包管理入口安装并选择 `presentation/`，检查 Ocean 主题、状态标签及其余控件的默认继承。
4. 检查停用、重启、升级与恢复；呈现故障可用 Ctrl/Command+Shift+Backspace 恢复宿主呈现。

`verify` 覆盖单测、TypeScript 编译、能力归档完整性、呈现清单/资源/控件及默认继承，
并用假 ACP 引擎对打包后的 Cursor Worker 做握手、流式事件和响应合同 smoke，同时对打包后的 Claude Code Worker 做 smoke。
它不启动真实桌面或模型；直接启动 Worker 等待 stdin 也不算 smoke 成功。

会话或呈现行为改动按专项合同补充真实原生与 UI 验收，覆盖受影响的内置 Material 3、ak-ui 明暗主题及外部呈现。
Cursor 使用[验收清单](cursor-acp-checklist.md)记录剩余门槛；旧勾选项不代替本次验证。
修改宿主时在宿主运行 `pnpm run verify`，并遵循[回归矩阵](https://github.com/chldu2000/aibo/blob/main/docs/plugin-boundaries-and-regression.md#regression-gate)。
区分模拟 ACP、打包 Worker、真实 CLI、隔离宿主合同探针及实际桌面交互，保留未验证项。

## 发布与版本

运行代码或构建产物变更时同步 release 版本（清单、`package.json` 及 Worker 上报的版本）；纯文档整理无需升版。
相同 ID/版本但内容不同的产物不能覆盖已安装 release。新会话验证新版本，旧会话继续固定原 installation/contribution，
不会静默换绑。记录验证时写明宿主提交/构建、插件 release、Node 和原生 CLI 的精确版本。

协议、SDK 和插件 release 分别核对：

| 维度 | 核对位置 |
| --- | --- |
| 清单 schema | `aibo.plugin-manifest/v2`；host 范围和 platforms 以各包清单为准 |
| 宿主 SDK 范围 | [兼容表](installation.md#compatibility)和各包 `hostSdk` 字段 |
| Runtime | 能力示例 2.0；Cursor 显式 2.1，支持流式事件与 control |
| 语义视图 | 能力示例 1.0 / `aibo.semantic-view/v1` |
| 呈现 | `aibo.presentation-package/v1`，hostApi/coreSemantics 1.0.0；还需核对实际快照和动作合同 |
| Cursor 会话 | 精确可选功能合同、provider `sessionControls`、`agent-managed` 权限归属及 `image.input` 附件合同 |

源码版本不等于已发布的宿主版本。仅满足 `hostSdk` 范围也不能证明具备插件所需的宿主功能
（例如 Cursor 0.1.15 起的原生权限声明需要包含 migration 0047 的宿主）。

## 维护者参考

### 通用宿主工具

SDK 0.1.1 提供 `@aibolabs/capability-runtime/host-tools`。新增 Agent 插件声明版本化目录与标准
response 操作后，只需适配原生工具注册或 MCP 配置；完整查询由宿主处理，无需新增品牌分支。
见[宿主工具接入合同](https://github.com/chldu2000/aibo/blob/main/docs/session-history-tool-design.md)和 Cursor 0.1.18 示例。

### 自包含 Claude Code 运行依赖

Claude Code 使用包内 `launch-acp.mjs` 启动器，按宿主 PATH 查找用户安装的 `claude`，
通过 `CLAUDE_CODE_EXECUTABLE` 交给 ACP。清单声明必需的 Claude Code >=2.1.280。
ACP 和 SDK 的 JavaScript 依赖仍由插件携带，用户无需另装 Node、npm 或全局 ACP。

准备及构建使用 `npm ci --omit=dev --omit=optional`，排除 SDK 原生可选包；lockfile 保留其元数据。
去掉类型文件和 source map，保留 JS、资源和许可证。产物不得包含原生 Claude 可执行文件，
且解包大小不得超过 32 MiB；宿主原有 4096 文件/256 MiB 限制仍适用。
宿主安装不运行 npm；Worker 和 ACP 共用宿主私有 Node。当前只发布 darwin-arm64，其他平台尚未验收。
升级依赖时更新 runtime package.json 和 lockfile，并验证与用户 CLI 版本的兼容性。
0.4.0/0.4.1 的完整原生程序打包记录属于历史版本；旧会话继续绑定旧 release。

### 宿主探针

`probe-*` 脚本（例如 `pnpm probe:cursor:desktop`）是手动排查工具，不属于 `pnpm verify`。
它们使用宿主的 Vite、Playwright、Node 运行时和插件 resolver，因此需要已安装依赖的宿主检出（`../aibo` 或 `AIBO_ROOT`）。

### 顺序选择模型与参数

Claude Code 0.4.1 与 Cursor 0.2.3 要求 hostSdk >=0.1.7，并使用 model.select 新输出变体声明 `parameterScope: current-model`。
配置式插件写在 acp.json，代码插件写在 AcpExtension；完整合同及旧版本缺省行为见
[模型配置](https://github.com/chldu2000/aibo/blob/main/docs/model-configuration.md)。升级后新建会话使用新 release，既有会话不重绑。
