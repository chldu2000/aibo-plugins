# Cursor ACP 验证记录

验证日期：2026-09-16。仓库宿主基线：Aibo `0d729ff`。插件版本：`0.1.4`。

环境：macOS 27.0 arm64、Node.js `v24.18.0`、Cursor CLI `2026.09.10-fd3934a`。验证工作区是 `/private/tmp` 下新建的空目录，不包含本仓库文件。

真实 ACP 结果：

- `initialize` 协商 protocolVersion 1，Cursor 宣告 `cursor_login`、`loadSession: true`、ask/plan/agent 模式和 session config options。
- `authenticate` 使用已有的 `agent login` 登录态成功。
- `session/new` 冷启动成功；实测可能超过 14 秒，因此插件将 new/load 内部上限改为 90 秒，Manifest open 上限改为 120 秒。
- Ask/read-only 轮次发送固定提示后，Cursor 流式返回准确文本 `AIBO_CURSOR_OK`，最终 stopReason 映射为 completed。
- 事件序列包含 session.started、turn.started、reasoning.updated、message.delta、message.completed、reasoning.completed 和唯一 turn.completed。
- 关闭原进程后，新进程以 recovery 中相同 nativeSessionId 成功执行 `session/load`；历史回放未生成带当前 turnId 的 Aibo 事件。

本地自动验证：

- `pnpm run verify`：18 项测试通过；三个安装目录构建成功。
- ACP 传输测试覆盖分割 UTF-8、半行、多行、CRLF、字符串/数字 ID、ID 0、双向请求、写入背压、超限无换行帧、畸形 JSON、stdout EOF、stdin 错误和 deadline；异常时所有 pending request 均结束。
- 会话测试覆盖多消息分段、即时完成工具和重复终态去重、未知 stop reason、prompt 传输失败及宿主执行中关闭后的状态收敛。
- Worker/会话边界要求 edit 模式只能接受宿主写授权轮次、ask/plan 只能接受只读轮次；设置 schema/version/长度错误会明确失败。交互请求按 JSON-RPC ID 类型、当前 turn 和 native session 绑定，禁用网络时 URL/curl/wget 类请求直接拒绝。
- 打包后的 Cursor Worker 使用独立假 ACP 可执行文件完成 Runtime 2.1 initialize、session open、流式文本和 turn completion。
- `plugin.json` 通过 Aibo Manifest v2 schema 校验。

隔离 Aibo 桌面探针：

- `pnpm run probe:cursor:desktop` 使用唯一 Tauri application identifier 和空临时工作区，不读取或覆盖日常 Aibo 数据。
- Aibo 成功安装、启用并发现 `dev.aibo.cursor.agent`，创建会话并把三轮固定只读提示路由到 Cursor；Timeline 收到 Cursor 返回的已完成错误消息。
- 三轮均由 Cursor 服务返回 `resource_exhausted`，因此本次探针无法继续断言期望文本、宿主持久化后的恢复、禁用与卸载。该失败发生在插件安装、ACP open 和消息路由之后；直接 ACP 的成功往返与跨进程 load 证据仍有效。
- 当前宿主会把未知第三方 provider 的 enforcement backend 设为 `Unnegotiated`，所以 Aibo 只会给 Cursor 分派受限的 ask/read-only profile。插件实现了 edit/审批合同，但在宿主增加可协商 enforcement 前不能从当前 Aibo UI 使用。

已验证的执行配置：Ask/Plan 只读组合，以及 Edit 配置的静态权限校验与假 ACP 审批闭环。真实 Edit 写入、完整桌面成功轮次、双皮肤交互、Applications 启动 PATH 和 UI 内取消/审批仍需桌面验收，因此 checklist 保持未勾选。
