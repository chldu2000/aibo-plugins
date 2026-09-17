# Cursor ACP 实现与验收 checklist

对应[实现规格](cursor-acp-spec.md)。所有未勾选项均表示待做；文档核对不等于实现或真机验证。阶段按 P0 → P1 → P2 → P3 → P4 执行，P0 决定可支持的执行配置。

## P0 — 锁定合同与可行性

- [x] 采用 ACP 主路径，排除 SDK/headless 自动降级。
- [x] 核对本仓库插件文档及 Aibo `dd2a458` 的会话、事件、设置、交互、目标、子 Agent 与持久队列参考实现。
- [x] 查阅 Cursor 官方 ACP 和 ACP 协议文档，标注协议能力与具体 CLI 支持的区别。
- [x] 在临时工作区记录 Node、Cursor CLI 精确版本、宿主提交、OS/架构；确认真实 `agent acp`。
- [x] 保存脱敏 initialize/new/load 响应：协议版本、authMethods、loadSession、模式和可选模型能力。
- [ ] 验证 `agent login` 后从 Applications 启动 Aibo 可使用登录态和 PATH；未登录时可诊断、不挂起。
- [ ] 建立 executionProfile 支持矩阵并执行文件写入、目录越界、命令、网络和 MCP 探针；不支持组合在 open 拒绝。
- [ ] 证明 user 审核路由可用；auto-review/none 未实现时明确拒绝，不自动改语义。
- [ ] 验证第三方 approval/user-input 路由、单选/多选、完整计划展示及 control 能力；记录必要宿主改动。

完成条件：至少一组明确的受支持配置可完成真实 ACP 往返，权限边界有证据；不以“能输出文字”代替可行性证明。

## P1 — 独立插件及双向传输

- [x] 新建 `plugins/cursor/`，使用公开 SDK 和 Runtime 2.1；无宿主私有路径 import。
- [x] Manifest 声明 session provider、标准 open/turn/write/cancel/close 与插件交互操作；ID、版本、schema、effect、权限一致。
- [ ] Node/agent 依赖检查、GUI 路径发现、同名非 Cursor 命令错误可诊断。
- [x] 增加 Cursor 独立构建输出，SDK 离线安装及产物依赖完整，现有两个示例包继续构建。
- [x] transport 测试覆盖拆分 UTF-8、半行、多行、CRLF、ID 0、字符串/数字 ID、双向请求和背压。
- [x] 覆盖畸形 JSON、未知 request/notification、超大帧、stderr 有界保留、EOF、stdin error、退出和 deadline；所有 pending 都结束。
- [x] Worker stdout 无日志、无透传的原始 ACP 消息；日志和产物无凭据。

完成条件：假 ACP 子进程可驱动真实 Worker 的握手、流式事件和执行中 control；构建产物脱离源码目录可启动宿主握手。

## P2 — 会话、权限和交互闭环

- [ ] 实现可信 scope/context 检查及状态机；第二个 prompt 返回 busy，不阻塞 cancel/control。
- [ ] create、模式设置、两轮对话、close 正常；缺失能力和不支持 profile 在 prompt 前失败。
- [ ] 只读/可写轮次分别验证，缺失 workspace.write 时无任何 prompt 写入请求。
- [ ] 映射消息、工具增量合并、稳定关联 ID、usage 缺失与上下文用量；事件通过宿主 schema 和实际投影测试。
- [ ] 所有 stopReason、RPC error、崩溃都有唯一终态；不发生重复 completed 或上一轮事件污染下一轮。
- [ ] 权限 accept 使用实际 allow_once optionId；拒绝、无匹配选项、轮次取消均有明确响应；不使用 allow_always。
- [ ] pending 绑定会话/代际/invocation/类型；跨会话、重复、伪造和迟到 control 被拒绝。
- [ ] ask_question 单选/多选映射、非法选项、无法表达的自由文本、skipped/cancelled 处理完整。
- [ ] create_plan 显示完整计划并有接受/拒绝/取消；接受计划不提升执行权限。
- [x] todos/image 通知不等待响应、不触发宿主额外执行；task 映射专用子 Agent 卡且不重复普通工具卡，未知/缺尾通知有界降级。
- [ ] 在文本生成、工具执行、权限等待、问题等待和计划等待时取消；有界杀进程且无悬挂交互。
- [ ] 宿主 abort、Worker stdin EOF、窗口退出均释放子进程；验证无遗留进程及监听器泄漏。

