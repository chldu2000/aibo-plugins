# Cursor ACP 接入实现规格

状态：`0.1.7` 已实现；ACP 真机创建、文本轮次和跨进程恢复已验证；已对齐 Aibo `dd2a458` 的宿主持久队列和子 Agent 事件合同。Aibo 隔离桌面已验证安装、发现、会话创建与消息路由，回复受 Cursor 服务 `resource_exhausted` 阻断。决策日期：2026-09-17。

本项目采用 **Cursor CLI ACP** 作为本地 Cursor 会话的唯一首版后端：Aibo → Runtime 2.1 能力 Worker → `agent acp`。此前[能力调查](cursor-integration-research.md)用于背景比较；其中 SDK 优先级建议不再代表本项目选型。执行任务见[实现与验收 checklist](cursor-acp-checklist.md)。

## 1. 基线、目标与范围

已读取本仓库最新[插件开发文档](plugin-development.md)，并对照相邻 `../aibo` 的 HEAD `dd2a458`。实现时如宿主前进，应重新核对合同。协议版本分别为 Manifest v2、Runtime 2.1、会话能力 1.0.0；它们与插件 release、settings.version、ACP protocolVersion 分别管理。

目标：安装独立能力插件后，新建会话轮盘出现 Cursor；用户能在工作区持续对话、查看流式输出和工具活动、回答问题、审批操作、取消执行，并在 Aibo 重启后恢复同一 Cursor 会话。

首版包含：文本、多轮、创建/恢复/关闭、ask/plan/edit 映射、工具事件、完成级 Cursor 子 Agent 任务卡、审批与提问、附加指令、错误诊断。发布平台限定已验证的 macOS arm64；未测架构不填入 manifest。先使用 CLI 当前默认模型；模型目录/切换只有协商和完整宿主路由验证后才启用。

不包含：SDK Bridge、headless 降级、Cloud API、桌面 Cursor UI 控制、历史会话导入、fork、目标管理、推理强度、Fast、Aibo 工具到 MCP 的自动桥接。附件首版明确拒绝非空输入，不静默丢弃；后续按 ACP 实际协商能力扩展。

## 2. 包结构与职责

当前实现文件：

```text
plugins/cursor/
  plugin.json
  package.json
  worker.mjs             # Runtime 入口、invoke/control、调用身份检查
  acp-transport.mjs      # 子进程、NDJSON、双向 RPC、资源释放
  cursor-session.mjs     # 握手、会话状态机、策略、事件、交互与恢复
```

测试放在仓库根目录的 `test/cursor-*.test.mjs`。

以 `@aibo/capability-runtime` 和 `@aibo/plugin-protocol` 作为宿主合同来源，沿用本仓库本地 SDK 打包流程。内置 `session-provider.mjs`、Codex engine 仅是行为参考，不能在发布产物中 import `../aibo` 的私有 helper。Worker 显式启用 Runtime 2.1；不得沿用默认 2.0。

每个 Aibo 会话运行时代际拥有一个 Cursor 子进程，进程内串行执行 prompt；不同会话相互隔离。同一绑定的活跃 Worker 可被宿主复用；元数据读取不要求重启或重新 open。ACP 的 stdin/stdout 与 Worker 的宿主协议通道完全分离；日志只写 stderr。

建议命名：pluginId `dev.aibo.cursor`，contribution ID `dev.aibo.cursor.agent`，displayName `Cursor`，初始版本 `0.1.0`。声明 Node >=22 和 `agent` 为必需可执行依赖。`agent` 名称可能碰撞：启动探针必须确认它支持 Cursor ACP；不能因同名命令存在就视为就绪。首版不在 settings 中开放任意启动命令。

contribution 必须是 session scope 的 capabilityProvider，并声明 `aibo.session.open`。可省略 icon 使用宿主默认；若添加，使用合规的 24×24 SVG path，放在 contribution 上。复用宿主呈现，无需修改本项目 presentation 插件。

## 3. Aibo 能力合同

