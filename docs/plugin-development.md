# Aibo 插件开发文档

最近核对：2026-09-18，Aibo 提交 `7865fad`（通用能力分发）。§3.11 说明新的声明、协商和迁移规则；Cursor 0.1.11 已完成合同适配。此前上下文规格、目标、子 Agent 和持久队列规则仍保留。本地提交不代表已发布版本；安装前核对目标宿主包含该合同。

| 提交 | 变化 | 开发者需要注意 |
| --- | --- | --- |
| `7865fad` | 按协商能力分发 Agent 功能 | 清单、实际握手、open 声明及精确 schema 一致；执行权限由宿主授权 |
| `b96a5d7` | 模型上下文规格选择及 Codex/Pi 接入 | 新增 model.context-window、按模型的 contextWindows 与目录顶层 currentContextWindow；实际应用并确认后发布状态 |
| `dd2a458` | 持久队列开放给标准会话插件 | 宿主派生 queue.manage；queue.steer 单独协商，未知投递不自动重发 |
| `eaefa0c` | 内置 Codex/Pi 持久消息队列 | 稳定消息 ID、revision、暂停恢复及 uncertain 不自动重发 |
| `c817c9a` | 子 Agent 进度与持久历史 | 新增 subagent 事件、独立卡片和 openSubagent 动作 |
| `c867685` | 目标控制与 Codex 暂停/恢复 | 恢复走宿主回合准入，区分目标状态和执行状态 |
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
│   ├── cursor/                  # Cursor ACP 会话提供者
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
| 能力运行协议 | 只读能力骨架 Runtime 2.0；Cursor 会话插件 Runtime 2.1 |
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

- `capability/`：能力示例安装目录，包含 `plugin.json`、`dist/worker.js` 和运行依赖。
- `cursor/`：Cursor ACP 会话插件安装目录，包含 Worker 及运行依赖；实现范围和安装要求见 `plugins/cursor/README.md`、`docs/cursor-acp-spec.md`。
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


### 3.7 目标暂停、恢复与执行准入

目标状态与回合执行状态独立：active 目标在空闲会话中表示“待继续”，不是正在执行工具。会话可继续只报告 `goal.manage`；暂停和恢复按钮分别依赖固定 release 报告的 `goal.pause`、`goal.resume`，旧会话不会因宿主更新自动获得能力。

目标恢复是宿主执行意图，不应通过普通元数据操作绕开回合准入。实现恢复的 session provider 需按共享合同声明 Runtime 2.1 核心能力：

- `aibo.session.goal.resume`：只读恢复。
- `aibo.session.goal.resume.write`：可写恢复，使用与 `aibo.session.turn.write` 相同的会话作用域写入授权。

两者输入均为 `{}`，输出与正常回合一致，包含 `status`（completed/interrupted/failed）和 recovery。操作 schema、effect、permissions 应与 `contracts/session-capabilities.v1.json` 及宿主校验一致。宿主分配 turn 并负责事件、审批、取消和工作区变更记录；恢复不消费 Composer 草稿或待发送附件。

`goal.updated` 是新增会话事件，仅接受报告了 `goal.manage` 的提供者，payload 使用 `{ goal }`；它更新目标展示，不改变宿主执行状态。运行期间目标读取通过 live control 完成，不应等待长调用结束。

内置 Codex 的实现示范：创建目标先保存为 paused，`/goal` 再请求宿主准入恢复；恢复激活原生目标，不另发一条继续提示。多个原生回合属于一个宿主逻辑执行，直到连续执行真正结束才发送终止事件。暂停先保存 paused，再中断原生回合，保留目标、预算和用量；中断失败仍报告错误，不能假装已停止。等待原生启动有 30 秒超时保护。这些是当前 Codex 的实现行为，不是所有第三方引擎自动具备的能力。

目标状态新增 blocked、usageLimited、budgetLimited；原生 complete 归一化为 completed，并可报告 `timeUsedSeconds`。预算耗尽不能被普通恢复绕过。共享 session provider 的 additionalInstructions 仅添加到普通发送文本；goal resume 没有发送文本，不会追加这些指令。

### 3.8 子 Agent 进度与持久化历史

新增 `subagent.updated` 和 `subagent.message`，应遵守 `contracts/session-event.v1.schema.json`（兼容事件 schema 同步更新）。这不是把子 Agent 内容作为主助手消息重复输出：

