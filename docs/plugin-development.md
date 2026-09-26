# Aibo 插件开发文档

本文负责本仓库的开发、构建与安装流程。通用合同以目标 Aibo 仓库为准，
Cursor 专用行为见[当前规格](cursor-acp-spec.md)，历史测试结果见[验证记录](cursor-acp-validation.md)。
不从历史提交或插件版本推导已发布宿主的支持范围。

## 项目与合同入口

| 目录 | 用途 | 开始修改前阅读 |
| --- | --- | --- |
| `plugins/capability/` | application scope 只读能力与 detail 语义视图 | [宿主插件指南](../../aibo/docs/plugin-development_zh.md) |
| `plugins/cursor/` | Cursor ACP 会话提供者 | [插件说明](../plugins/cursor/README.md)、[当前规格](cursor-acp-spec.md)、[验收清单](cursor-acp-checklist.md) |
| `plugins/presentation/` | Ocean 主题、AgentStatusMark 控件 | [呈现包合同](../../aibo/docs/presentation-package.md) |
| `scripts/build.mjs` | 离线 SDK、独立构建副本及三个安装目录 | [宿主 SDK](../../aibo/docs/host-sdk.md) |

本文的跨仓库链接假设 `aibo-plugins` 和 `aibo` 并排检出；使用 `AIBO_ROOT` 时，
在指定宿主的对应路径查阅。宿主私有 helper 和内置引擎只能作为行为参考，不能随插件导入。

协议、SDK 和插件 release 分别核对：

| 维度 | 当前包要求 |
| --- | --- |
| 能力清单 | `aibo.plugin-manifest/v2`；host 范围和 platforms 以各包清单为准 |
| Runtime | 能力示例 2.0；Cursor 显式 2.1，支持流式事件与 control |
| 语义视图 | 能力示例 1.0 / `aibo.semantic-view/v1` |
| 宿主 SDK | 能力示例要求 `hostSdk >=0.1.0 <0.2.0`；Cursor 0.1.18 要求 `>=0.1.1 <0.2.0`，宿主须实现公开 SDK 加载 |
| 呈现 | `aibo.presentation-package/v1`，hostApi/coreSemantics 1.0.0；还需核对实际快照和动作合同 |
| Cursor 会话 | 精确可选功能合同、provider `sessionControls`、`agent-managed` 权限归属及 `image.input` 附件合同 |

Cursor 当前为 0.1.18；0.1.15 起的原生权限声明需要包含 migration 0047 的宿主。
这是源码功能要求，不是一个已发布的宿主版本号；仅满足 hostSdk 范围也不能证明具备这些功能。
验证时记录宿主提交/构建、插件 release、Node 和原生 CLI 精确版本。

## 环境与构建

需要 Node.js 22+、pnpm、npm、tar。默认宿主路径为 `../aibo`，先在宿主运行 `pnpm install`。
本仓库根目录没有第三方依赖，无需先安装。从本仓库根目录执行：

```sh
pnpm run verify
# 使用其他宿主源码位置
AIBO_ROOT=/absolute/path/to/aibo pnpm run verify
```

`verify` 运行测试和构建；仅生成产物可用 `pnpm run build`。
构建器使用目标宿主的 TypeScript 编译器，打包本地 protocol/runtime SDK tarball，
离线安装到独立构建副本作为开发依赖，然后编译能力示例；Cursor 的 `.mjs` 直接打包。
呈现工具同样先本地打包，再生成资源长度与 SHA-256。SDK 尚未公开发布，不从公网安装同名包。

每次构建创建 `dist/build-*`，最后输出三个安装目录的绝对路径：

- `capability/`：`plugin.json` 与 `dist/worker.js`。
- `cursor/`：Cursor 清单及 Worker 模块。
- `presentation/`：生成的 `presentation.json` 及已声明资源。

其他目录和归档为构建副本、SDK 和检查证据。安装产物不携带 `node_modules/@aibo`，
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

该示例不是会话 Agent。新增会话提供者先阅读[会话协商](../../aibo/docs/session-capability-negotiation.md)
与[会话控件](../../aibo/docs/session-controls.md)，贯通清单、Runtime 握手、open 能力、路由和响应封套。
模型/命令目录也须返回合同规定的 recovery 和 capabilities。功能支持、当前可用性和执行授权分别判断。
Cursor 的具体映射集中在当前规格，不应复制成其他提供者的默认行为。

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
| 清单、发现、图标、公共 SDK、安装包 | [插件指南](../../aibo/docs/plugin-development_zh.md)、[宿主 SDK](../../aibo/docs/host-sdk.md) |
| 可选能力、schema、响应封套与降级 | [会话协商](../../aibo/docs/session-capability-negotiation.md) |
| 模式菜单、执行配置及原生权限归属 | [会话控件](../../aibo/docs/session-controls.md) |
| 设置声明、三层继承、有效空值与版本隔离 | [Agent 设置](../../aibo/docs/agent-plugin-settings.md) |
| 模型、推理、Fast、上下文选择及用量 | [模型配置](../../aibo/docs/model-configuration.md) |
| 目标生命周期、暂停/恢复与准入 | [目标](../../aibo/docs/goal-lifecycle.md) |
| 子任务事件、根轮次、过程历史和降级 | [子 Agent 历史](../../aibo/docs/subagent-history.md) |
| 宿主持久队列与原生 steering | [消息队列](../../aibo/docs/message-queue.md) |
| 视觉树、图标、导航、外部控件及动作 | [呈现包合同](../../aibo/docs/presentation-package.md) |

## 安装与验证

1. 执行 `pnpm run verify`，记录测试结果及三个输出目录。
2. 在能力插件管理入口安装并启用 `capability/`，从命令入口打开 **Aibo starter greeting**，
   检查“你好，Aibo！”及刷新。Cursor 安装和依赖见其插件说明。
3. 在呈现包管理入口安装并选择 `presentation/`，检查 Ocean 主题、状态标签及其余控件的默认继承。
4. 检查停用、重启、升级与恢复；呈现故障可用 Ctrl/Command+Shift+Backspace 恢复宿主呈现。

本仓库 verify 覆盖单测、TypeScript 编译、能力归档完整性、呈现清单/资源/控件及默认继承，
并用假 ACP 引擎对打包 Cursor Worker 做握手、流式事件和响应合同 smoke。
它不启动真实桌面或模型；直接启动 Worker 等待 stdin 也不算 smoke 成功。

会话或呈现行为改动按专项合同补充真实原生与 UI 验收，覆盖受影响的默认 ak-ui 明暗主题及外部呈现。
Cursor 使用[验收清单](cursor-acp-checklist.md)记录剩余门槛；旧勾选项不代替本次验证。
修改宿主时在宿主运行 `pnpm run verify`，并遵循[回归矩阵](../../aibo/docs/plugin-boundaries-and-regression.md#regression-gate)。
区分模拟 ACP、打包 Worker、真实 CLI、隔离宿主合同探针及实际桌面交互，保留未验证项。

运行代码或构建产物变更时同步 release 版本；纯文档整理无需升版。
相同 ID/版本但内容不同的产物不能覆盖已安装 release。新会话验证新版本，
旧会话继续固定原 installation/contribution；不要静默换绑。

## 通用宿主工具

SDK 0.1.1 提供 `@aibo/capability-runtime/host-tools`。新增 Agent 插件声明版本化目录与标准
response 操作后，只需适配原生工具注册或 MCP 配置；完整查询由宿主处理，无需新增品牌分支。
见[宿主工具接入合同](../../aibo/docs/session-history-tool-design.md)和 Cursor 0.1.18 示例。