标准能力的输入输出以宿主 `contracts/session-capabilities.v1.json` 为准，禁止凭表格另造不兼容 schema。操作 ID 用 `dev.aibo.cursor.*`，标准 capability ID 保持不变。

| capability | 实现行为 | effect / permissions |
| --- | --- | --- |
| `aibo.session.open` | create 调 new；resume 调 load；返回 nativeSessionId、recovery、capabilities | read / workspace.read |
| `aibo.session.turn` | 受已验证只读策略约束的 prompt；返回 status、recovery | read / workspace.read |
| `aibo.session.turn.write` | 验证宿主授予写权限后执行 prompt | write / workspace.read、workspace.write |
| `aibo.session.cancel` | 执行中 control；发取消通知，accepted 不代表已停止 | read / workspace.read |
| `aibo.session.close` | 释放本会话进程，不删除 Cursor 历史 | read / workspace.read |
| `dev.aibo.cursor.approval.respond` | `{requestId, decision: accept\|cancel}` → 当前权限或计划请求 | read / workspace.read；只对所属活跃 invocation 有效 |
| `dev.aibo.cursor.user-input.respond` | `{requestId, answers}` → 当前问题请求 | read / workspace.read；只对所属活跃 invocation 有效 |

后两项沿用宿主对应交互合同，输出 `{resolved:true,recovery,capabilities}`，且需验证宿主的 `approval.respond` / `user-input.respond` 能解析到本 provider 的 operation。不能只添加 capability 标签，或复制 Codex 的 `ext.dev.aibo.codex.*` 路由。

首版报告的会话语义能力：`session.create`、`session.close`、`turn.send`、`turn.cancel`、`stream.text`、`approval.respond`、`user-input.respond`；`session.resume` 需 initialize 的 loadSession 支持并通过恢复验收。可安装版本必须通过恢复门槛。0.1.8 起，当 ACP 返回有效模型配置时额外报告 `model.select`；不宣告没有实现的 reasoning/service-tier/fork 等能力。

### 3.1 宿主持久队列

Aibo `dd2a458` 起依据固定 release 的标准合同派生 `queue.manage`。本插件的 Runtime 固定为 2.1，且 `aibo.session.open`、`aibo.session.turn`、`aibo.session.cancel`、`aibo.session.close` 的 schema、effect 与 permissions 和 `contracts/session-capabilities.v1.json` 完全一致，因此无需实现或报告原生队列能力即可使用宿主持久 FIFO 队列。等待项身份、附件归属、revision、暂停/恢复和 uncertain 处理均由宿主负责；插件仍只接收宿主经正常准入派发的普通 turn。

本版本不支持运行中原生 steering。`CAPABILITIES` 不包含 `queue.manage` 或 `queue.steer`，manifest 也不声明 `dev.aibo.cursor.queue.manage` 操作。运行中的 follow-up 等当前回合完全结算后再发送；空闲 send-now 仍由宿主发起普通 turn。不得仅添加能力字符串或空操作来开启 `queue.steer`，因为 ACP 尚无已验证的“已接收/明确未接收”确认语义。

目标能力保持未宣告：Cursor ACP 没有满足 Aibo goal get/set/pause/resume 的原生状态机，不把普通 plan/todo 伪装为 `goal.updated`。Cursor CLI 的结构化 task tool 则映射为 `subagent.updated`：以 toolCallId 作为稳定任务 ID，native session 作为直接父级，宿主 turnId 作为 rootTurnId，并按 running/waiting/completed/failed/interrupted/unavailable 收敛。ACP 只在 task 完成后提供摘要、agentId 和耗时，不提供过程 entry 或可重读子线程历史，因此不发送 `subagent.message`；宿主详情明确显示无过程记录。

会话身份取自 invocation.scope；工作区 ID、绝对路径、权限、turnId、settings 取自可信 context。拒绝 input 伪造身份、跨会话操作和已有绑定的工作区替换。写轮次需独立验证 `workspace.write`，不能仅凭 Cursor mode 判断已获授权。