| 事件 | payload 必填字段 |
| --- | --- |
| subagent.updated | id、parentId、rootTurnId、name、task、status、activity |
| subagent.message | agentId、rootTurnId、entry |

两类事件的事件级 `turnId` 必须为 null；payload.rootTurnId 指向当前会话中实际存在的宿主父 turn，不能用原生 turn ID 替代。事件仍受调用生命周期、绑定和代际校验，不能绕过正常运行时发送事件。

子 Agent status 为 pending/running/waiting/completed/failed/interrupted/closed/unavailable。entry 必须包含稳定 id、role（user/assistant/system/tool）、toolName（字符串或 null）、content 和 status（streaming/completed/failed/interrupted）；payload 不接受额外字段。

`subagent.message` 传递同一 entry 的完整更新快照，历史按 entry.id 保留最新内容并保持首次出现顺序；不要把增量片段当作完整 content 覆盖。宿主将进度投影为 `toolName: 'subagent'` 的主时间线卡片，卡片 content 为序列化任务对象，详细过程保存在事件历史中。详情可在重启后读取，无需重新启动原生 Agent；父 turn 已中断或失败时，历史中尚在 streaming 的详情归一化为 interrupted。

当前内置 Codex 跟踪原生子线程及嵌套关系，读取失败可显示 unavailable；未提供过程应明确降级。第三方需实现事件映射，不应以普通工具分组冒充完整子 Agent 过程。

### 3.9 持久消息队列与原生 steering

自 Aibo 提交 `dd2a458` 起，**宿主持久队列已按标准会话合同开放给外部 Agent 插件**，不再按 Codex/Pi provider ID 判断。要求已有有效 Runtime 2.1 会话绑定，且固定 release 的 session contribution 声明符合共享合同的 `aibo.session.open`、`aibo.session.turn`、`aibo.session.cancel`、`aibo.session.close`。宿主在公开 Session.capabilities 中补充 `queue.manage`，无需插件实现原生等待队列；未绑定或旧 Runtime 会话不获得该能力。

运行中追加输入单独以宿主派生的 `queue.steer` 标记控制。当前兼容现有操作协议：提供者原始协商 capabilities 包含 `queue.manage`，且清单声明版本 1.0.0 的 `<pluginId>.queue.manage` 操作，`inputSchema.properties.action.enum` 明确包含 `steer`。宿主通过活动调用的 control 发送 `{ action: "steer", message: "…" }`，成功响应必须表示消息已被接收。只声明 queue.steer 字符串不能获得该能力；宿主派生标记不回写提供者原始协商数据。

因此，仅具备标准生命周期的插件也可以持久排队、删除、清空、暂停恢复，并在回合结束后自动发送。无 steering 时隐藏运行中的立即发送，后端在入队/领取前拒绝显式 steer/sendNow；空闲时仍允许把队列项作为正常回合立即发送。第三方须正确报告 turn.started 和终止事件，缺失确认仍按 uncertain 处理。当前 Cursor 骨架具备标准生命周期，可使用基础队列，无需伪造原生 queue.manage 能力。

符合上述合同的会话运行中发送会加入宿主等待队列。成功回合完全结束后按入队顺序经正常执行准入派发下一条。通过宿主的 queue.manage 入口提供：

| action | 附加输入 | 行为 |
| --- | --- | --- |
| get | 无 | 读持久快照，不启动原生运行时 |
| followUp | message | 保存等待消息及其引用附件 |
| steer | message | 先保存，再尝试立即投递 |
| remove | id | 删除一条未被领取的消息 |
| sendNow | id | 立即投递现有消息 |
| clear | 无 | 清空未被领取的消息 |
| resume | 无 | 恢复暂停队列的有序派发 |

sendNow 不等于中断：存在活动回合且支持 queue.steer 时使用原生 steering，否则仅在空闲时发起正常回合。Codex 使用带预期原生 turn ID 的 turn/steer，Pi 使用 AgentSession.steer；Pi 原生 follow-up 缓冲不作为宿主等待队列来源，任何提供者的 queue.updated 都不能覆盖已由宿主管理的队列快照。

快照和宿主 queue.updated 包含 sessionId、revision、paused、items、updatedAt；item 为 `{ id, text, status, error, createdAt }`，status 为 pending/sending/failed/uncertain。相同文本是不同消息，按稳定 id 操作，按 sessionId/revision 防止迟到读取覆盖新状态。旧 steering/followUp 字符串数组仍供兼容读取，不具备单条身份。

