# 终端插件验证记录

本次实现按 Q1～Q19 的设计执行。验证环境为 macOS arm64；源码需要本次扩展后的
Aibo 0.1.1，版本号不代表已发布。可安装目录为 `dist/terminal/`，通过
`pnpm run build:terminal` 重建。插件自带本机可执行后端，最终用户无需 Node。

最终结果：宿主 `verify` 通过（架构检查 41 项、测试 666 项、类型与生产构建通过）；
插件 `verify` 通过（57 项通过，1 项 Windows 专用测试跳过）；宿主原生专项 4 项与
插件 Rust 单元测试 3 项通过。浏览器及原生探针均成功。

## 自动验证

- 插件仓库 `AIBO_SDK=local pnpm run verify`：测试和全部插件构建。
- 原生后端 `cargo test --locked --manifest-path plugins/terminal/backend/Cargo.toml`：
  有界历史及截断游标、尺寸约束、Windows 命令行引号解析。
- `node --test test/terminal.test.mjs`：用户账户默认登录 shell、真实 PTY 输入、工作目录、调整尺寸、退出码与输出保留，
  无效 shell、设置校验，以及后端被 SIGKILL 后清理存活子进程。Windows 专用测试在 macOS 跳过。
- 宿主 `pnpm run verify`：架构边界、公开 SDK、类型、测试与生产构建。
- 宿主 `cargo test --lib tool_views`：窗口归属、资源路径边界、窗口隔离的临时文档、
  CSP 与撤销，以及错误/超大响应导致失败且不自动重启。

## 真实交互探针

宿主仓库 `node probes/tool-view-browser.mjs` 运行 Chromium、实际终端插件与真实 PTY。
Material 3 和第二套皮肤均验证键盘输入、多标签、关闭取消/确认、前端重新加载后连接原终端、
Ctrl+C、隔离 iframe 无权访问父页面。Material 3 另验证中文文本输入与 Vim 全屏编辑后返回 shell。
旧输出回放期间暂停输入与终端查询响应，避免把历史控制序列的响应误发给当前 shell。
中文文本注入不等于已覆盖所有系统输入法组合事件。

`node probes/tool-view-native.mjs` 使用独立应用标识和数据库启动真实 macOS Aibo，验证插件安装、
发现与启用、工具面板打开、原生自定义协议页面、真实 PTY 输出、两套皮肤、实例复用、关闭后的
旧句柄拒绝及停用。探针使用临时工作区，不使用用户的常规工作区或聊天数据库。

## 平台与剩余人工验收

- macOS arm64：上述 PTY、浏览器与原生集成路径已实测。
- macOS x64、Linux x64、Windows x64：提供独立系统的构建/测试矩阵，尚未运行远端 CI；
  Windows/Linux 当前为实验性。不能以 macOS 通过推断 ConPTY、Windows Terminal profile 或 Job Object 已实测。
- 尚需对应系统人工覆盖：系统剪贴板、各输入法、多原生窗口同时运行，以及原生关闭窗口、
  移除工作区、停用插件与退出应用的确认对话框接受/取消组合。单终端关闭取消/确认已由浏览器覆盖。
- Windows 没有统一的用户登录 shell 概念；自动识别 Windows Terminal 默认本机 profile，
  无法识别时明确报错并允许手动配置，不悄悄退回 PowerShell。
- Unix 清理覆盖 PTY 会话内的进程；Windows 使用 Job Object。
  主动创建新系统会话、服务或提权而脱离终端的程序不保证被清理。

终端输出仅保存在内存，不写入应用日志或聊天历史；shell 自身可能写入命令历史。
测试中依赖本机端口、PTY 与系统进程枚举的项目须在允许这些操作的环境运行。
