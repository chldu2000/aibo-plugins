# Claude Code 外部程序依赖验收

日期：2026-09-28。宿主基线 `b64bbb5`，插件基线 `5406958` 加本次改动。
平台 macOS arm64；宿主 SDK 0.1.7、私有 Node 24.18.0；插件 0.4.2、
ACP 0.81.2、JavaScript SDK 0.3.280、用户安装的 Claude Code 2.1.280。

## 运行与打包

插件携带 ACP 和 JavaScript 依赖，不再携带原生 Claude 程序。用户须安装并登录
Claude Code；清单将 `claude >=2.1.280` 声明为必需依赖。该最低版本对应已验证组合，
不表示所有更早版本都不兼容，也不保证未来版本无需适配。

宿主沿用通用依赖检测和 PATH 构造；插件的 `launch-acp.mjs` 从该 PATH 找到可执行文件，
解析符号链接，将绝对路径传入 ACP 的 `CLAUDE_CODE_EXECUTABLE`。
启动器不使用 shell，不搜索相对 PATH 条目，也不回退到包内引擎。
Worker 和 ACP 使用宿主私有 Node，用户无需另装 Node、npm 或全局 ACP。

构建使用锁定依赖和 `--omit=optional`，排除 SDK 的平台原生包。
包体检查拒绝原生 SDK 平台包、Claude 可执行文件及超过 32 MiB 的产物。
本次生成目录 `dist/build-QUsA7w/claude-code/`，包含 2,795 个文件、
18,668,141 字节（17.80 MiB）；压缩包
`dist/build-QUsA7w/claude-code-consumer/aibo-claude-code-0.4.2.tgz`
为 4,205,821 字节（4.01 MiB）。旧 0.4.0 解包记录为 235,920,776 字节，
本次减少约 92.1%。历史全量包验收见 [旧记录](self-contained-runtime-validation.md)。

## 本次证据

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 自动检查与打包 | 插件仓库 `pnpm run verify` | 47 项测试通过，所有插件构建及 smoke 通过 |
| 启动器测试 | verify 内的 `test/claude-launcher.test.mjs` | 含空格路径、符号链接、不可执行文件、目录、空及相对 PATH 的行为通过 |
| 打包后检查 | verify 内的 `scripts/smoke-claude-package.mjs` | 私有 Node 启动 Worker；缺 CLI 给出安装提示；临时外部 CLI 被实际调用；真实 ACP initialize 通过；无原生 SDK 平台包 |
| 真实 CLI 配置 | `PROBE_CONFIG_ONLY=1 CLAUDE_PLUGIN_PATH=<built-package> node scripts/probe-claude-code.mjs` | 外部 Claude 2.1.280 打开 Plan 会话；44 个命令、5 个模型、6 个推理等级；模型切换后恢复原值，保持 current-model 范围 |
| 隔离桌面 IPC | 宿主 `AIBO_EXPECT_PARAMETER_SCOPE=current-model node probes/default-session-profile-native.mjs <built-package>` | 插件 0.4.2 安装、依赖检查、启用通过；默认 Plan，prepare/resume 打开真实会话并关闭；模型范围仍为 current-model |

首次在沙箱内运行 verify 时，Cursor smoke 的回环服务监听被 EPERM 拒绝；允许本地监听后
重跑整套 verify 成功。桌面探针在完成后主动终止开发进程，因此日志尾部有 ELIFECYCLE；
探针自身退出码为 0，报告 `ok: true`。日志位于 `/tmp/aibo-claude-slim-{verify,real,native}.log`。

## 验证范围与升级

本次没有改宿主代码。真实配置与桌面探针使用现有登录，没有发送模型提示，
不覆盖本次完整生成、工具执行、审批或全新机器登录；未进行新的皮肤交互验收。
当前仍只声明 darwin-arm64；其他平台未验收。

安装 0.4.2 后使用新会话验证；已有会话保持绑定旧插件 release，升级不会改写其运行依赖。
外部 Claude 由用户维护升级，插件固定 ACP/SDK；不再固定实际原生引擎版本。
