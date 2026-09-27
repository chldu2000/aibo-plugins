# Cursor ACP 验证记录

## 2026-09-27 — A1 复验与 Cursor 0.2.1 修正

基线：宿主 `5f5c79b` 加工作区能力修正，宿主 SDK **0.1.2**；插件 `8f9f13d` 加工作区修正，
release **0.2.1**（本地构建，尚未发布）。macOS 27.0（26A428）arm64、Node.js `v24.18.0`、
Cursor CLI `2026.09.18-9a7762b`，使用已有登录态。旧插件取自 `d2616e4` 的 0.1.18。

修正：通用层按原生 `loadSession` 声明恢复；`user-input.respond` 由 Cursor 扩展显式声明。
单选问题发现消费端不兼容：原生使用 `prompt`，宿主读取 `question`；界面提交 label，原回调只接受 ID。
0.2.1 补齐映射，并拒绝不存在或有歧义的选项。相关回归测试先复现问题再通过。

| 层级 / 命令 | 本次结果 |
| --- | --- |
| 宿主 `pnpm run verify` | 架构检查 41 项、测试 491 项、类型检查与构建通过 |
| 插件 `pnpm run verify` | 40 项测试、离线构建、打包 Worker 假 ACP smoke 通过 |
| 宿主 `cargo test --manifest-path src-tauri/Cargo.toml --lib session_contract` | 4 项通过 |
| 宿主 `cargo test --manifest-path src-tauri/Cargo.toml --lib capability_session_projects_tools_and_recovers_after_process_restart` | 1 项通过 |
| 宿主 `node probes/plugin-command-menu-browser.mjs` | 修正过期 fixture 锚点后，ak-ui / material3 命令菜单通过 |
| 插件 `node scripts/probe-cursor-parameters.mjs` | 真实 Auto 回合；GPT-5.5、Sonnet 4.6 参数设置与跨进程恢复通过，finally 恢复原模型及参数 |
| 插件 `node scripts/probe-cursor-ui.mjs` | 隔离真实 App、Tauri IPC、WKWebView 和系统点击/键盘；各项覆盖及缺口见下文 |
| 插件 `node scripts/probe-cursor-question-browser.mjs` | 真实适配器→宿主事件投影→App 问题界面→原生选项 ID，双皮肤浅/深色共 4 组通过；原生请求为 fixture |

桌面探针使用临时 Git 工作区、唯一 application identifier/window label 和独立应用数据。
安装、信任、会话准备通过真实 IPC；表单内容由探针填入，菜单、发送、取消、批准使用系统输入。
图片通过合成粘贴事件注入 PNG，确认真实附件预览与模型识别；这不验证系统剪贴板权限。
Ask 执行文本/图片回合，Plan 尝试原生提问，Agent 在临时工作区执行写文件并经过原生审批。
模型选择恢复后结束会话，应用重启前保留 idle 会话，第二个进程加载原生历史。

- 双皮肤 ak-ui/material3、浅色/深色下，slash 菜单展示、选择、Escape 关闭和模型菜单展示/关闭通过；
  Plan → Agent → Ask 切换通过。首轮探针在这些检查之后因图片文件名断言错误退出，不能算整轮成功；
  后续改为检查宿主实际预览，覆盖见 [ui-menus.json](baselines/cursor-a1/ui-menus.json)。
- 最终桌面运行安装打包后的 0.2.1：发送得到 `AIBO_CURSOR_UI_OK`，图片识别为 `RED`，
  Stop 收敛为 interrupted，两个原生审批经界面接受，重启后的回答保持 `ORCHID-742` 上下文。
  新旧会话 installation ID 分别保持绑定，0.1.18 旧空会话重新打开并读取模型目录通过；未验证旧版本新一轮对话。
  最终运行复用此前菜单证据，设置 `AIBO_CURSOR_UI_SKIP_MENUS=1`，
  `AIBO_CURSOR_PACKAGE` 指向 `dist/build-B3Sa9T/cursor`。产物入口摘要及脱敏结果见
  [ui-final.json](baselines/cursor-a1/ui-final.json)。
