# 插件开发行为规范

适用于本仓库全部插件、构建脚本、测试和文档。以下规则依据 Cursor 从首版 `9f79b00` 到 `8a70e44`（0.1.16）的提交差异及开发、验收记录提炼；Cursor 专用规则仅在修改相应适配器时适用。

## 开工先确定合同与验证范围

1. 修改插件前阅读 [插件开发文档](docs/plugin-development.md) 的相关章节；修改 Cursor 时同时阅读 [插件说明](plugins/cursor/README.md)、[实现规格](docs/cursor-acp-spec.md) 和 [验证记录](docs/cursor-acp-validation.md)。按任务查阅 [验收 checklist](docs/cursor-acp-checklist.md)，已勾选项不能代替本次验证。
2. 确认目标宿主源码位置（默认 `../aibo`，可用 `AIBO_ROOT` 指定）、提交及插件 release。协议版本、SDK 版本、插件版本分别核对；新增合同需说明最低宿主要求，不能把本地提交当成已发布功能。
3. 先找相关提交与测试，再修改实现。历史文档中的版本结论只适用于当时基线；冲突时对照目标宿主合同、当前实现和后续提交，更新受影响的说明。特别注意：旧文档的“Cursor 仅 Ask”“附件/推理/上下文不支持”已被后续版本部分或全部取代，不能照抄为永久限制。
4. 在动手前确定本次需要证明的链路：原生输入输出、插件映射、打包 Worker、宿主协商或桌面交互。完成时报告各层实际证据和未验证项。

## 合同必须贯通清单、握手与执行

踩坑依据：`c8e2061` 对齐基础队列合同；`59423a2` 修复可选操作 schema 与响应封套。此前实现了方法，仍可能无法被宿主协商或消费。

- 修改会话能力时读取目标宿主的 `contracts/session-capabilities.v1.json`、`contracts/session-features.v1.json` 和 `docs/session-capability-negotiation.md`。基础操作及可选操作各自使用对应合同；可选操作 schema 按 JSON 值精确匹配一个完整变体，业务必填条件在处理器中验证。
- 同步核对 manifest 的 capability/version/operation ID、Runtime initialize 三元组、open 的实际 capabilities、Worker 路由及操作输出。返回合同要求的 `recovery`、`capabilities` 和专用字段；通过 manifest 校验不代表实际响应合规。
- 为新增或变更操作补充合同测试及打包冒烟：比较宿主合同，执行打包后的 Worker，并用 schema 校验真实响应，包括缺参和原生不支持的情况。Cursor 对应 `test/cursor-manifest.test.mjs` 与 `scripts/smoke-cursor.mjs`；其他插件在各自测试入口覆盖。
- 能力来自实际协商与实现。模型、参数和图片支持按原生返回声明；未实现的 goal、fork、snapshot 等保持不声明。opaque recovery 不等于 `session.snapshot`。
- 标准生命周期可让宿主派生基础 `queue.manage`；原生 steering 单独协商。保持等待队列、消息 ID、revision、暂停和 uncertain 处理由宿主管理，避免增加第二套自动消费队列。结果未知时禁止自动重发可能已执行的请求。

## 功能、模式和执行授权分别落实

踩坑依据：`ce208c6` 补上回合写授权；`6d1de34` 改为原生权限归属，并移除以工具文本猜测网络权限的做法。

- 修改模式或审批前读取目标宿主 `docs/session-controls.md`。由 provider 的 `sessionControls` 声明菜单并实际消费配置；宿主依据绑定 release 和执行授权提供动作，不按品牌补造权限入口。
- `session.open` 选择 Agent 模式不授予写权限。Cursor 写回合必须经 `aibo.session.turn.write` 且具备 `workspace.write`；Worker 与会话层都要检查操作、模式和授权是否匹配。只读可选操作不能承载工作区写入。
- Cursor 当前 `executionPolicy: "agent-managed"` 表示 Cursor 管理原生文件、命令、网络和 MCP 权限；Aibo 转发其实际发出的审批。Ask/Plan 是原生只读行为，不能宣称为 OS 沙箱、工作区写隔离或网络阻断；Core 工具权限也不能由该声明取得。
- 审批和用户输入响应必须绑定当前 invocation、turn、native session 及带类型的 JSON-RPC ID；数字 `1` 与字符串 `"1"` 是不同请求。过期、重复、跨会话或越权响应明确拒绝；权限同意映射为本次允许，不扩大为永久允许。
- 设置从每次调用的 `context.settings` 快照读取并验证 schema/version；保持用户原始消息不变。修改设置声明时按开发文档处理继承、有效空值和配置版本隔离。

## 传输和生命周期以异常收敛为完成条件

踩坑依据：`6d00b8c` 发现真实冷启动超过原超时；`1fdb85f` 修复分帧、背压和事件终态；`fba1704` 修复强制取消及悬挂交互。

- 修改 ACP 传输时覆盖分割 UTF-8、半行/多行、CRLF、ID 0、双向请求、背压、超限帧、畸形 JSON、EOF、stdin 错误和超时。stdout 仅承载协议，诊断写 stderr；缓冲区、写队列和诊断输出均需有界。
- 根据真实操作耗时设置内部 deadline，并与 manifest 外层超时协调；冷启动/new/load 与长回合分别处理。超时或断连后结束所有 pending request，释放子进程、监听器、等待器和计时器。
- 取消需结算待处理审批/提问，发送原生 cancel，在宽限期后强制关闭，并让回合以唯一 interrupted 终态结束。cancel accepted 只表示接收取消，不能据此认定清理已经完成。
- 覆盖多段消息、工具首次通知即完成、重复终态、未知 stop reason、prompt 失败和执行中 close。消息及工具按稳定 ID 归并；迟到回调不能把 stopped 会话重新变为 ready，也不能污染新运行时代际。
- 修改 task 映射时对照宿主事件 schema：子 Agent 事件级 `turnId` 为 null，`rootTurnId` 指向真实宿主父回合。完成级元数据只生成对应进度，缺少过程时明确降级；不伪造消息历史或重复普通工具卡。（`9fd2808`）