close/cancel operation timeout 为 15 秒、turn 为 12 小时、交互响应为 120 秒。真实冷启动可能超过 14 秒，因此 open 总时限为 120 秒，ACP new/load 内部时限为 90 秒。长轮次不因暂时没有文本而误判失败。

## 4. ACP 启动与状态机

Cursor 官方公开 `agent acp`，传输是 stdio 上逐行 JSON-RPC 2.0；认证方法为 `cursor_login`，支持预先 CLI 登录。依据：[Cursor ACP](https://cursor.com/docs/cli/acp)。

首版使用用户在终端完成的 `agent login`，不读取 Cursor Desktop 内部数据库、不自动安装 CLI。认证失败给出可操作诊断并终止 open，不反复弹登录或创建会话。API key/token 注入留待宿主安全凭据通道明确后实现；不得放入 settings、recovery、manifest 或启动参数日志。

启动流程：

1. 从宿主传入的可执行搜索环境解析 `agent`，以参数数组及 `shell:false` 启动，cwd 为可信工作区；不拼接 shell 命令，不默认添加 force 或禁用 TLS 参数。
2. `initialize` 使用首版支持的 protocolVersion 1，clientInfo 带插件版本。只接受受支持的返回版本；保存 agentInfo 和协商能力供诊断。
3. 客户端 fs.readTextFile、fs.writeTextFile、terminal 初始均为 false。这意味着不提供客户端工具，**不意味着禁止 Cursor 自己访问文件或 shell**。
4. 检查认证方法并执行 `authenticate`。必要环境项按受控 allowlist 传入，验证 GUI 环境下 CLI 登录态可用，不假定继承完整 shell 环境。
5. create 使用 `session/new {cwd,mcpServers:[]}`；resume 验证 loadSession 后使用 `session/load {sessionId,cwd,mcpServers:[]}`。保留本机 Cursor 配置可能仍加载 MCP 的事实，不能把空数组当作禁用所有 MCP。
6. 建立执行策略，选择并确认会话模式；失败则释放进程且不发 prompt。生成 recovery 返回宿主。

ACP 的 load 能力必须协商；加载期间会回放历史，响应 load 后才能发送新 prompt。首版采用 load，不假定 Cursor 支持 ACP 新增的 resume/close 方法。依据：[ACP Session Setup](https://agentclientprotocol.com/protocol/v1/session-setup)。

状态转换：`stopped → starting → initializing → authenticating → opening/loading → ready → prompting → ready`；prompting 中可有多个 pending interaction，取消进入 cancelling；任意状态可进入 failed 或 closing，最终释放为 stopped。同会话第二个 prompt 拒绝为 busy，交互 control 和 cancel 必须能在 prompt 未完成时执行，不能排在它后面。

传输要求：按 UTF-8 流增量解码、处理半行/多行/CRLF；按字段存在性识别 id（支持 0），保留数字/字符串 ID 类型，不混淆双向请求。未知 request 返回 JSON-RPC Method not found；未知通知忽略并记有界诊断。畸形消息、超限、EOF、stdin 错误必须清理所有 pending promise，不能永久等待。

建议首版限制：单帧 8 MiB、待响应交互 32 项、stderr 环形缓冲 64 KiB。超过上限使当前调用明确失败并关闭进程。写入处理背压；退出等待、timer、listener 和子进程均有归属。日志脱敏，默认不保存完整 prompt、文件内容或环境。

## 5. 模式与执行策略：发布门槛

目标映射为 Aibo ask → Cursor ask、plan → plan、edit → agent；必须使用会话实际返回的 mode ID 并确认设置成功，不能只靠 prompt 指令。ACP 当前文档同时存在专用 mode 方法和 config options 演进路径，首版按固定 CLI 版本的实际返回选择一种经过验证的机制。依据：[ACP Session Modes](https://agentclientprotocol.com/protocol/v1/session-modes)。

**模式不是沙箱；审批回调也不是完整的操作拦截器。** 本规格不声称 ACP 已提供与 Aibo filesystemPolicy、commandPolicy、networkPolicy 等价的强制隔离。

实现 `execution-policy.ts` 的显式支持矩阵，按完整 executionProfile 判定。首个开发阶段需在临时工作区证明：只读不能修改文件；限制命令/网络时实际受到对应限制；项目和用户 Cursor 权限配置及 MCP 不会绕过声明的边界。必要时使用可验证的 Cursor 配置或受支持的进程沙箱；不能通过隐藏更强权限启动来“兼容”。无法落实的 profile 在 open 时拒绝，返回不支持原因，不静默降级。若宿主无法对该 provider 隐藏不支持配置，应单独列出宿主最小改动。

| approvalReviewer | 首版处理 |
| --- | --- |
| user | 需审核的请求交给宿主交互，按具体结果回传 |
| auto-review | 仅当存在可调用、可验证的宿主审核链路才支持；不得当作自动允许或改成 user；首版默认拒绝此 profile |
| none | 不发人工审批；仅在已验证执行授权能精确覆盖请求时按策略处理，否则拒绝请求；未完成策略证明前拒绝此 profile |

顶层写轮次已有执行授权时不另加一次泛化确认；Cursor 的具体工具权限请求仍需处理。计划接受不等于允许越过原有只读/网络边界，若后端试图切换到更高权限模式，拒绝并中止，不因计划获批扩权。

## 6. 事件与交互映射

事件外壳严格遵循 `session-event.v1.schema.json`，只使用已有 type、correlation 字段；nativeSessionId 用 Cursor sessionId，turnId 用 Aibo context.turnId。payload 还需通过宿主实际 reducer/展示测试，不能因其 schema 是 object 就随意填字段。

| ACP 输入/本地状态 | Aibo 输出或动作 |
| --- | --- |
| 开始发送 prompt | `turn.started`，当前轮次只发一次 |
| agent_message_chunk | `message.delta`；聚合后在结束时 `message.completed` |
| agent_thought_chunk（如返回） | `reasoning.updated` / `reasoning.completed`；无数据不伪造 |
| 普通 tool_call / tool_call_update | 以 toolCallId 合并 `tool.started`、`tool.updated`、`tool.completed`；更新未包含字段保留旧值 |
| `_toolName: task` 与 `cursor/task` | 以 toolCallId 合并 `subagent.updated`，事件 turnId 为 null、rootTurnId 为当前宿主 turn；不再重复普通工具卡 |
| permission request | `approval.requested`；匹配 control 后 `approval.resolved` |
| Cursor 问题 / 计划请求 | 分别进入 user_input / approval 交互；不能仅渲染文本 |
| plan、todos、图片通知 | `extension.updated`，使用插件命名空间；展示降级不能卡住轮次 |
| 模式/元信息变化 | `session.info_changed`，重新校验执行边界 |
| usage（仅实际返回时） | `usage.updated`，映射当前上下文和累计用量到不同字段 |
| prompt 最终 response | 完成消息聚合并发唯一轮次终态，返回 SessionTurnOutput |
| 进程意外退出 | `adapter.crashed` 及当前 invocation 失败；不能再报 completed |

`session/prompt` 是长请求，通知不是终态。stopReason 映射决策：end_turn → completed；cancelled → interrupted；max_tokens/max_turn_requests → interrupted 并说明限制；refusal → completed 且保留拒绝原因；RPC error/未知 stopReason → failed。这些是本适配器约定，需验证宿主显示。依据：[ACP Prompt Turn](https://agentclientprotocol.com/protocol/v1/prompt-turn)。

若 ACP 不提供消息 ID，生成轮次内稳定 itemId；不同文本消息/工具间切换要形成明确片段边界，避免全文重复追加。usage 缺失显示未知；严禁把累计 totalTokens 当 contextTokens。未知扩展不能伪造为成功工具或触发真实操作。

### 6.1 工具审批

pending key 包含运行时代际、会话、invocation、请求 ID；保存原始 RPC ID、toolCallId、options 和交互类型。依据 option.kind 选择，再原样返回其 optionId，不硬编码 `allow-once` 字符串。首版 accept 仅映射 allow_once；拒绝映射 reject_once，无匹配安全选项时取消/报不支持；不提供 allow_always。轮次取消时返回 ACP cancelled。依据：[ACP Tool Calls](https://agentclientprotocol.com/protocol/v1/tool-calls)。

呈现前把请求详情转换为宿主可见的 command/cwd/说明，availableDecisions 为 accept/cancel；未知工具详情不得默认通过。control 校验绑定、请求类型、当前轮次及仍待处理状态，返回后移除 pending；重复/过期响应明确拒绝。控制应答完成后才能结算对应 invocation，防止最后一条响应被终态抢先关闭。

### 6.2 Cursor 扩展

Cursor 文档定义 ask_question、create_plan 为阻塞请求，update_todos、task、generate_image 为通知。客户端必须区分 envelope，通知不回 RPC。依据：[Cursor ACP 扩展](https://cursor.com/docs/cli/acp#cursor-extension-methods)。

- ask_question：转换为 `user_input.requested`；建立 question ID、option ID 与宿主字段的可逆映射。校验选择属于该问题、单选/多选约束；回传 answered/answers。宿主不能表达的自由文本不得冒充 option ID；不支持的交互明确 skipped 或取消并说明。
- create_plan：完整计划作为可阅读内容先呈现，再发带同一请求关联的审批；accept/cancel 转为 accepted/rejected，轮次取消转 cancelled。不虚构 planUri 或写入计划文件。
- update_todos 和 generate_image 只更新扩展展示，图片通知不自动读取任意本地路径。task 是 Cursor 已执行的原生子 Agent 摘要，映射为 Aibo `subagent.updated`，不代表让 Aibo 再启动任务；缺失完成通知时按父回合结果收敛为 unavailable/interrupted/failed。
- Cursor ACP 未暴露子 Agent 消息流或历史读取，因此不得合成 `subagent.message`。未来只有获得稳定 entry ID、完整快照和重启读取路径后才能增加过程历史。
- 通过宿主双皮肤验收确认多选和完整计划展示；若缺少必要字段/动作，列出最小宿主合同变更后才能宣告完整支持。

## 7. 取消、恢复与持久化

取消走 Runtime 2.1 control 和调用 signal 两条入口，汇入同一逻辑：标记 cancelling → 处理 pending 交互的取消应答 → 发 `session/cancel` 通知 → 等待 prompt 结束。建议宽限 5 秒，随后终止本会话子进程；再等 2 秒仍未退出则强制终止，记录执行结果可能未知。cancel 的 accepted 仅代表接收请求。晚到更新不能写入下一轮；终态只结算一次。关闭和 Worker stdin EOF 同样回收进程；不删除原生会话记录。

recovery 是插件私有、版本化 JSON 对象，建议字段：

| 字段 | 目的 |
| --- | --- |
| schema = `dev.aibo.cursor.recovery`、version = 1 | 符合宿主 `{schema,version,data}` 外壳并拒绝未知格式 |
| data.nativeSessionId | 唯一 Cursor sessionId |
| data.workspaceId、data.workspacePath | 与可信 context 核对，拒绝换工作区恢复 |
| data.protocolVersion | 兼容诊断；不代替重启后握手 |
| data.modeId | 重连后重新协商并验证选择 |

不要保存进程 PID、RPC pending、凭据、完整聊天或“流 offset”。ACP 本路径未承诺可重连的事件 offset。宿主负责 release/contribution 固定绑定，recovery 不选择另一个安装版本。

open 和每次完成轮次/配置变化返回最新 recovery；使用宿主合同允许的持久化出口，不只存在内存。`session/load` 的历史通知放入独立 replay 阶段，不追加成当前 Aibo 对话、不触发旧工具执行或旧审批。首版恢复已有 Aibo 会话，不做历史导入；崩溃导致未收到的尾部事件不声称已完整找回，应提示上轮结果可能不完整。

load 失败、sessionId 不存在、登录账号变化或状态不兼容时，保持旧 Aibo 记录并明确失败；不自动 new 后冒充恢复。崩溃前发送过的 prompt 或工具写入绝不自动重放，避免重复改文件和计费。

## 8. 设置、模型和 MCP

仅声明 settings v1 的 additionalInstructions：multiline、默认空字符串、maxLength 8000，scopes 为 application/workspace/session。在每次调用校验 context.settings 的 schema/version，读取有效值快照并前置到发送文本，不改宿主持久化的用户消息。正在执行及其 control 保持原快照。版本隔离、空字符串覆盖、继承和冲突语义沿用宿主。

0.1.8 通过 ACP `configOptions` 读取真实模型目录与当前选择，通过 `session/set_config_option` 设置模型并校验确认结果；模型 reference 为不透明值，Auto 不固定为 `auto`。选择保存在 recovery 的可选 `modelId` 中，加载后重放，显式 execution profile model 优先。旧 recovery 无 modelId 时沿用 ACP 当前值。运行中拒绝模型操作，关闭后的迟到响应不能修改新会话状态。目录不代表订阅权限：保留付费模型并透传实际执行时的错误。reasoningEffort 仍明确拒绝；不根据 Cursor 名称推测 Fast。

Cursor 可读取本机项目/用户 MCP 配置；支持范围与授权绕过风险须纳入执行策略探针。首版不把 Aibo Broker 自动暴露为 MCP，也不宣称现有 MCP 都受到 Aibo 工具级审计。若需要客户端 fs/terminal 或 Aibo 工具桥接，应另做版本：通过 `workspace.requested` / `aibo.session.tool.respond` 等宿主支持路径实施权限检查后，才宣告客户端能力。

## 9. 构建、诊断与交付

扩展 `scripts/build.mjs` 为 Cursor 生成独立可安装目录并保留现有两包输出。离线打包 Aibo SDK、编译 Worker、捆绑运行依赖，校验 Manifest 和运行入口；产物不能依赖相邻宿主源码、开发机绝对路径或公网 SDK 安装。三个版本字段保持一致，升级递增 release；不覆盖同 ID/版本但内容不同的已安装产物。

诊断至少区分：CLI 缺失/同名非 Cursor、认证失败、协议不兼容、profile 不支持、会话恢复失败、busy、陈旧交互响应、消息超限、进程崩溃。错误记录阶段、版本、退出码及脱敏摘要；结果不确定时说明可能已发生文件变更，不能自动重试。

默认尽量只改本仓库；以下属于必须验证而非已确认可用的宿主接缝：第三方审批/问题 capability 路由、计划/多选呈现、profile 可用性、取消 control 和恢复持久化。若遇到硬编码 Codex/Pi，应提交最小通用宿主修正，并运行宿主所需测试；不将该限制藏进插件。

## 10. 权威本地参考与证据要求

除本仓库开发指南外，以下路径相对 `../aibo`（本次均以 `dd2a458` 为基线）：

- `docs/plugin-development_zh.md`、`contracts/plugin-manifest.v2.schema.json`。
- `contracts/session-capabilities.v1.json`、`contracts/session-event.v1.schema.json`、`contracts/session-binding.v2.schema.json`、`contracts/execution-profile.v1.schema.json`。
- `packages/plugin-protocol/src/session.ts`、`packages/capability-runtime/`。
- `src-tauri/capability-plugins/session-provider.mjs`、`src-tauri/capability-plugins/codex/{plugin.json,worker.mjs,engine.mjs}`：行为参考，不是可导入的公共 SDK。
- `src-tauri/src/session_host.rs`、`session_tools.rs`、`session_host_tests.rs`：路由、交互和固定绑定。
- `docs/message-queue.md`、`src-tauri/src/session_contract.rs`、`session_queue.rs`：标准生命周期派生队列、原生 steering 协商及 uncertain 边界。

外部链接核对日期 2026-09-16。ACP 通用协议有某字段不代表当前 Cursor CLI 已实现。发布证据必须记录 CLI 精确版本、宿主提交、OS/架构、脱敏协商结果与真机结果；本规格没有运行登录、模型请求或修改用户工作区的探针。