- 原生提问 **未通过**：[先前 Agent 模式](baselines/cursor-a1/ui-before-question-fix.json)及最终 Plan 模式都未观察到 `cursor/ask_question`，
  CLI 用普通文本回复当前没有 AskQuestion 工具；未据此推断所有环境都不支持。
  `ok: true` 仅表示探针完成，`acceptanceComplete: false` 保留缺口。
  [question-browser.json](baselines/cursor-a1/question-browser.json)仅证明协议回放与界面映射。
- 真实参数配置及恢复证据见 [parameters.json](baselines/cursor-a1/parameters.json)；
  配置成功不证明 GPT-5.5/Sonnet 的实际推理请求可用或上下文容量极限。

未覆盖：结构化原生提问/多选、完整计划及其交互取消、Applications 启动与未登录路径、
外部皮肤、其他平台、完整权限组合、进程泄漏压力测试。本次没有截图或视觉质量验收。
已有 Rust dead-code 与前端 chunk 大小警告未阻止检查；探针主动终止 Tauri 时的 ELIFECYCLE 日志
不代表检查失败，以报告与退出码为准。A1 保留原生提问验收缺口，不标记全部完成。

## 2026-09-25 — Cursor 0.1.17 回复构造精简

- 目标宿主：Aibo `d402f6f` 加本次工作区精简改动；Node.js `v24.18.0`，macOS arm64。
- 模型选择、推理和上下文回复由 session 一次生成 recovery/capabilities，同一回复复用参数快照；
  Worker 不再覆盖它们。模型目录复用已有原生 options 归一化，Runtime 2.1 与恢复 schema 保持不变。
- `pnpm run verify`：53 项测试通过，离线打包及假 ACP Worker smoke 通过；覆盖真实打包后的
  握手、模型/参数/命令封套 schema、恢复数据与流式回合。
- 未调用真实 Cursor CLI 或模型，未执行本次真实桌面安装验收；没有将模拟结果计为这些层面的证据。
- 清单与 npm 包同步为 0.1.17，Worker 从清单读取版本；新安装不覆盖相同版本旧内容，旧会话保留原 release。

## 既有版本记录

本文件按版本保留历史证据。各节的宿主、CLI、权限策略和能力限制仅适用于该节基线，
不作为当前版本的实现规格；当前行为见[规格](cursor-acp-spec.md)与[插件说明](../plugins/cursor/README.md)。
本次文档整理未重跑真实模型、登录或桌面验收，未补齐的门槛仍见[验收清单](cursor-acp-checklist.md)。

验证日期：2026-09-17。仓库宿主基线：Aibo `dd2a458`。插件版本：`0.1.7`。

环境：macOS 27.0 arm64、Node.js `v24.18.0`、Cursor CLI `2026.09.10-fd3934a`。验证工作区是 `/private/tmp` 下新建的空目录，不包含本仓库文件。

真实 ACP 结果：

- `initialize` 协商 protocolVersion 1，Cursor 宣告 `cursor_login`、`loadSession: true`、ask/plan/agent 模式和 session config options。
- `authenticate` 使用已有的 `agent login` 登录态成功。
- `session/new` 冷启动成功；实测可能超过 14 秒，因此插件将 new/load 内部上限改为 90 秒，Manifest open 上限改为 120 秒。
- Ask/read-only 轮次发送固定提示后，Cursor 流式返回准确文本 `AIBO_CURSOR_OK`，最终 stopReason 映射为 completed。
- 事件序列包含 session.started、turn.started、reasoning.updated、message.delta、message.completed、reasoning.completed 和唯一 turn.completed。
- 关闭原进程后，新进程以 recovery 中相同 nativeSessionId 成功执行 `session/load`；历史回放未生成带当前 turnId 的 Aibo 事件。

本地自动验证：

