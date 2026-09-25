# Cursor ACP 接入实现规格

本文描述插件 **0.1.17** 的当前适配合同，以清单、Worker 和测试为实现依据。
真实 CLI、宿主和 UI 的历史证据见[验证记录](cursor-acp-validation.md)，未完成项见[验收清单](cursor-acp-checklist.md)。
文档整理不代表重新通过全部真机验收。

固定路径为 Aibo → Runtime 2.1 Worker → `agent acp`，不自动降级到 SDK、headless 或 Cloud API。
早期[能力调查](cursor-integration-research.md)保留背景，其 SDK 优先级建议不代表当前选型。
宿主兼容要求及构建流程见[开发指南](plugin-development.md)，用户可见能力见[插件说明](../plugins/cursor/README.md)。

## 1. 模块与协议边界

| 文件 | 职责 |
| --- | --- |
| `plugins/cursor/plugin.json` | provider、sessionControls、设置、操作 schema 与运行依赖 |
| `plugins/cursor/worker.mjs` | Runtime 2.1、invoke/control、可信调用上下文、响应封套 |
| `plugins/cursor/acp-transport.mjs` | 子进程、NDJSON、双向 RPC、背压、超时与释放 |
| `plugins/cursor/cursor-session.mjs` | 握手、模式、回合、事件、交互和 recovery |
| `plugins/cursor/model-config.mjs` | 原生模型参数归一化与不透明选择 ID |
| `plugins/cursor/image-input.mjs` | 宿主图片描述符校验和 ACP 内容块 |

插件 ID 为 `dev.aibo.cursor`，session contribution 为 `dev.aibo.cursor.agent`。
Manifest v2、Runtime 2.1、会话操作 1.0.0、settings v1、recovery v1、ACP protocolVersion 1 和插件 release 分别管理。
公开 SDK 为宿主提供的 `@aibo/capability-runtime` / `@aibo/plugin-protocol`；不导入宿主私有 helper。

每个会话运行时代际拥有独立 Cursor 子进程，prompt 串行执行。匹配绑定的活跃 Worker 可复用，
元数据读取不要求重复 new/load。ACP 通道与 Worker 的宿主通道分离，stdout 仅承载协议，日志写 stderr。

## 2. 宿主操作与能力

标准操作遵守目标宿主的[会话合同](../../aibo/contracts/session-capabilities.v1.json)，
可选操作遵守[功能合同](../../aibo/contracts/session-features.v1.json)和[协商规则](../../aibo/docs/session-capability-negotiation.md)。
精确 schema 以合同文件为准；清单、初始化三元组和路由保持一致。

| capability | 行为 |
| --- | --- |
| `aibo.session.open` | 创建或恢复，确认模式/配置，返回 nativeSessionId、recovery、capabilities |
| `aibo.session.turn` | Ask/Plan 只读回合 |
| `aibo.session.turn.write` | Agent 回合，额外验证 `workspace.write` |
| `aibo.session.cancel` | control 发起取消；accepted 不等于已经停止 |
| `aibo.session.close` | 释放进程，不删除 Cursor 历史 |
| `dev.aibo.cursor.approval.respond` | 响应当前 invocation 的权限或计划请求 |
| `dev.aibo.cursor.user-input.respond` | 响应当前 invocation 的问题 |
| `dev.aibo.cursor.command.list` | 返回 commands、recovery、capabilities |
| `dev.aibo.cursor.model.select` | 模型目录与选择 |
| `dev.aibo.cursor.model.reasoning` | 当前模型的推理选项与确认 |
| `dev.aibo.cursor.model.context-window` | 当前模型的上下文选项与确认 |

可选操作均按共享合同携带 recovery、capabilities 及专用字段；不能只返回原生目录。
会话身份来自 scope，工作区、权限、turnId 和 settings 来自可信 context；不信任 input 中的替代身份。
配置操作的 read effect 不授予工作区写权限。Control 校验所属 invocation，运行中拒绝模型配置。

基础语义能力为 session.create/resume/close、turn.send/cancel、stream.text、approval.respond、
user-input.respond、command.list。模型配置有效时增加 model.select；参数化配置有效时增加
model.reasoning/model.context-window。只有 ACP 宣告图片支持时增加 image.input。

宿主根据标准生命周期合同派生基础 queue.manage；本插件不声明原生队列操作或 queue.steer。
等待项、revision、暂停和 uncertain 处理遵循[宿主队列](../../aibo/docs/message-queue.md)。
不声明 service-tier、goal、fork、tree、timeline、snapshot、compaction；recovery 不等于远端线程快照。

## 3. ACP 启动与传输

本机须有 Node >=22 和已经 `agent login` 的 Cursor CLI。以参数数组、`shell:false` 启动 `agent acp`，
cwd 来自可信工作区。不读取 Desktop 内部数据库，不自动安装 CLI，也不把凭据写入 settings/recovery。
同名非 Cursor 可执行文件必须在真实启动验收中排除。