派发在事务中领取消息；正常新回合收到原生启动确认后才移除队列项，steering 收到接受确认后移除并写入已有宿主 turn。明确拒绝保留消息；确认丢失产生不确定结果时不可自动重发。steering 提供者只有确定消息未被接收时才能返回 `no_active_turn` / `no_active_turn:` 或 `steer_rejected` / `steer_rejected:` 错误消息；前者允许等待原回合结束后转普通发送，后者保留失败项。超时或仅在诊断文本中提及 expectedTurnId 不构成安全重试依据。uncertain 项须与历史核对并移除，之后才能恢复队列。

停止、回合失败、应用重启暂停自动消费而不清空消息，重启将未完成发送标为 uncertain。切换会话或呈现不改变队列。每会话最多 100 条等待消息。附件在入队时从 Composer 分离并归属队列项，投递前重新校验；文件变化/缺失保留错误项。删除未发送项只清理其未发送附件，不影响后续草稿或已绑定历史附件。

### 3.10 模型上下文规格选择

上下文选择是独立的会话能力 `model.context-window`，不是推理强度、Fast 服务层级，也不是 §3.6 的 token 用量报告。宿主在 Fast 旁提供下拉框；能力存在、当前模型提供非空选项、目录加载完毕且会话可修改时才启用。旧目录不提供字段仍兼容，归一化为空选项和空当前值。

在 session contribution 中声明自己命名空间下的能力操作，如 `dev.example.agent.model.context-window`，合同版本 `1.0.0`；Worker 实现该操作的路由，并在会话返回的 capabilities 中报告 `model.context-window`。只加标签或只改 UI 数字不构成支持。操作可沿用模型设置的 `effect: "read"`、`permissions: ["workspace.read"]`，但不能借此执行工作区写入或绕过审批。

`model.select` 的 `action: "list"` 返回值中，各模型提供可选 `contextWindows`，目录顶层提供 `currentContextWindow`。以下数字仅为协议示例，不是通用规格：

```json
{
  "models": [{
    "id": "example-model",
    "displayName": "Example",
    "contextWindows": [
      { "id": "standard", "label": "128K", "tokens": 128000 },
      { "id": "extended", "label": "1M", "tokens": 1000000, "description": "Extended context" }
    ]
  }],
  "current": "example-model",
  "currentContextWindow": "standard"
}
```

- `id` 是不透明选项值，不能从 `label` 解析请求参数或 token 数；`label` 用于显示。`description`、`tokens` 可选；tokens 若提供须为安全整数范围内的正数。
- 选项按模型声明，不能把当前模型的规格复制到所有模型。`currentContextWindow` 必须来自已应用状态；未知时返回 null，不默认选中第一项冒充确认。
- 操作接收 `{ "action": "list" }` 或 `{ "action": "set", "contextWindow": "extended" }`。宿主设置前重读模型目录并检查当前模型及选项；插件仍须独立验证支持范围，并拒绝运行中修改。
- 设置成功后，插件返回更新后的 recovery 与 capabilities，并确保下一次目录读取反映真实状态。宿主通过重读目录确认 `currentContextWindow`，不会把请求值直接当作成功，也不向通用 execution profile 填造字段。
- 将选择应用到原生会话或后续实际请求，持久化 recovery；恢复时重新核对支持范围。失败时保持或恢复原配置；模型切换不得串用旧规格。需要重启原生进程时保留历史，并维持当前宿主绑定的事件身份。

#### 规格来源与原生生效路径

不能仅依据一个本地 `contextWindow`、模型名称或其他服务商的同名模型生成更大档位。应记录原生目录或官方规格来源，核对实际 provider、API、端点及原生应用机制；目录可见也不等于账号有权限。

| 当前内置插件 | 规格来源 | 实际应用与限制 |
| --- | --- | --- |
| Codex 2.0.9 | 原生 `model/list` 与同一 `CODEX_HOME` 的 `models_cache.json`，精确匹配 slug 的 context_window / max_context_window | 仅提供默认/最大两个不同窗口；缓存缺失、异常或超过 24 小时，以及自定义 provider、端点或 model_catalog_json 时不开放。专用 app-server 通过启动配置应用窗口和 90% 自动压缩阈值，恢复线程并读取运行配置确认 |
| Pi 2.0.5 | SDK ModelRuntime 的合成目录；SDK 0.84.4 的 docs/models.md 和官方模型页明确记录的长上下文规格 | 仅官方 OpenAI Responses 的 gpt-5.6-sol / terra / luna 提供 272K / 1.05M；同时检查模型地址和认证解析后的真实地址。通过 AgentSession.setModel 应用到运行模型并保留推理强度与定价信息 |