- `pnpm run verify`：24 项测试通过（含 manifest/队列合同与 Cursor 子 Agent 生命周期回归测试）；三个安装目录构建成功。
- ACP 传输测试覆盖分割 UTF-8、半行、多行、CRLF、字符串/数字 ID、ID 0、双向请求、写入背压、超限无换行帧、畸形 JSON、stdout EOF、stdin 错误和 deadline；异常时所有 pending request 均结束。
- 会话测试覆盖多消息分段、即时完成工具和重复终态去重、未知 stop reason、prompt 传输失败及宿主执行中关闭后的状态收敛。
- Worker/会话边界要求 edit 模式只能接受宿主写授权轮次、ask/plan 只能接受只读轮次；设置 schema/version/长度错误会明确失败。交互请求按 JSON-RPC ID 类型、当前 turn 和 native session 绑定，禁用网络时 URL/curl/wget 类请求直接拒绝。
- 强制取消会响应并结算所有待处理交互，发送 `session/cancel`，宽限期后关闭 ACP，并以唯一 interrupted 终态结束。计划接受与多选问题可同时存在，数字和字符串 JSON-RPC ID 不冲突。
- Cursor manifest 的 open/turn/cancel/close 已与 `dd2a458` 的共享会话合同逐字段对照；满足宿主派生基础 `queue.manage` 的条件。provider raw capabilities 和 operations 均不声明原生 steering，因此宿主不会派生 `queue.steer`。目标能力保持未声明。
- 本机 Cursor CLI `2026.09.10-fd3934a` 的 ACP 实现确认 task tool 提供 toolCallId、prompt、description、subagentType，完成通知另带可选 agentId/model/durationMs。插件将其映射为 schema 合规的 `subagent.updated`，抑制重复普通工具卡；完成通知缺失、父回合取消或失败均有明确终态。CLI 未提供过程 entry/历史读取，因此不发送 `subagent.message`。
- 宿主 `node --test test/message-queue.test.mjs test/presentation-conversation.test.mjs`：12 项通过，覆盖 waiting-only provider 入队但不能运行中 steer，以及相应呈现动作门禁。
- 宿主 `node --test test/subagent-workflow.test.mjs test/presentation-timeline.test.mjs test/presentation-conversation.test.mjs`：19 项通过，覆盖子 Agent 卡片原位更新、与普通工具分组隔离、过程历史不可用时的明确呈现，以及 goal 控件的 capability 门禁。
- 打包后的 Cursor Worker 使用独立假 ACP 可执行文件完成 Runtime 2.1 initialize、session open、流式文本和 turn completion。
- `plugin.json` 通过 Aibo Manifest v2 schema 校验。

隔离 Aibo 桌面探针：

- `pnpm run probe:cursor:desktop` 使用唯一 Tauri application identifier 和空临时工作区，不读取或覆盖日常 Aibo 数据。
- `pnpm run probe:cursor:desktop -- --contract-only` 在 `dd2a458` 上安装并启用 `0.1.6`、创建真实 Cursor 会话；公开 capabilities 包含宿主派生的 `queue.manage`，不包含 `queue.steer`。探针随后成功 close、disable、uninstall，且未调用模型服务。
- Aibo 成功安装、启用并发现 `dev.aibo.cursor.agent`，创建会话并把三轮固定只读提示路由到 Cursor；Timeline 收到 Cursor 返回的已完成错误消息。
- 三轮均由 Cursor 服务返回 `resource_exhausted`，因此本次探针无法继续断言期望文本、宿主持久化后的恢复、禁用与卸载。该失败发生在插件安装、ACP open 和消息路由之后；直接 ACP 的成功往返与跨进程 load 证据仍有效。
- 当前宿主会把未知第三方 provider 的 enforcement backend 设为 `Unnegotiated`，所以 Aibo 只会给 Cursor 分派受限的 ask/read-only profile。插件实现了 edit/审批合同，但在宿主增加可协商 enforcement 前不能从当前 Aibo UI 使用。

已验证的执行配置：Ask/Plan 只读组合，以及 Edit 配置的静态权限校验与假 ACP 审批闭环。真实 Edit 写入、完整桌面成功轮次、双皮肤交互、Applications 启动 PATH 和 UI 内取消/审批仍需桌面验收，因此 checklist 保持未勾选。

## 0.1.8 — 模型目录与选择（2026-09-17）

