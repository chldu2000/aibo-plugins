# Cursor ACP 验证记录

验证日期：2026-09-16。仓库宿主基线：Aibo `0d729ff`。插件版本：`0.1.1`。

环境：macOS 27.0 arm64、Node.js `v24.18.0`、Cursor CLI `2026.09.10-fd3934a`。验证工作区是 `/private/tmp` 下新建的空目录，不包含本仓库文件。

真实 ACP 结果：

- `initialize` 协商 protocolVersion 1，Cursor 宣告 `cursor_login`、`loadSession: true`、ask/plan/agent 模式和 session config options。
- `authenticate` 使用已有的 `agent login` 登录态成功。
- `session/new` 冷启动成功；实测可能超过 14 秒，因此插件 `0.1.1` 将 new/load 内部上限改为 90 秒，Manifest open 上限改为 120 秒。
- Ask/read-only 轮次发送固定提示后，Cursor 流式返回准确文本 `AIBO_CURSOR_OK`，最终 stopReason 映射为 completed。
- 事件序列包含 session.started、turn.started、reasoning.updated、message.delta、message.completed、reasoning.completed 和唯一 turn.completed。
- 关闭原进程后，新进程以 recovery 中相同 nativeSessionId 成功执行 `session/load`；历史回放未生成带当前 turnId 的 Aibo 事件。

本地自动验证：

- `pnpm run verify`：7 项测试通过；三个安装目录构建成功。
- 打包后的 Cursor Worker 使用独立假 ACP 可执行文件完成 Runtime 2.1 initialize、session open、流式文本和 turn completion。
- `plugin.json` 通过 Aibo Manifest v2 schema 校验。

已验证的执行配置：Ask/Plan 只读组合，以及 Edit 配置的静态权限校验与假 ACP 审批闭环。真实 Edit 写入、Aibo 桌面安装、双皮肤交互、Applications 启动 PATH 和 UI 内取消/审批仍需桌面验收，因此 checklist 保持未勾选。