Codex 对已经加载的线程再次调用 `thread/resume.config`，可能成功返回却忽略新窗口，因此不能只检查 RPC 成功。当前实现重启会话专用 app-server 后恢复；不修改用户全局配置。Pi 的原生 API 没有独立的“申请 1M”参数，SDK 的运行窗口决定何时压缩及能够保留多少上下文，服务端仍按实际输入执行既有上限和权限检查。API 官方规格不能套到 Codex 订阅或代理服务上。

当前验证边界：Codex CLI 0.153.4 的真实短请求已确认 872K → 272K 对应有效窗口 828,400 → 258,400（保留 5% 余量）；Pi 使用真实 SDK 与模型目录、截获传输的离线测试确认 1.05M → 272K 进入请求管线并保留历史。未发送百万 token 付费请求，这些结果不证明账号拥有额外权限。

本项目 Cursor 0.1.8 已提供模型目录和选择，但尚未接入此上下文能力；宿主更新不会自动启用它。后续应按 Cursor 实际返回的规格和设置操作适配，保留原生选项 ID，不复制 Codex/Pi 的窗口值或推断付费权限。

### 3.11 通用能力声明与迁移

宿主按功能能力分发，不再根据 Codex/Pi 身份决定第三方插件是否获得命令目录、模型选择、会话树、时间线、线程快照或分支功能。功能支持与运行中、忙碌、归档等动作准入状态分开处理。

接入时同时满足以下条件：

1. 会话使用 Manifest v2 与显式 Runtime 2.1。基础操作遵守宿主 `contracts/session-capabilities.v1.json`。
2. 可选操作位于 session contribution，能力 ID 为 `<pluginId>.<feature>`，版本为 `1.0.0`，effect 为 read，permissions 恰为 `["workspace.read"]`。inputSchema/outputSchema 必须按 JSON 值精确匹配 `contracts/session-features.v1.json` 中的一个变体；不要自行增加 required 或 anyOf，业务参数完整性在处理器中检查。
3. Runtime initialize 的 operations 返回清单的 `{ capability, version, operationId }`。capability 使用完整 ID，operationId 对应操作 id。`aibo.session.open` 返回 nativeSessionId、recovery 和不带插件前缀的能力名，例如 `model.select`。
4. 操作结果返回共享合同要求的 recovery、capabilities 与其他必填字段；模型目录、命令目录也不能省略 envelope。只加标签、只改清单或只实现路由都不构成完整支持。

模型选择有 reference 和 provider/modelId 两种合同变体，按实际原生接口选择。建议在构建时从固定宿主合同提取 schema，并在测试中比较清单与合同；发布包不得在运行时读取开发机宿主源码。详细生成示例与排查表见相邻宿主的 [会话能力声明与协商](../../aibo/docs/session-capability-negotiation.md)。该相对链接假设两个仓库并排检出；使用 AIBO_ROOT 时阅读对应宿主文件。

功能语义也需明确：

- `command.list` 的命令可返回 insertionText，例如 `/review `，缺省为 `/${name} `。agent 字段仅为兼容元数据，不按品牌筛选。宿主快捷命令同名优先，普通 slash 输入通过 turn 发送。
- `session.tree` 提供导航；`session.timeline` 独立返回 branch 快照；`session.snapshot` 返回远端 thread 摘要，不是 recovery；`session.fork` 返回新原生会话绑定。不要用一个能力隐式表示其他能力。
- 远端会话目录使用标准 workspace scope `aibo.session.catalog`，返回 threads，而不是增加品牌判断。
- 呈现插件使用宿主提供的动作、canSyncSnapshot 和 execution profile 的 accessModes，不根据插件名称补造支持状态。

功能声明不等于执行授权。可信执行后端授权绑定具体 installation/contribution，由宿主管理。没有可信原生授权时，只有完整实现标准 `aibo.session.tool.respond` 和 `aibo.session.turn.write`、实际接入宿主工具网关的提供者才能进入 CoreProxy 路径；不能靠空操作或 manifest 字段获得写权限。未协商执行后端只获得 read-only 配置，具体动作仍需满足权限、信任和审批要求。