## 恢复与配置以原生确认状态为准

踩坑依据：`31c0fe4`、`7dbacb2` 增加模型/参数确认及跨进程恢复；`6d1de34` 处理 Cursor 不持久化空会话的情况。

- recovery 校验版本、非空 nativeSessionId 与工作区绑定；恢复测试必须关闭旧进程再加载，不能只比较内存快照。加载历史不生成当前回合消息、审批或工具执行。
- Cursor 仅对明确记录 `hasPrompt: false` 的空会话允许重新创建。已发送 prompt 或旧 recovery 缺少该标记时必须加载原会话；失败明确报错，不能静默 new 丢失历史。
- 模型、推理、上下文和模式设置须等待原生确认，再发布当前值及 recovery；RPC 成功但未确认请求值不算成功。多参数部分成功时暴露已确认状态与错误，不能宣称整组成功。
- 模型和参数 ID 作为不透明值传递；选项按模型隔离，保留原生名称和顺序。Auto 的 ID 不一定是 `auto`，目录可见不代表订阅可用，标签不提供可靠 token 数。保留真实权限/额度错误，不猜套餐或 Auto 内部路由。
- 恢复先选择模型再重放对应参数；显式宿主模型优先于 recovery，换模型时丢弃旧模型参数。运行中配置修改在 invoke/control 两条路径都要拒绝；空闲配置通知及时更新，旧进程及外来会话通知丢弃。

## 命令、附件与 UI 验证覆盖真实消费端

- 命令目录来自异步 ACP 通知：覆盖先于 open/load 响应到达、首次等待超时、后续整表替换及关闭清理；恢复后重新获取，不重放旧目录。slash 文本与参数原样进入普通回合，附加指令不能加到 slash 前面。（`3fd58d5`）
- Cursor skill 分类只使用已验证的原生来源标记，记录对应 CLI 版本；未知格式保留原描述与命令语义，不凭命令名称猜分类。（`004456e`）
- 菜单/模式/模型控件变化要验证真实组件链路及受影响皮肤的展示、选择和关闭。0.1.10 曾出现目录调用成功但 Composer 因第三方 `selectedAgent=null` 隐藏菜单；函数测试、RPC 返回和 contract-only 探针均不能替代浏览器或桌面交互证据。详见 [验证记录](docs/cursor-acp-validation.md)“同日桌面菜单回归”。
- 图片接入须读取宿主附件合同，只有原生协商支持时才声明 `image.input`；把宿主图片描述符转换成原生图片内容块。发送文件路径文本不构成图片输入支持。（`8a70e44`）
- 图片在原生回合启动前校验描述符、文件类型、符号链接、实际内容、数量、单图和总量；读取过程中检查变化并关闭文件句柄。扩展传输限制时计算 Base64 开销，出站与入站分别设限，保留纯文本路径回归。

## 构建、发布与证据

踩坑依据：`6486d29` 补充宿主安装探针；`000683f` 将捆绑 SDK 迁移为宿主 SDK。构建通过、安装通过与真实轮次成功是不同结论。

- 使用本地目标宿主 SDK 和现有离线构建流程；SDK 作为开发依赖，运行时使用公开 `hostSdk` 入口。发布包不携带 `node_modules/@aibo`、宿主内部 helper、开发机路径或源码软链接；第三方运行依赖由插件自行携带。构建位置和命令以 README、package.json 和脚本为准。
- 能力插件提供协议/语义数据；呈现插件使用受限视觉树和宿主动作 token。修改呈现资源时由构建工具生成清单长度与摘要，保留所声明 surface 的核心语义及默认继承。
- 实现或构建变更完成后运行本仓库 `pnpm run verify`。若同时修改宿主，在宿主运行其 verify，并按变更补充相关 Rust 测试、原生探针或 UI 验证。纯文档修改检查内容依据、链接和 diff 即可。
- 真实探针使用临时工作区和隔离桌面数据，恢复被改动的原生配置。验收记录写明宿主提交、插件/CLI/Node 版本、OS/架构、执行配置、命令、结果与未覆盖范围，日志脱敏。
- 区分单测/假 ACP、打包 Worker smoke、真实 CLI、隔离宿主合同探针、真实桌面 UI。真实请求因 `resource_exhausted` 等失败时，只记录已经证实的阶段；配置确认不证明模型可调用或窗口容量极限。保留未通过验收项，不能用模拟成功勾选真实验收。
- 发布内容变化时同步插件 manifest、package.json 及 Worker 实际上报版本；纯文档修改无需发布升版。同 ID/版本内容不同不能覆盖已安装 release。重建安装后用新会话验证新版本，同时验证旧会话保持原 release/contribution 绑定。
- 发布说明同步最低宿主/CLI 要求、运行依赖、权限归属、恢复边界和已知限制。只有实际完成对应检查，才声称 Applications 启动、双皮肤、平台兼容或完整桌面交互已通过。
