# Aibo 插件开发文档

## 1. 项目结构与边界

```text
aibo-plugins/
├── docs/plugin-development.md
├── plugins/
│   ├── capability/              # plugin.json、worker.ts、tsconfig.json
│   └── presentation/            # presentation.source.json、worker.js、style.css
├── scripts/build.mjs           # 本地 SDK 打包、编译与安装目录生成
├── test/presentation.test.mjs
└── package.json
```

能力插件扩展操作、服务与领域数据；呈现插件扩展主题和视觉表达。两者独立安装。
能力插件通过语义视图描述内容和动作，不携带 HTML/CSS；呈现 Worker 返回受限视觉树，不能直接调用能力、DOM、网络、存储或 Tauri IPC。

当前骨架依据相邻 Aibo 仓库的合同实现。协议版本、SDK 版本和插件版本是三种不同版本，不能互相推导。

| 项目 | 骨架采用的合同 |
| --- | --- |
| 能力清单 | `aibo.plugin-manifest/v2` |
| 能力运行协议 | Runtime 2.0 |
| 语义视图 | 1.0 / `aibo.semantic-view/v1` |
| 呈现包 | `aibo.presentation-package/v1` |
| 呈现 hostApi / coreSemantics | 1.0.0 |

## 2. 环境与构建

需要 Node.js 22+、pnpm、npm、tar。默认宿主源码路径是 `../aibo`，并已执行 `pnpm install`。SDK 尚未发布公共注册表，构建使用该仓库的 TypeScript 编译器和本地 SDK tarball，不从公网安装同名 SDK。

```sh
# 在 aibo-plugins 目录执行
pnpm run verify
# 或使用其他宿主源码位置
AIBO_ROOT=/absolute/path/to/aibo pnpm run build
```

构建脚本编译 plugin-protocol，将 capability-runtime 与 protocol 打为 tarball，离线安装到能力插件的构建副本，再编译 worker。发布归档捆绑运行依赖，清单不会包含开发机 tarball 路径。呈现工具同样先打包、解包，再生成资源长度和 SHA-256。

输出位于每次新建的 `dist/build-*`：

- `unpacked/`：能力安装目录，包含 `plugin.json`、`dist/worker.js` 和运行依赖。
- `presentation/`：呈现安装目录，包含 `presentation.json` 和清单声明的资源。
- 其他目录及归档：SDK、构建副本和构建证据，供调试检查。

重复构建不会覆盖旧目录，但相同 ID/版本且内容不同的产物不能覆盖已安装 release。正式升级时递增插件版本。确认不再需要后可手动删除本项目 `dist/`。

## 3. 开发能力插件

起点是 `plugins/capability/plugin.json` 和 `worker.ts`。骨架提供 application 作用域的只读操作，以及一个可从 command 入口打开的 detail 语义视图。

1. 将 `dev.aibo.starter.greeting` 替换成自己的命名空间；同步清单、贡献 ID、操作 ID 和 worker。
2. 同步修改 npm 包版本、清单 `version` 和 worker `pluginVersion`。
3. 声明准确的 scope、effect、permissions、timeoutMs、idempotent 以及输入输出 JSON schema。当前只声明 macOS arm64/x64 和宿主 `>=0.1.0 <0.2.0`，不要未经验证扩展兼容范围。
4. 修改 `invoke` 实现，仅处理允许列表中的操作并返回满足 schema 的数据。
5. 语义查询输入为 `{ actionId: "refresh", itemId: null, offset: 0 }`；输出提供 `state`、`view`、`actions`，上下文身份和 revision 由宿主补齐。

stdout 只能承载协议消息，日志写 stderr。长任务应响应 `tools.signal` 取消信号。跨提供者调用使用 `tools.call`，绑定、身份和权限交给 Broker。写操作必须声明 write effect 与所需权限；取消、拒绝或结果未知后不能盲目重试写入。

会话 Agent 应使用 Runtime 2.1 及宿主的会话能力/事件/恢复合同，本骨架不是会话 Agent 实现。参考 Aibo 的 `src-tauri/capability-plugins/`，不要将其中宿主内部 helper 当作公开 SDK。

## 4. 开发呈现插件

`plugins/presentation/presentation.source.json` 是源清单，构建生成正式 `presentation.json`。不要手写摘要。

骨架同时提供 Ocean 主题和 `controls` surface。`worker.js` 定义 `self.aiboPresentation.render(input)`：对 AgentStatusMark 返回包含宿主 label 的状态节点，对 ModelMatrix 等控件返回 null，继承宿主实现。样式在 `style.css` 内，两个资源都显式列入清单。

- 修改 `themes` / `defaultThemeId` 定制语义 token；两者必须成对。
- `entry` 和 `surfaces` 必须成对。入口必须是自包含 Worker 脚本；打包工具不会自动捆绑 import，也不会转换 Svelte/DOM 组件。
- 节点使用稳定、唯一 key，标签和属性遵守 `PresentationNode`。不能使用任意 HTML、style 字符串或远程资源。
- 业务事件只能绑定宿主提供的不透明动作 token，不自行拼装能力调用或权限。
- null 继承只适用于 controls。若扩展 semantic，必须保留 collection/detail/settings/inspector 四种核心语义并通过预检；workbench 必须保留其声明范围的业务信息。
- Worker 内仅保存筛选、展开等临时视觉状态；持久业务状态、审批、管理和恢复由宿主持有。

主题、控件、语义和工作台可按需扩展。本骨架未声明 semantic/workbench，二者继续使用宿主实现。

## 5. 安装与验收

1. 执行 `pnpm run verify`，记录输出的两个绝对路径。
2. 在 Aibo 能力插件管理入口安装 `capability` 指向的目录并启用，从命令入口打开 **Aibo starter greeting**，确认出现“你好，Aibo！”且刷新可用。
3. 在呈现包管理入口安装 `presentation` 指向的目录并选择该呈现，检查主题、Agent 状态标签和默认模型控件。
4. 检查停用、重新启用、重启与升级。能力 release 和会话绑定不可静默迁移；呈现包故障应恢复宿主呈现。
5. 若呈现异常，可使用宿主恢复快捷键 Ctrl/Command+Shift+Backspace。

本项目 verify 检查呈现控件输出/默认继承、TypeScript 编译、能力归档完整性以及呈现清单和资源校验。不启动桌面应用，也不证明协议握手、实际安装或完整交互通过。直接启动能力 worker 会等待 stdin 握手，不能当作冒烟测试。

修改宿主时还需在 Aibo 仓库执行 `pnpm run verify`；涉及原生能力或会话时，根据宿主文档运行对应 Rust 测试与原生探针。

## 6. 权威参考

以下路径均相对于相邻的 `../aibo` 仓库；自定义 AIBO_ROOT 时在相应仓库查阅：

- `docs/plugin-development_zh.md`：官方插件开发指南。
- `docs/plugin-platform-support-matrix.md`：协议与平台支持矩阵。
- `docs/presentation-package.md`：完整呈现包、视觉树与动作合同。
- `contracts/plugin-manifest.v2.schema.json`：能力清单 schema。
- `packages/plugin-protocol/src/`：协议 TypeScript 类型。
- `packages/capability-runtime/`：能力运行时 SDK。
- `packages/presentation-tools/`：呈现打包工具。

升级宿主 SDK 时重新构建并执行桌面验收。开发和发布产物中不要包含凭据或未脱敏日志。