Cursor 0.1.11 对齐了 command.list、model.select、model.reasoning、model.context-window、approval.respond、user-input.respond 六项操作的精确 schema，补齐响应 envelope，并提供命令 insertionText。Cursor 的原生 ACP 工具执行尚未接入宿主 CoreProxy，宿主仍只提供 Ask/read-only；原生 Plan/Edit 不等于宿主已授权对应模式。

迁移后增加插件版本、重新构建并安装，再用新会话验证。旧会话固定旧 release，不会自动换绑。排查功能缺失时依次检查 open 声明、manifest schema、握手三元组、原生实现和会话状态。当前 Cursor 测试及打包 Worker 冒烟会检查上述合同与模拟 ACP 响应；真实 Cursor CLI、桌面安装、权限隔离和完整交互仍需单独验收。

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

### 4.4 目标、子 Agent 与队列的工作台适配

以下变化影响自行实现 workbench 的包。当前骨架仅提供状态控件，其余继承宿主，无需添加这些界面。

- **目标**：消费 `data.conversation.goal` 和可选 `goalBusy`，支持新增状态及可选 timeUsedSeconds。绑定 conversationActions 中的 clearGoal/pauseGoal/resumeGoal；不能只根据 active 判断正在执行，也不能绕过宿主动作目录自行恢复 budgetLimited 目标。paused 但 running 时应说明当前回合尚未结束。
- **子 Agent**：识别 timeline 中 `toolName === 'subagent'`，解析并校验 content 后展示名称、任务、状态和活动摘要，作为独立卡片而不是普通工具组。解析失败保留可读降级。绑定 `openSubagent` 和对应 child.id 的宿主 token，详情由宿主持有；插件不直接调用历史 IPC。
- **队列**：优先读取 queue.items，按稳定 id 展示文本、状态和错误。items/paused/revision 在呈现类型中为可选字段，旧快照可降级显示 steering/followUp，但不要为没有稳定 ID 的文本合成删除动作。
- **队列动作**：新增 removeQueuedMessage/sendQueuedMessage/resumeQueue，继续支持 queueSteer/queueFollowUp/clearQueue。单条动作 args 绑定 item.id；sending 项不提供单条操作，uncertain 不提供立即发送且阻止恢复。运行中的 queueSteer/sendQueuedMessage 还要求 queue.steer；仅有 queue.manage 时只提供等待队列操作。所有可执行按钮只使用当前宿主目录中的 token，不从显示状态自行推导权限。

GoalBar、SubagentCard、SubagentDialog 是宿主 UiKitAdapter 控件，本次未将它们加入外部 controls 目录；外部 workbench 通过视觉树和上述语义动作提供相应展示，不能声明同名 controls 获得宿主接口。队列状态、详情历史、草稿和附件归属仍由宿主维护，切换呈现不能清空或重新派发。

### 4.5 上下文下拉框的呈现合同

整窗呈现读取 `data.conversation.modelCatalog.current.contextWindows` 和目录顶层的 `currentContextWindow`，将下拉框放在 Fast 旁。旧宿主或无支持时允许字段缺失；无选项、加载中、运行中、忙碌或归档状态均不得提供可执行选择。

从 `data.conversationActions` 获取 `operation === 'selectContextWindow'` 的宿主动作，将其 token 绑定到选择控件的 `events.change`，以字符串 value 提交所选 ID。动作参数为 `[当前模型 reference, ...允许的选项 ID]`，由宿主生成，不自行构造。宿主验证快照 revision、模型身份和允许值，拒绝旧页面、已移除选项和伪造值；提交后保留原确认值，收到新状态再更新选择。

该操作不是 `ModelMatrix` 的新增 click action kind，也不是把上下文 ID 作为推理强度发送。内置双皮肤通过可信 `UiKitAdapter.ModelContextSelect` 实现；该控件未加入外部 `PresentationControlData` 控件目录。仅覆盖状态控件并继承宿主其余界面的本项目呈现骨架无需改动，自定义整窗 workbench 可参考宿主 `packages/presentation-workbench/conversation.js`。

## 5. 安装与验收

1. 执行 `pnpm run verify`，记录输出的 capability、cursor、presentation 三个绝对路径。
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

上下文选择扩展还需验证：

- 能力或选项缺失、旧目录、加载中、运行中和归档时正确禁用；未知当前值不伪造选中项。
- 按模型区分选项；拒绝过期动作、非法 ID、切换模型后的旧选择及通过 control 绕过运行中禁用。
- 设置实际进入原生配置或请求管线，重读目录确认；原生拒绝或未确认时回滚并保留错误。
- 首次发送前切换、已有历史切换、Worker 重启恢复、资源重载及再次换模型均正确；保留会话历史和事件身份。
- 规格来源缺失/过期、自定义端点和认证地址重定向时保守禁用；不因目录可见而隐藏或吞掉权限错误。

