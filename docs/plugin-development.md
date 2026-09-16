# Aibo 插件开发文档

最近核对：Aibo 提交 `0d729ff`（2026-09-16）。本次增量核对 `a3d9eac..0d729ff`，保留前次相关变化作为迁移参考。

| 提交 | 变化 | 开发者需要注意 |
| --- | --- | --- |
| `0d729ff` | 分作用域的 Agent 设置协议 | 声明 settings，在每次调用消费 context.settings；处理继承和版本隔离 |
| `21e17bf` | 能力感知的 Fast 服务层级 | 按模型目录协商；ModelMatrix 动作新增 kind 区分 |
| `29e63dc` | 修正上下文用量 | 区分当前上下文占用与会话累计用量 |
| `a3d9eac` | 会话提供者自动发现、图标归插件所有 | 声明 provider 名称和可选 icon；工作台改用 createAgent |
| `d2370dd` / `e5ad409` | 只读和可写轮次沿用会话固定绑定 | 不在每轮执行前重新选择提供者 |
| `3eb7e6e` | 复用仍存活且绑定匹配的会话运行时 | 不依赖每次元数据读取都触发 session.open |
| `e05b117` | 统一审批审核方语义 | 使用 approvalReviewer，由原生 Adapter 映射引擎权限 |
| `94bac53` | 桌面启动时补全可执行文件搜索路径 | 仍需声明运行依赖，并验证从 Applications 启动 |
| `eb53191` | 修复桌面包内置 Agent 图标资源 | 最新实现已将图标转移到 provider 清单，勿沿用皮肤内置品牌资源方案 |

同期管理中心和内置皮肤布局更新不改变本项目两类插件的包入口。当前骨架仍可使用原协议版本；新增可选字段不要求将只读能力骨架升级为会话 Agent。

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

### 3.1 会话 Agent 的发现与图标

新建会话轮盘根据已安装的能力提供者生成入口。被发现的 contribution 必须是 `kind: "capabilityProvider"`、`scope: "session"`，并在 operations 中声明 `capability.id: "aibo.session.open"`。安装必须已启用、可运行、无 activationIssues，且该 contribution 的包依赖可用。

在该 contribution 上设置 `displayName` 和可选的 `icon`，不是放在清单顶层或旧 Agent 元数据中。例如向已有 provider 对象添加：

```json
{
  "displayName": "My Agent",
  "icon": { "path": "M12 2L22 12L12 22L2 12Z" }
}
```

这只是字段示例，不是完整 contribution。图标是 24 × 24 坐标系的单色 SVG path，可包含多个子路径，最多 8192 字符；不接受完整 SVG、URL、脚本或样式。宿主验证 path，皮肤决定颜色与状态效果。无图标时宿主默认使用通用菱形。

一个插件可声明多个 session provider，各自具有名称和图标。禁用或卸载会移除新建入口；已有会话的身份仍来自其固定安装版本，不等同于允许继续执行。本项目 greeting 使用 application scope，因此不会出现在新建会话轮盘中；只添加图标或修改 scope 不能使它成为完整会话 Agent。

### 3.2 会话权限与生命周期

- 宿主持久化 `approvalReviewer`：`user`、`auto-review` 或 `none`。原生 Adapter 将这些语义转换为引擎的审核路由和权限授权；不要直接把它们当作引擎私有参数。
- 用户选择的会话执行配置授权该会话的顶层轮次，无需第二次宽泛权限确认；它不授权任意插件写入或嵌套依赖写入。write effect、所需权限、作用域和宿主审批规则仍适用。
- 会话固定绑定安装版本与 contribution；读取和写入轮次均通过该绑定派发。不要依靠动态 provider 选择覆盖已有会话绑定。
- 绑定与存活运行时代际匹配时，元数据读取复用运行时，不重复打开会话。运行时关闭或空闲过期后仍会重新打开；实现和测试需同时覆盖复用与恢复，不能只依赖 Worker 内存保存会话状态。

### 3.3 桌面运行依赖

宿主补全 GUI 启动时常缺失的工具目录，并将同一搜索 PATH 传给能力 Worker，包括 macOS Homebrew 目录及常用 Node 版本管理器路径。插件仍需准确声明 `executableDependencies`；此改动不自动安装 Node 或其他引擎，也不保证任意自定义安装位置可发现。Worker 使用受控环境，不应假设继承完整 shell 环境。验收时应从 Applications 启动 Aibo，检查依赖就绪状态与实际调用。

### 3.4 Fast 与服务层级能力

Fast 通过会话能力 `model.service-tier` 和模型目录协商，不应通过 Agent 名称判断支持。当前内置 Codex 的实现可作参考，不能假设所有会话提供者都有这项能力。

