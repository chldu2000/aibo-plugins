# Aibo Terminal

在 Aibo 工具面板内运行交互式终端。插件拥有 xterm 前端、portable-pty 后端和进程清理；
宿主通过通用 `toolView` 合同提供隔离容器、通信与生命周期监督。

需要带 `toolView/1` 的 **Aibo 0.1.1**。这是本次源码要求，不代表宿主已经发布。
安装产物是 `dist/terminal/` 目录，从插件管理安装、启用后，在工具面板的“添加视图”选择
“Terminal · 终端”。用户无需另装 Node 或编译器。

- 同一窗口、工作区内共享终端，不同窗口各自独立。新终端从工作区根目录启动。
- 支持多标签、交互式 CLI、全屏终端程序、尺寸变化、Ctrl+C 和复制粘贴。
- macOS/Linux 跟随用户登录 shell；Windows 尝试解析 Windows Terminal 的默认本机 profile。
- 无法识别、WSL/远程 profile 或启动失败时显示错误，可设置 shell 路径及 JSON 参数数组。
  手动设置优先；“恢复跟随系统”清除覆盖。设置仅影响新终端。
- 手动终端使用系统用户权限，独立于聊天模式。工作区不是文件访问沙箱。
- 隐藏继续运行；关闭会确认并结束进程。界面可重新加载并连接原实例，后端故障不自动重启。
- 每实例最多 16 个终端，每终端保留 2 MiB 原始输出及 3000 行渲染滚动历史；超限明确提示。
  输出不落盘，退出应用后不恢复标签或输出；shell 自身的历史文件不受此规则影响。

## 开发与构建

需要 Rust stable 和 Node 22+，在仓库根目录执行：

```sh
npm ci --prefix plugins/terminal --ignore-scripts
cargo test --locked --manifest-path plugins/terminal/backend/Cargo.toml
node --test test/terminal.test.mjs
pnpm run build:terminal
```

构建打包当前 OS/架构的可执行文件和内联前端，不将源码、开发依赖或宿主私有模块放入产物。
`CARGO_BUILD_TARGET` 可指定已配置链接器的 Rust target；跨平台构建优先使用对应系统 runner。
`.github/workflows/terminal.yml` 提供 macOS arm64/x64、Linux x64 和 Windows x64 构建与测试。
产物应以归档传输以保留 Unix 可执行权限，解包后选择包含 `plugin.json` 的目录安装。

## 验证范围

本机 macOS arm64 已执行真实 PTY 测试和浏览器/原生宿主探针，详见
[验证记录](../../docs/terminal-plugin-validation.md)。Windows 与 Linux 实现和构建流程已提供，
未在本次机器上完成对应真实系统验收，当前标记为实验性。

Unix 看护进程在后端结束后按 PTY 会话清理进程；Windows 使用关闭即清理的 Job Object。
通过自行创建新系统会话、系统服务管理器或提权主动脱离终端的程序，不保证被终端关闭清理。