完成条件：临时工作区内通过真实 Cursor 的读取、授权编辑、拒绝编辑和取消；Aibo UI 能完成全部阻塞交互。

## P3 — 恢复、设置和兼容

- [x] recovery 校验版本、sessionId 和工作区绑定，不包含凭据、pending 或伪造 offset。
- [ ] open/轮次结束后 recovery 确实由宿主持久化；不是只测进程内 snapshot。
- [ ] 同绑定存活运行时被复用，元数据读取不重复 new/load。
- [ ] 空闲回收、关闭后重开、Aibo 重启均 load 同一 nativeSessionId，下一轮保留原上下文。
- [x] load 回放不重复追加 Aibo 消息，不重发历史审批和工具动作。
- [ ] prompt 发出后崩溃、结果返回前断连：不自动重试，提示结果可能未知；不承诺补齐丢失尾部。
- [ ] 原生会话缺失、账号变化、不支持 load、未知 recovery 版本明确失败，不悄悄 new。
- [ ] 插件升级后已有会话保留 release/contribution 绑定；新建会话使用新版本。
- [x] additionalInstructions 校验 schema/version，每次调用读取快照且不改用户原消息。
- [ ] 验证三层继承、空字符串覆盖、清空本层、运行中保存下一轮生效和 contribution 隔离。
- [x] 不支持的附件、推理强度明确拒绝；没有 ACP 模型配置时拒绝显式模型请求；无未实现的 Fast/fork/goal 能力入口。
- [x] 四个标准生命周期操作与共享合同逐字段一致，由宿主派生基础 `queue.manage`；provider 不伪造原生队列能力。
- [x] 未实现可靠 ACP steering 时不声明 queue operation、`queue.manage` 或 `queue.steer`；运行中消息等待普通 FIFO 派发。
- [x] 不报告未实现的 Aibo goal 能力；Cursor 结构化 task 只映射字段充分的 `subagent.updated`，不伪造缺失的 `subagent.message` 过程历史。
- [x] 0.1.8 增加模型目录、切换确认、恢复、迟到响应和下一轮模型路由测试；按 ACP 配置动态报告 model.select。真实验收结果见 validation 的 0.1.8 节。

完成条件：重启恢复和调用间配置更新通过真实桌面流程；不支持能力不会显示成可用。

## P4 — 发布验收与证据

- [x] 本仓库 `pnpm run verify` 通过，且已包含新增 Cursor 测试和构建检查。
- [ ] 受影响宿主若有改动，执行其 `pnpm run verify`、相关 Rust/会话测试与原生探针。
- [ ] 从 Applications 启动 Aibo，独立安装 Cursor 包；缺依赖、启用、禁用、卸载时轮盘入口正确变化。
- [x] 隔离 `tauri dev` 实例安装、启用并发现 Cursor provider；真实会话由宿主派生 `queue.manage` 且无 `queue.steer`，随后 close、disable、uninstall 成功。另一次消息探针进入 Timeline 后由 Cursor 服务返回 `resource_exhausted`，未据此冒充成功轮次或完整 UI 验收。
- [ ] 验证固定绑定会话在插件不可用时明确报错，不切换其他 provider。
- [ ] 双皮肤验证消息、工具、审批、提问、计划、取消和错误；现有 presentation 包默认继承正常。
- [ ] 每个 manifest 宣告的平台均有真实安装、执行、恢复证据；删去未验证平台。
- [x] 在发布证据中记录精确 CLI/Node 版本、宿主提交、OS/架构、profile 支持矩阵、测试命令和结果。
- [ ] 产物移至独立目录检查无开发机路径、相邻宿主依赖、凭据或未脱敏日志；版本字段一致。
- [x] 发布说明列明需预先安装/登录 Cursor、已验证版本、配置限制、恢复边界和已知问题。

发布完成条件：P0–P4 的首版必需项全部通过；可选模型项未做则保持禁用。现有 verify 仅检查本仓库原骨架，不单独证明 Cursor 协议、安装或真实交互可用。