- 在清单声明自己的服务层级操作，并在会话 capabilities 中报告 `model.service-tier`。内置 Codex 的能力 ID 为 `dev.aibo.codex.model.service-tier`，适配器操作为 `ext.dev.aibo.codex.service-tier`；第三方需使用自己的命名空间并实现对应路由，不能只复制能力标签。
- 操作输入使用 `{ action: "list" }` 或 `{ action: "set", tier: "…" }`。模型目录的各模型提供 `serviceTiers: [{ id, label, description }]`，目录顶层用 `currentServiceTier` 表达当前选择。
- 当前宿主从当前模型的 serviceTiers 中寻找 label 去除首尾空白后、不区分大小写等于 `Fast` 的项，同时要求会话具备 `model.service-tier`。不要把显示名 Fast 当作 tier ID；例如后端可使用 `priority`。
- 开启时提交目录中的实际 tier ID，关闭时提交 `default`。宿主及提供者都应验证当前模型支持所选层级。内置 Codex 在切换到不支持当前层级的模型时恢复 `default`。
- 内置 Codex 将选择写入 recovery，并在后续 `turn/start` 中传递 serviceTier；第三方应自行实现设置、实际执行及恢复，单纯显示开关不会改变服务层级。

这项能力不属于通用插件配置，不能用 settings 字段替代宿主的服务层级协商和动作校验。本项目只读 greeting 未声明会话能力，不需要添加 Fast。

### 3.5 Agent 插件设置协议 v1

在 Manifest v2 的 session `capabilityProvider` 上添加 `settings`，由宿主生成设置表单。入口是「管理中心 → 扩展 → 插件 → 设置」；插件无需提供前端代码或申请 application 写权限。以下是已有会话提供者中的局部字段，不是完整清单：

```json
{
  "settings": {
    "schema": "aibo.agent-settings/v1",
    "version": 1,
    "title": "Agent 设置",
    "description": "在下一次调用时应用。",
    "scopes": ["application", "workspace", "session"],
    "fields": [
      {
        "key": "additionalInstructions",
        "label": "附加指令",
        "type": "multiline",
        "default": "",
        "maxLength": 8000
      }
    ]
  }
}
```

`settings.version` 是正整数配置版本，独立于插件 release 版本和 Runtime 版本。类型可从 `@aibo/plugin-protocol/settings` 或主入口导入。字段声明与约束如下：

| 项目 | 规则 |
| --- | --- |
| 控件类型 | text、multiline、boolean、number、select |
| 字段 key | 小写字母开头，后续为字母或数字，最多 64 字符，字段间唯一 |
| 默认值 | 每个字段必填且符合类型与约束；false、0、空字符串都是有效覆盖值 |
| 类型约束 | min/max 仅用于 number；maxLength 仅用于文本；options 仅用于 select |
| 大小 | 最多 64 字段，每个 select 最多 64 项；文本默认上限 16384 Unicode 码点 |
| 总量 | 声明和每个作用域保存值各不超过 64 KiB UTF-8 JSON |

v1 不接受任意 HTML、脚本、CSS 或 JSON Schema 引用，也不提供密码字段或密钥存储；凭据继续由 Agent 自身认证机制管理。

#### 继承、保存和版本

有效值按「字段默认值 → application → workspace → session」覆盖，只应用声明在 scopes 中的层。项目身份由宿主根据会话数据库解析，调用方不能用任意路径替代。

宿主读取返回本层 `values`、完整 `effectiveValues`、不含本层覆盖的 `inheritedValues`，以及 `descriptor`、`target`、`revision`。保存是**替换本层整个覆盖对象**；省略字段表示继承，`values: {}` 清空本层覆盖，不能用空字符串或 false 代替“继承”。表单重置先改草稿，保存后才持久化。

保存携带配置 version 和 `expectedRevision`，宿主以原子比较更新防止覆盖其他窗口的修改，初始 revision 为 0，成功保存（含清空）递增。冲突返回 `settings_conflict`，保留草稿并由用户明确重新加载；格式错误为 `invalid_settings`，目标不可用为 `settings_unavailable`。宿主 API 为 `readAgentSettings` / `saveAgentSettings`，IPC 为 `read_agent_settings` / `save_agent_settings`，不是外部插件可直接执行的能力。

配置按 plugin ID、contribution ID、settings.version 和作用域身份隔离。相同配置版本的升级/重装复用配置，卸载保留配置；禁用但仍安装的插件可编辑配置而无需启动 Worker。更改字段含义、删除字段或收紧约束时必须递增 settings.version；新版本独立存储，回滚可读取旧版本，v1 不自动迁移。已有会话仍使用固定 release：旧 release 未声明设置时不会收到新设置，应使用新版提供者创建会话。

#### 在调用中消费