宿主对应检查：`node --test test/provider-context-window.test.mjs test/model-context-select.test.mjs test/model-configuration.test.mjs test/presentation-conversation.test.mjs`，以及 `cargo test --manifest-path src-tauri/Cargo.toml context_window --lib`。区分模拟协议测试、真实 SDK 传输截获与真实付费 API 请求，记录验证边界。

目标、子 Agent 与持久队列还需验证：

- 旧 release 不出现未支持的目标按钮；恢复读/写授权、暂停失败、原生连续回合及预算耗尽；恢复不消费草稿或附件。
- 子 Agent 事件字段、null turnId 与有效 rootTurnId；同 entry.id 更新不重复，嵌套任务、读取失败降级、父任务中断及重启后历史。
- 外部提供者无原生队列也可 FIFO 发送；缺失标准生命周期或绑定时不启用。只有清单和原始协商同时支持 steer 才显示运行中立即发送，后端拒绝不能新增/领取队列项。
- 相同文本的两条队列项按 ID 独立删除，FIFO、立即 steering、结束时竞争、revision 排序、停止/重启暂停及 uncertain 禁止重发。
- 队列附件与下一条草稿隔离，文件变化报错，切换呈现不重置队列；旧队列快照降级及动作 token 的会话/条目作用域。

宿主新增相关用例在 `test/session-goal.test.mjs`、`test/subagent-workflow.test.mjs`、`test/message-queue.test.mjs`、`test/presentation-timeline.test.mjs` 和 `test/presentation-conversation.test.mjs`。原生链路运行 `cargo test --manifest-path src-tauri/Cargo.toml --lib`；子 Agent 双皮肤探针为 `node probes/subagent-browser.mjs`。本项目构建不替代这些验证。

本项目 verify 执行现有测试、呈现控件输出/默认继承检查、TypeScript 编译、能力归档完整性以及呈现清单和资源校验；构建还使用模拟 Cursor 引擎对打包后的 Cursor 插件进行协议冒烟检查。该冒烟覆盖打包 Worker 的 Runtime 握手、会话能力声明及操作响应合同，使用模拟 ACP 引擎；不启动桌面应用，也不证明真实 Cursor CLI、实际安装或完整交互通过。直接启动能力 worker 会等待 stdin 握手，不能当作冒烟测试。

修改宿主时还需在 Aibo 仓库执行 `pnpm run verify`；涉及原生能力或会话时，根据宿主文档运行对应 Rust 测试与原生探针。

## 6. 权威参考

- `contracts/session-features.v1.json`、`src-tauri/src/session_contract.rs`：可选会话功能的精确合同与协商。
- `src-tauri/src/execution_profile.rs`：宿主执行后端授权与 accessModes。

以下路径均相对于相邻的 `../aibo` 仓库；自定义 AIBO_ROOT 时在相应仓库查阅：

- `docs/goal-lifecycle.md` / `docs/message-queue.md`：目标准入和持久队列边界。
- `contracts/session-event.v1.schema.json` / `contracts/agent-event.v2.schema.json`：目标与子 Agent 事件字段。
- `src-tauri/src/session_queue.rs` / `src-tauri/src/session_history.rs` / `src-tauri/src/session_projection.rs`：队列适用范围、历史持久化与事件投影。
- `src/lib/presentation-runtime/conversation.ts` / `packages/presentation-workbench/timeline.js`：工作台动作门禁及子 Agent 卡片参考。
- `docs/plugin-development_zh.md`：官方插件开发指南。
- `docs/plugin-development.md`：上下文目录合同及内置 Codex/Pi 规格来源记录。
- `docs/agent-plugin-settings.md` / `contracts/agent-settings.v1.schema.json` / `packages/plugin-protocol/src/settings.ts`：设置声明、继承、快照和验证。
- `src-tauri/capability-plugins/codex/engine.mjs` / `plugin.json`（同目录）：当前服务层级能力及实际执行参考。
- `src-tauri/capability-plugins/pi/engine.mjs` / `plugin.json`（同目录）：Pi SDK 上下文选择与恢复参考。
- `src/lib/app/model-configuration.ts` / `src/lib/app/session-usage.ts`：模型设置确认、服务层级/上下文规格校验及用量归一化。
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
