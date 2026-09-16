# Cursor 接入 Aibo：官方能力调查

> 调查日期：2026-09-16。本文只采用 Cursor 官方文档、官方 changelog、官方 GitHub 仓库与官方条款；产品状态可能继续变化。

## 结论

可以接入，而且已有三条正式公开的程序化路径；不必通过自动化 Cursor 桌面 UI：

1. **Cursor SDK + SDK Bridge（最适合 Aibo 会话能力插件）**：TypeScript 的 `@cursor/sdk`、Python 的 `cursor-sdk` 可创建本地或云端 agent；官方 Bridge 是一个可由宿主拉起或连接的本地服务，监听 loopback HTTP/1.1，以稳定的 `sdk.v1` Connect/protobuf 合同提供创建/恢复 agent、发送消息、流式运行、取消、artifact、usage、自定义工具和自定义 store。这是最接近“app-server”的官方能力。
2. **Cursor CLI ACP（较轻的本地协议适配）**：`agent acp` 以 stdio 上的换行分隔 JSON-RPC 2.0 工作，支持初始化、认证、新建/加载会话、发送 prompt、流式更新、权限请求和取消。它明确用于自定义客户端与集成。
3. **Headless CLI（最快 MVP）**：`agent -p` 可非交互运行，输出 `text`、单个最终 `json` 或实时 `stream-json`；适合脚本/CI，但进程级包装和错误语义弱于 SDK/ACP。
4. **Cloud Agents API v1（云端异步任务）**：HTTP API 创建持久 agent 和逐次 run，SSE 流式、取消、后续对话、artifact、usage 均有公开端点；适合远端仓库任务，不是操作 Aibo 用户本机工作区的本地 daemon。

Cursor **没有公开一个用于远程控制已打开 Cursor 桌面应用/编辑器 UI 的“desktop app-server”合同**。官方提供的是独立 Agent CLI、ACP、SDK/Bridge 和云 API；不要把 Cursor/VS Code 内部 IPC 当作可依赖接口。

## 能力与成熟度

| 能力 | 调用形式 | 会话与流式 | 工具能力 | 官方状态（截至调查日） | 对 Aibo 的判断 |
| --- | --- | --- | --- | --- | --- |
| Headless CLI | 子进程：`agent -p --output-format ...` | `--resume [chatId]`；`stream-json` 为逐行事件 | 文件、shell、MCP；写入/自动执行需配置权限 | 公开文档，未标 Beta；但未见结构化协议兼容承诺 | MVP 或降级通道 |
| ACP | 子进程：`agent acp`；stdio、NDJSON、JSON-RPC 2.0 | `session/new`、`session/load`、`session/update`、`session/cancel` | 工具调用与 `session/request_permission`；客户端必须应答 | 公开文档，未标 Beta；官方称用于 custom clients/integrations | 很适合映射 Aibo Runtime 2.1 会话事件 |
| TypeScript/Python SDK | `@cursor/sdk` / `cursor-sdk` | durable agent、run handle、事件流、wait/cancel/resume | MCP、自定义工具、子 agent、自定义 store、auto-review | **Public Beta**（官方 2026-04-29 公告） | Aibo 若以 TS Worker 实现，这是首选高层接口 |
| SDK Bridge | 子进程或现存服务；loopback HTTP/1.1 Connect/protobuf/JSON | create/resume/send/observe/wait/cancel；offset 恢复流 | 通过 callback service 暴露自定义工具/store | `sdk.v1` 合同和二进制由 Cursor 发布支持；SDK 整体仍处 Public Beta | 最像 app-server；适合 Rust/任意语言宿主或隔离 sidecar |
| Cloud Agents API v1 | `https://api.cursor.com/v1/...` | durable agent + run；SSE，支持 `Last-Event-ID` 重连；run 取消 | 创建时可传 MCP servers；云工作区工具 | **Public Beta**，GA 前可能变更 | 适合云仓库/PR 工作流，不应冒充本地编码会话 |