宿主在 `CapabilityInvocation.context.settings` 中提供 `{ schema, version, values }`。插件应检查 schema 和 version，并在每次调用读取完整有效值，而不是仅在进程启动时缓存。调用 input 不能覆盖此上下文；插件间调用由宿主为被调用 contribution 单独解析。无 settings 声明的旧贡献不会新增此字段。

生效边界是**下一次 capability invocation 的设置快照**；已运行调用及其 control 沿用原快照。保存不会中断回合或强制重启。只支持启动时生效的参数需在描述中注明，并在后续启动操作处理。

内置 Codex/Pi 的共享 session provider 将 additionalInstructions 加在下一条发送给引擎的文本之前，不修改已保存的用户原始消息或审批策略。第三方自定义 worker 必须实现自己的字段消费；声明同名字段本身不会自动获得此行为。本项目 application scope 的 greeting 骨架未接入会话设置。

### 3.6 上下文用量报告

宿主现在优先读取显式 `contextTokens` / `contextUsedTokens` / `usedContextTokens`，其次读取 `last.totalTokens`，最后回退到 input 用量并标记为估算。会话累计 total/input 与当前上下文占用不同；提供者应报告准确的当前上下文值及 `contextWindow` / `contextLimit` / `modelContextWindow`，呈现插件应保留宿主的估算语义，不自行把累计 token 数当作上下文大小。


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

### 4.1 接收插件拥有的 Agent 图标

`PresentationStatusMark` 新增可选 `icon?: AgentIcon`，其中 `AgentIcon` 为 `{ path: string }`。呈现插件应消费 `input.data.props.icon`，不要根据 `props.agent` 硬编码 Codex/Pi 图标。需要绘制图标时，在状态根节点的 children 中加入如下受限视觉树节点，并保留宿主 label 作为文字或可访问名称：

```js
const iconNode = {
  tag: 'svg', key: 'agent-status-icon',
  attrs: { viewBox: '0 0 24 24', width: '16', height: '16', 'aria-hidden': 'true' },
  children: [{
    tag: 'path', key: 'agent-status-icon-path',
    attrs: { d: input.data.props.icon?.path ?? 'M12 2L22 12L12 22L2 12Z', fill: 'currentColor' },
  }],
};
```

当前骨架仍是纯文字状态控件，会忽略可选 icon；它保持兼容，但不会自动显示插件品牌图标。以上是扩展示例，尚未写入骨架实现。图标无需作为独立 SVG 资源打包，许可与署名仍由提供图标的插件维护。

### 4.2 整窗呈现的会话创建迁移

这部分适用于自行新增 workbench surface 的插件，当前 controls 骨架不受影响。

- 从 `data.navigation.agentChoices ?? []` 读取候选项 `{ id, label, icon? }`，不要写死两种 Agent。
- 旧动作 `createCodex` / `createPi` 已从导航合同移除，改为 `createAgent`。
- 在 `data.navigationActions` 中同时匹配 `operation === 'createAgent'`、`targetId === workspace.id`、`choiceId === choice.id`，将找到的宿主 token 绑定到真实 click。
- 将 choice ID 和 token 当作不透明标识，不解析或自行构造；无匹配动作时不提供可执行入口。候选列表可能为空，应保留合理的空状态。
- 若自行展示会话执行配置，同步消费 `PresentationConversation.executionProfile` 的 `approvalReviewer`，保持宿主语义。

这些合同仍使用现有呈现版本号，不能仅凭 `hostApi: "1.0.0"` 假定旧导航动作继续存在。升级时对照 SDK 类型与目标宿主提交测试。

### 4.3 Fast 的呈现合同与设置表单边界

自定义 ModelMatrix 时，`props.fastTier` 为 `{ id, label, description, active } | null`。actions 已改为有 kind 字段的联合类型：

- `kind: 'model'`：包含 token、model、reasoningEffort。
- `kind: 'serviceTier'`：包含 token、serviceTier。

先按 kind 区分动作，再将宿主 token 绑定 click；不能把每个 action 都按模型项处理，也不能从 token 内容推导 tier。禁用时宿主不给出可执行动作。fastTier 为 null 时不画 Fast 控件；内置 Composer 已在菜单标题区绘制 Fast，因此其嵌入的 ModelMatrix 会传入 null，以免重复显示。本项目对 ModelMatrix 返回 null，继续继承宿主实现，无需修改骨架。

整窗呈现使用 `data.conversation.modelCatalog` 的 serviceTiers / currentServiceTier，以及 `data.conversationActions` 的 `selectServiceTier` 操作；绑定宿主生成的参数和 token，保留能力、当前模型、忙碌及归档状态校验。模型、推理强度与服务层级是不同设置。

AgentSettingsForm 是宿主 UiKitAdapter 的可信控件，当前没有加入外部 `PresentationControlData` 目录。外部呈现包不能声明同名 control 来接管设置表单，也不能直接调用设置 IPC；声明式 settings 由宿主管理和绘制。