- 本机 Cursor CLI `2026.09.15-d2fe57e`，宿主 `188782b`。模型目录通过 ACP `configOptions` 协商，不硬编码模型或订阅权限。
- `node scripts/probe-cursor-models.mjs --prompt` 成功：返回 38 个选项；Auto reference 为 `default[]`；切换到另一目录项再切回 Auto，Auto 返回精确文本 `AIBO_AUTO_OK`；关闭 ACP 进程后通过 `session/load` 恢复，当前选项仍为 Auto。探针最终恢复原模型配置。此结果证明选中 Auto 后可执行，不声称能识别 Auto 内部实际路由的基础模型。
- `pnpm run probe:cursor:desktop -- --contract-only` 成功：隔离宿主安装并启用新包，公开 `model.select`；`get_session_models` 返回 38 项和 Auto，`invoke_agent_capability(model.select)` 的设置请求及返回值通过，随后关闭、禁用、卸载。未改动日常 Aibo 数据，也没有逐一使用付费模型。探针主动终止 Tauri 子进程可能打印 ELIFECYCLE；以 `CURSOR_DESKTOP_RESULT.ok` 和探针退出码为准。
- 首次隔离安装发现宿主 operation schema 不接受 `if/then`；已改为受支持的 `anyOf`，再次安装通过。
- 回归测试覆盖缺少模型配置时不宣告能力、Auto/付费项共存、实际下一轮路由、切换拒绝与确认不一致、旧恢复数据兼容、宿主 profile 优先级、配置更新与外来会话隔离、关闭后的迟到响应，以及付费模型在 prompt 时失败保留原始错误。
- 模型目录只表达后端选项，不承诺账户可调用；没有新增订阅套餐、锁定状态、推理强度或 Fast 能力。
- 新功能只适用于新 release 的会话。原有会话仍固定绑定旧插件版本；安装后需选择新版本创建会话。

## 2026-09-17 — Cursor 0.1.9 参数选择

环境：macOS arm64，Cursor CLI `2026.09.15-d2fe57e`，宿主源码 `b96a5d7`。
通过 `_meta.parameterizedModelPicker` 协商真实 `configOptions`，不读取账户私有缓存。

- GPT-5.5：None / Low / Medium / High / Extra High；上下文 272K / 1M。
- Claude Sonnet 4.6：Thinking Off/On 与 Effort Low/Medium/High/Max；上下文 200K / 1M。
- 两个模型均完成推理、长上下文设置与返回值确认，关闭 ACP 进程后 load 并重放成功。
- 恢复探针先发送 Auto 消息让 Cursor 保存会话；空会话直接 load 实测会返回 Session not found。
- 真实验收未向付费模型发送推理任务，也未证明可用订阅或窗口容量极限；确认的是后端配置及恢复。
- 单测覆盖模型隔离、原生名称/顺序、组合部分失败、拒绝与未确认、运行中拒绝、关闭后迟到响应。
- 打包 worker 经 Runtime 2.1 验证模型、推理、上下文操作路由和 recovery 字段。
- 目录参数只描述当前模型；切换模型后获取该模型参数。未对其他模型复制选项或从标签推算 tokens。

## 2026-09-17 — Cursor 0.1.10 原生命令菜单

环境：macOS arm64，Cursor CLI `2026.09.15-d2fe57e`，宿主源码 `b96a5d7`。

- 修复前四项针对命令目录、创建/恢复通知、等待清理及附加指令的测试失败；修复后通过。
- `node scripts/probe-cursor-commands.mjs` 实测读取 73 个命令，包含 copy-request-id
  与临时工作区 `.cursor/commands/aibo-menu-probe.md`。计数包含当前环境命令，不作为固定目录。
- 新会话发送 `/copy-request-id`，同时提供附加指令，返回原生 No request ID found 提示；
  不调用模型，也不向剪贴板写入已有 request ID。临时工作区已清理。
- 以宿主实际 loadSessionCommands / visibleSessionCommands / commandComposerInsertion 函数
  连接插件通知及 command.list，验证菜单非空、argumentHint 保留且插入 `/review `。
  这是函数级宿主兼容验收，不等同于桌面截图验收。