1. initialize 指定 protocolVersion 1，并要求相同响应版本。客户端 fs.readTextFile、fs.writeTextFile、
   terminal 均为 false；`_meta.parameterizedModelPicker: true` 请求 Cursor 参数化目录。
2. 检查 `cursor_login` 并 authenticate。客户端没有文件/terminal 工具不代表禁止 Cursor 的原生工具。
3. 创建调用 session/new；恢复按第 7 节选择 new/load。加载已有会话须协商 loadSession，
   `mcpServers: []` 不等于禁用用户/项目的本机 MCP 配置。
4. 选择并确认模式，读取模型配置并重放有效选择；失败释放进程，不发 prompt。

Open 的外层 timeout 为 120 秒，new/load 内部 90 秒；turn 为 12 小时，cancel/close 为 15 秒。
不能因冷启动较慢或暂时无文本就认为失败。同会话第二个 prompt 拒绝 busy，cancel/control 不等待 prompt 结束。

传输增量解码 UTF-8，支持半行、多行、CRLF、ID 0 和带类型的数字/字符串 ID。
未知 request 返回 Method not found，未知 notification 不触发执行；畸形 JSON、超限、EOF、stdin error
与 deadline 结束 pending 请求并释放资源。处理写背压和有界队列；入站单帧 8 MiB、出站 prompt 32 MiB，
stderr 保留有界尾部，pending interaction 上限 32。退出释放 timer、listener、waiter 和子进程。

## 4. 原生模式与权限归属

`sessionControls` 和 `executionPolicy: "agent-managed"` 要求宿主支持相应合同（migration 0047）。
完整 profile 由 `validateExecutionProfile` 检查，不再采用早期计划中的进程沙箱或猜测网络工具文本方案。

| 原生模式 / Aibo interactionMode | filesystemPolicy | commandPolicy | networkPolicy | approvalPolicy / reviewer |
| --- | --- | --- | --- | --- |
| Agent / edit | agent-managed | agent-managed | agent-managed | on-request / user |
| Ask / ask | read-only | disabled | agent-managed | never / none |
| Plan / plan | read-only | disabled | agent-managed | never / none |

模式使用原生返回的选项并确认切换。其他组合和 auto-review 明确拒绝。
打开 Agent 只需 workspace.read；发送 Agent 回合须走写操作并具有 workspace.write，Worker 和会话层都检查。
Ask/Plan 只接受只读轮次，并拒绝原生工具权限请求。

Cursor 自行管理文件、命令、网络、MCP 和用户/项目权限规则；Aibo 仅转发实际产生的审批。
这不是 OS 沙箱、工作区写隔离或网络阻断，也不授予 Core 工具权限。
已由 Cursor 规则放行的操作可能没有 Aibo 审批。接受计划不提升模式或写授权。

## 5. 事件与交互

外壳遵守[session-event schema](../../aibo/contracts/session-event.v1.schema.json)，
投影须同时通过宿主消费端测试。普通回合使用宿主 turnId；子 Agent 事件级 turnId 为 null，
payload.rootTurnId 指向真实宿主父回合。

| 原生输入 | 映射 |
| --- | --- |
| prompt 开始 | 唯一 turn.started |
| agent_message_chunk | message.delta，结束时 message.completed |
| agent_thought_chunk | reasoning.updated / completed，不合成缺失内容 |
| tool_call / update | 稳定 toolCallId 合并 started/updated/completed，保留未更新字段 |
| task 工具及 cursor/task | subagent.updated，不重复普通工具卡，不伪造 subagent.message |
| permission request | approval.requested / resolved |
| ask_question / create_plan | 阻塞式 user_input / approval |
| plan、todos、生成图片通知 | 命名空间内 extension.updated，不额外启动执行或任意读取文件 |
| usage | 区分上下文占用和累计用量；缺失保持未知 |
| prompt response | 结算消息和唯一回合终态 |

end_turn/refusal 为 completed；cancelled/max_tokens/max_turn_requests 为 interrupted；未知 stopReason 或 RPC 错误为 failed。
保留拒绝和限制原因。消息片段使用稳定 ID，重复工具终态、迟到进程回调不能污染后续回合或让 stopped 回到 ready。
Cursor task 只有完成级元数据，缺少过程时明确降级；缺尾任务按父回合结果收敛。
公共子任务合同见[子 Agent 历史](../../aibo/docs/subagent-history.md)。

交互保存 native session、当前 turn、原始带类型的 JSON-RPC ID、请求类型和 options。
Runtime control 还绑定原 invocation。跨会话、过期、重复或伪造响应明确拒绝。

- 权限 accept/cancel 根据 option.kind 找 allow_once/reject_once，回传真实 optionId；
  不升级为 allow_always，无匹配选项时取消，轮次取消也回传 cancelled。
- ask_question 为问题和选项建立可逆 ID 映射，验证单选/多选；不能把任意自由文本冒充选项。
- create_plan 先提供完整计划及关联审批，accept/cancel 转 accepted/rejected，轮次取消转 cancelled；
  不虚构文件或 planUri，计划接受不改变执行授权。
