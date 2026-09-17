# Cursor ACP 验证记录

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