- `pnpm run verify`：45 项测试通过；打包后的 Runtime 2.1 worker 完成 command.list
  与原生命令回合发送，既有模型、推理、上下文 smoke 测试通过。
- 目录在恢复时由新 ACP 通知重新构建；恢复通知顺序与旧进程隔离已通过模拟传输测试。
  本轮没有另行执行真实持久会话恢复或带模型请求的自定义命令。

### 同日桌面菜单回归：宿主隐藏第三方菜单

用户安装 0.1.10 后仍看不到 `/`。只读核对最新会话确实绑定 0.1.10，协商了
command.list；实际调用记录为 completed。新增隔离桌面 contract 探针并行请求模型与
命令目录，宿主正常返回 72 个命令，排除了安装版本及目录路由问题。

根因在宿主 Composer：TimelinePanel 为第三方插件传入 selectedAgent=null，而
showSlashMenu 要求 selectedAgent 非空。此前函数级目录检查未覆盖这个组件显示条件。
宿主修复为按 selectedSession 判断；回归探针位于宿主
`probes/plugin-command-menu-browser.mjs`，使用实际 App → TimelinePanel → Composer，
修复前超时看不到命令，修复后 shadcn/material3 均能显示、选择及关闭菜单。
该修复需要更新宿主；Cursor 0.1.10 插件无需再次升版。


## 2026-09-18 — Cursor 0.1.11 通用能力协商

宿主源码：`7865fad`。本次使用假 ACP 与离线 SDK 构建验证，没有调用真实 Cursor 模型服务。

- 六个可选操作的版本、输入和输出 schema 与宿主 `session-features.v1.json` 逐字段一致，覆盖命令目录、模型选择、推理强度、上下文窗口、审批与用户输入。
- 模型和命令响应携带 `recovery` 与当前 `capabilities`；命令提供 `/name ` 形式的 `insertionText`。
- 打包后 Worker 的 Runtime 2.1 握手、开放能力声明、manifest 三者一致；冒烟测试还按 manifest 验证每次调用的真实输出，覆盖目录读取、模型及参数选择、恢复数据、原生命令和流式回合完成。
- 缺失模型或参数的 set 请求仍由 provider 拒绝；测试确认错误请求不会阻断后续合法选择。
- `pnpm run verify` 通过，生成可安装 Cursor 0.1.11 包。新版本需要重新安装并创建新会话；已有会话仍绑定原安装版本。
- Cursor 未实现 Core 工具代理或得到宿主原生执行授权，宿主权限模式仍为 Ask/read-only。未声明树、分支时间线、快照、fork、压缩或目标能力。


## 2026-09-27 — Cursor 0.1.18 宿主历史工具

基线：宿主 c8d91a6、host SDK 0.1.1；Cursor 插件 0.1.18；
CLI 2026.09.18-9a7762b、Node 24.18.0、macOS arm64。工作区为探针临时目录，
工具只返回合成历史，不修改用户 MCP 配置。运行命令：

```sh
pnpm run verify
cd ../aibo
node probes/host-tools-native.mjs cursor
```

真实 Ask 配置完成 MCP 发现、aibo_read_session 调用、结果进入模型答复；关闭 Worker 和
原生进程后，load 同一会话，再次调用及答复通过。实际发现发生在 prompt 阶段；
原生审批通知没有完整工具身份，但同 ID 的 tool_call_update 提供结构化
rawInput.providerIdentifier（server 名）、toolName 和 args。实现只按该结构化关联
放行私有宿主只读工具的 allow_once，其他请求保留原权限规则。

恢复保留公开 server 标识，以避免原生历史引用旧 MCP 名称；随机端口和私有凭证重新生成，
不写入 recovery。单测覆盖跨会话、伪造标题、不同 server、重复/迟到审批、永久许可拒绝；
打包 smoke 使用真实 MCP stdio 客户端检查目录、调用和恢复标识。

宿主 Rust 集成测试使用不同插件身份，覆盖数据库读取授权和 agent-managed 下 Core 文件工具拒绝。
该证据不等于完整桌面点击验收；本次未重做桌面 UI、其他平台、订阅模型矩阵或实际用户历史查询。