- 通知不返回 RPC。多选、完整计划和取消必须补充真实桌面交互验证。

## 6. 模型、命令、设置与图片

公共模型目录、确认和呈现行为见[模型配置](../../aibo/docs/model-configuration.md)。
Cursor 优先使用参数化 picker；旧 CLI 的变体 selector 保留模型选择。
当前模型之外不复制参数；Auto 可能无选项，目录可见不证明套餐可用或 Auto 的内部路由。

推理优先识别 thought_level，并兼容实现列出的 reasoning/effort/thinking 参数 ID；
多个推理维度组合为模型内不透明 ID。上下文只取 model_config 的 context/context_window/context_size，
不从标签猜 token 数，也不将 Fast 当上下文。模型和参数设置都要求 idle、原生确认及更新后的 recovery；
组合部分成功时保留已确认状态和错误。参数化扩展的已核对 CLI 为 `2026.09.15-d2fe57e`，不是 core ACP 保证。

命令来源是 available_commands_update。创建期间暂存早到通知，确认 nativeSessionId 后才采纳；
首次读取最多等待 10 秒，空数组是有效快照，后续整表替换。关闭释放等待，恢复重新获取目录，
不在 recovery 中保存旧命令。返回 name、description、argumentHint、insertionText 等合同字段。
描述后缀 `(builtin skill)` / `(project skill)` / `(user skill)` 按 CLI `2026.09.18-9a7762b`
的来源标记分类为 skill；未知格式保留 agent 分类与原说明，不根据名字猜测。
Slash 输入及参数原样走普通回合，不前置附加指令；不另设绕过权限的 command.execute。

Settings v1 仅 additionalInstructions：multiline，默认空字符串，上限 8000，支持 application/workspace/session。
每次 turn 校验 context.settings schema/version 并读取快照，只对普通消息前置，不改宿主持久化的原消息。
继承、有效空值、保存和版本隔离遵循[设置合同](../../aibo/docs/agent-plugin-settings.md)。

image.input 仅在 initialize 返回 promptCapabilities.image === true 时声明。
宿主图片描述符转为 `{type:"image", mimeType, data}`；文本附件引用仍保留，不能用路径文字代替图像字节。
只接受 PNG/JPEG/GIF/WebP，最多 8 张、单张 10 MiB、合计 20 MiB；在 native prompt 前检查
描述符、文件、符号链接、实际内容和读取中变化，关闭文件句柄。CLI 支持图片不等于所有模型都有视觉能力。

## 7. 取消与恢复

取消和宿主 abort 汇入同一逻辑：标记 cancelling，结算 pending 交互，通知 session/cancel，
等待 prompt 结束；默认宽限 5 秒后关闭子进程，关闭宽限 2 秒后强杀。
取消 accepted 只表示接收；最终回合以唯一 interrupted 结束。执行结果未知时不自动重发。
Close 和 Worker stdin EOF 同样清理进程，不删除原生历史。

Recovery 使用 `{schema:"dev.aibo.cursor.recovery",version:1,data}`；data 保存 nativeSessionId、
workspaceId/workspacePath、protocolVersion、modeId、hasPrompt，以及可选 modelId/reasoningEffort/contextWindow。
校验版本、非空原生 ID 及工作区绑定，不保存凭据、PID、pending、完整聊天或伪造流 offset。

- 只有明确 `hasPrompt: false` 的空会话恢复可调用 new，因为 Cursor 尚未持久化它。
- 发送 prompt 前设置 hasPrompt 为 true；已经发送或旧 recovery 缺少该字段时必须 load 原 nativeSessionId。
  不支持 load、会话缺失或恢复失败明确报错，不能悄悄 new。
- 恢复先确认宿主指定模式和模型，再重放相应推理、上下文选择。显式 profile 模型优先于 recovery，
  更换模型丢弃旧模型参数；不恢复旧命令目录。
- Load 的历史回放不生成当前回合消息、旧审批或工具执行。Open、回合和配置操作返回新的 recovery，
  宿主负责持久化和固定 release/contribution 绑定。

不导入 Cursor Desktop 历史；崩溃遗漏的尾部不承诺补齐。恢复验证必须关闭旧进程，
并分别覆盖空会话重建与有历史会话 load，不能只比较内存快照。

## 8. 验证入口与交付

本仓库 `pnpm run verify` 运行 Cursor 单测及打包 Worker 的假 ACP smoke，包括清单合同与响应 schema；
原生 CLI 和桌面探针命令见插件说明。测试源码位于 `test/cursor-*.test.mjs`，产物检查在 `scripts/smoke-cursor.mjs`。
实现/构建变更需运行 verify，宿主改动另按宿主回归矩阵验证。纯文档整理不要求重跑付费模型或登录流程。

诊断区分依赖、认证、协议、profile、恢复、busy、陈旧交互、超限和崩溃；记录脱敏阶段、版本及结果。
真实证据记录插件/CLI/Node/宿主版本、OS/架构、profile、命令及未覆盖项。
安装成功、原生回合成功、合同探针通过与完整 UI 验收是不同结论，不能互相替代。