## 5. 安装与验收

1. 执行 `pnpm run verify`，记录输出的两个绝对路径。
2. 在 Aibo 能力插件管理入口安装 `capability` 指向的目录并启用，从命令入口打开 **Aibo starter greeting**，确认出现“你好，Aibo！”且刷新可用。
3. 在呈现包管理入口安装 `presentation` 指向的目录并选择该呈现，检查主题、Agent 状态标签和默认模型控件。
4. 检查停用、重新启用、重启与升级。能力 release 和会话绑定不可静默迁移；呈现包故障应恢复宿主呈现。
5. 若呈现异常，可使用宿主恢复快捷键 Ctrl/Command+Shift+Backspace。

会话 Agent 或整窗呈现还需补充以下验收：

- 安装、启用、缺少运行依赖、禁用和卸载时，轮盘入口随可用性变化；同包多个 provider 各自显示。
- 提供/省略 icon，长路径或非法图标被拒绝；使用自定义状态控件时检查标签和图标降级。
- 新建操作按工作区及 choiceId 匹配宿主 token，不存在的候选和迟到事件不能误建会话。
- 已有会话升级后保留绑定；只读、可写轮次、审核方配置、运行时复用及关闭后恢复分别验证。

Fast 和设置协议的扩展实现还需验证：

- 未报告 model.service-tier 或当前模型无 Fast 时不显示开关；实际 tier ID（如 priority）与 default 切换正确，不改动推理强度。
- 切换到不支持当前 tier 的模型、会话恢复、下一轮实际传参、禁用状态与迟到动作；ModelMatrix 正确区分两种 action kind。
- 设置默认值与三层继承，false/0/空字符串覆盖，单字段继承与全部重置；并发保存冲突保留草稿。
- 同配置版本升级/重装、配置版本递增及回滚、卸载保留、旧会话 release 隔离。
- 已运行调用不受保存影响，下次调用无需重启读取新配置；配置不泄漏到其他 contribution，也不能由 input 伪造。

相关宿主检查：`node --test test/agent-settings.test.mjs test/model-configuration.test.mjs test/composer-fast-tier.test.mjs test/presentation-controls.test.mjs test/presentation-conversation.test.mjs test/session-usage.test.mjs`。设置数据库与完整链路测试、双皮肤浏览器探针见 `docs/agent-plugin-settings.md`。本项目的 verify 不覆盖这些扩展行为。

本项目 verify 检查呈现控件输出/默认继承、TypeScript 编译、能力归档完整性以及呈现清单和资源校验。不启动桌面应用，也不证明协议握手、实际安装或完整交互通过。直接启动能力 worker 会等待 stdin 握手，不能当作冒烟测试。

修改宿主时还需在 Aibo 仓库执行 `pnpm run verify`；涉及原生能力或会话时，根据宿主文档运行对应 Rust 测试与原生探针。

## 6. 权威参考

以下路径均相对于相邻的 `../aibo` 仓库；自定义 AIBO_ROOT 时在相应仓库查阅：

- `docs/plugin-development_zh.md`：官方插件开发指南。
- `docs/agent-plugin-settings.md` / `contracts/agent-settings.v1.schema.json` / `packages/plugin-protocol/src/settings.ts`：设置声明、继承、快照和验证。
- `src-tauri/capability-plugins/codex/engine.mjs` / `plugin.json`（同目录）：当前服务层级能力及实际执行参考。
- `src/lib/app/model-configuration.ts` / `src/lib/app/session-usage.ts`：服务层级校验及上下文用量归一化。
- `docs/plugin-platform-support-matrix.md`：协议与平台支持矩阵。
- `docs/presentation-package.md`：完整呈现包、视觉树与动作合同。
- `contracts/plugin-manifest.v2.schema.json`：能力清单 schema。
- `packages/plugin-protocol/src/`：协议 TypeScript 类型，重点查看 `agent-icon.ts`、`presentation-controls.ts`、`presentation-navigation.ts` 和 `presentation-conversation.ts`。
- `contracts/session-capabilities.v1.json` / `contracts/execution-profile.v1.schema.json`：会话能力及审核方字段。
- `src/lib/app/session-providers.ts`：当前自动发现和候选可用性规则。
- `test/plugin-management.test.mjs` / `test/plugin-manifest-v2.test.mjs` / `test/presentation-navigation.test.mjs`：发现、图标和导航回归用例。
- `src-tauri/src/session_host_tests.rs`：固定绑定、运行时复用与恢复测试。
- `packages/capability-runtime/`：能力运行时 SDK。
- `packages/presentation-tools/`：呈现打包工具。

升级宿主 SDK 时重新构建并执行桌面验收。开发和发布产物中不要包含凭据或未脱敏日志。