状态依据：[SDK 发布公告](https://cursor.com/changelog/sdk-release)、[Cloud Agents API v1](https://cursor.com/docs/cloud-agent/api/endpoints)、[SDK Bridge 官方文档](https://cursor.com/docs/sdk/bridge)、[官方 `cursor/sdk-bridge` 仓库](https://github.com/cursor/sdk-bridge)。

## 关键接口细节

### 1. Headless CLI

- 安装后可用 `agent`（较早文档/二进制也出现 `cursor-agent`）。`-p`/`--print` 是非交互模式。
- `--output-format json` 成功时只在结束后写一个 JSON 对象；失败时进程非零退出并写 stderr，**不保证 stdout 有合法 JSON**。
- `--output-format stream-json` 逐行输出事件；可以关联 tool call start/completion，拼接 assistant delta；单次执行的 session ID 保持一致。消费者应忽略未知字段，因为官方声明字段可能向后兼容地增加。
- `--force` 会让 agent 无人工确认地修改文件/执行命令。Aibo 不应默认打开；应把 Cursor 的权限请求映射到 Aibo 审批模型，或采用严格 allowlist。
- CLI 可读取项目/全局 MCP 配置，并支持 stdio、HTTP、SSE MCP server。

参考：[Headless / CI](https://cursor.com/docs/cli/headless)、[CLI output format](https://docs.cursor.com/en/cli/reference/output-format)、[CLI parameters](https://docs.cursor.com/en/cli/reference/parameters)、[CLI MCP](https://cursor.com/docs/cli/mcp)。

### 2. ACP：可直接作为会话协议

`agent acp` 的协议顺序是：`initialize` → `authenticate` → `session/new` 或 `session/load` → `session/prompt` → 持续处理 `session/update`，必要时响应 `session/request_permission`，并可 `session/cancel`。传输为 stdin/stdout，一行一个 JSON-RPC 2.0 消息，日志可走 stderr。

ACP 支持 `agent`、`plan`、`ask` 模式。若 Aibo 客户端不响应 permission request，工具执行会阻塞。因此插件必须把审批做成显式状态机，不能只转发文本增量。

参考：[Cursor CLI ACP](https://cursor.com/docs/cli/acp)。

### 3. SDK 与 Bridge：最完整的宿主集成面

官方 SDK 同时抽象 local 和 cloud runtime：本地 agent 针对宿主机器工作目录运行，云端 agent 在 Cursor 管理的隔离 VM 内运行。`Agent.create()` / `Agent.resume()` 返回持久句柄，`send()` 返回 run，run 可流式迭代事件、等待终态或取消。

Bridge 的准确性质是“小型本地 server”，不是常驻 Cursor 桌面进程：

- adapter 通常拉起 `cursor-sdk-bridge` 子进程，也可连接平台已运行的实例；
- 默认绑定 `127.0.0.1`，启动时以 ready-line 返回随机端口和每进程 bearer token；每个 RPC（含流）都需该 token；
- 使用 HTTP/1.1 的 Connect/gRPC-Web 或普通 protobuf/JSON POST，**不是** HTTP/2 classic gRPC；
- 发布包含 `proto/sdk/v1`；官方建议固定 release tag，SDK/Bridge/Proto 版本相配；`sdk.v1` 有兼容承诺和能力协商；
- 支持 TypeScript、Python；其他语言可基于官方 Bridge 写 adapter。官方只支持发布的合同、Bridge 二进制及第一方 TS/Python SDK，不把第三方 adapter 视为第一方 SDK。

自定义工具可以直接传给本地 SDK，SDK 会通过内置 MCP server 暴露，并沿用权限闸门；也可以使用文件配置的 MCP。自定义工具/内联 MCP 在恢复时的持久性不同：Python 文档明确说 inline MCP 不随 resume 持久化，应在恢复时重新传入，或使用文件配置。

参考：[TypeScript SDK 发布与示例](https://cursor.com/changelog/sdk-release)、[Python SDK](https://cursor.com/docs/sdk/python)、[SDK Bridge](https://cursor.com/docs/sdk/bridge)、[Bridge protocol](https://github.com/cursor/sdk-bridge/blob/main/docs/protocol.md)、[Bridge services](https://github.com/cursor/sdk-bridge/blob/main/docs/services.md)、[`sdk.v1` versioning](https://github.com/cursor/sdk-bridge/blob/main/docs/versioning.md)、[SDK custom tools/auto-review 更新](https://cursor.com/changelog/sdk-updates-jun-2026)。

### 4. Cloud Agents API

v1 支持：创建 agent 并启动首个 run、对同一 agent 发 follow-up、读取 run、SSE 流、取消、archive/unarchive/delete、artifact、usage、模型与仓库目录。SSE 以 `Last-Event-ID` 恢复；事件保留期过后可能返回 `410 stream_expired`，此时应读取 run 终态。Webhook 在 v1 文档中仍标为“coming soon”（旧 v0 有 webhook）。

这是 Cursor 托管计算，源代码仓库需先被账号管理员连接/授权。若 Aibo 的目标是“在用户当前本机目录编码”，应选 local SDK/Bridge、ACP 或 CLI；若目标是“异步改远端仓库并开 PR”，才优先 Cloud API。

参考：[Cloud Agents 概览](https://cursor.com/docs/cloud-agent)、[Cloud Agents API v1](https://cursor.com/docs/cloud-agent/api/endpoints)。

## 认证、计费与许可边界

- CLI 支持浏览器登录和 API key；自动化推荐 `CURSOR_API_KEY`。企业可使用 service account key，适合 CI/cron；密钥应由 Aibo 的安全凭据存储注入，不能写入插件清单、参数日志或仓库。
- ACP 可预先使用 `agent login`、`--api-key`/`CURSOR_API_KEY` 或 auth token 认证。
- SDK/Bridge 需要 Cursor API key；Bridge 另有仅保护本地 RPC 的每进程 bearer token，两者不能混用。Bridge 官方文档建议 API key 在创建/恢复/catalog 请求中显式传入，同时注入进程环境。
- Cloud API 接受 Basic 或 Bearer；可用 user key 或 service-account key。SDK 官方公告说明按标准 token consumption 计费；Cloud API/实际模型费率应在部署时重新核对。
- Cursor 条款覆盖软件、平台、API 和文档。公开条款禁止出租、出借或销售 Service，禁止用 Service/输出训练竞争模型，以及发送受 HIPAA、PCI 等特定监管保护的数据（除非另有安排）。因此 Aibo 可以做用户自带 Cursor 凭据的集成，但“以 Aibo 自有 Cursor 账号向第三方转售 Cursor 能力”、处理受监管数据、或代用户共享账户都需要先获得 Cursor 的书面商务/法律确认。
- Bridge GitHub 仓库显示 MIT 许可适用于该仓库源码/协议材料；这**不替代**对 Cursor 在线服务和 SDK 使用条款的遵守。

参考：[CLI authentication](https://docs.cursor.com/en/cli/reference/authentication)、[Service Accounts](https://cursor.com/docs/account/enterprise/service-accounts)、[Cursor Terms of Service](https://cursor.com/terms-of-service)、[Cursor Pricing Policy](https://cursor.com/terms/pricing)、[官方 Bridge 仓库](https://github.com/cursor/sdk-bridge)。

## 对 Aibo 插件的建议

建议按以下优先级实施：

1. **生产主路径：`@cursor/sdk`（若能力 Worker 可安全运行其本地 runtime）或 SDK Bridge sidecar。** 将 Cursor `agent_id`、run id、event offset 存入 Aibo 会话恢复状态；把 stream event 映射到 Runtime 2.1 事件；把 custom tool/MCP 调用接入 Aibo Broker，而不是让插件绕过权限直接访问服务。
2. **协议型备选：ACP。** 它比解析 CLI 自定义 JSON 更像真正的双向 app-server，尤其适合权限审批和实时会话；但需由插件完整管理子进程、JSON-RPC 相关性、stderr、取消和崩溃恢复。
3. **MVP/探针：Headless CLI `stream-json`。** 快速验证认证、模型可用性和本地工作区行为；不要把 `--force` 设成默认，也不要假定失败时 stdout 可解析。
4. **可选独立能力：Cloud Agents API。** 在 UI 上明确标为“Cursor Cloud”，因为代码位置、运行持续性、仓库授权和费用语义都不同于本地 agent。

由于 SDK 和 Cloud API 仍是 Public Beta，Aibo 应把 Cursor 集成封装在单一 provider seam 后，固定 SDK/Bridge 版本、忽略流事件未知字段、保留能力协商和降级路径，并在实际发布前再次核对 API、价格与条款。

## 尚未公开/不应依赖的部分

- 未发现官方公开的“连接并遥控现有 Cursor Desktop 窗口/Composer”的稳定 IPC 或 app-server API。
- 未发现让第三方宿主复用 Cursor Desktop 登录态、内部数据库或扩展宿主进程的受支持合同；公开认证路径是 CLI 登录/API key/auth token。
- Cloud API v1 webhook 尚未公开可用；文档只承诺未来提供，旧 v0 才有。
- SDK/Cloud API 在 Beta 阶段，不能把当前类型/端点视为 GA 永久合同；Bridge 的 `sdk.v1` 兼容承诺也不等于所有上层产品行为已 GA。
