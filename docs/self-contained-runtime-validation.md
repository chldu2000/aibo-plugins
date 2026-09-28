# 自包含插件运行依赖验收

日期：2026-09-27。基线：宿主 `6764bfa`、插件 `c73711d`，加本次未提交改动。
平台：macOS arm64。宿主 SDK 0.1.6，内置 Node 24.18.0，Claude 插件 0.4.0，
ACP 0.81.2，Claude Agent SDK 0.3.280（原生 CLI 2.1.280）。

## 发布与安装合同

- 宿主构建时准备固定摘要的官方 Node，随 Tauri resources 发布。宿主不包含 Claude ACP。
- 插件构建时按 `runtime/package-lock.json` 执行生产依赖安装，包含平台原生可选依赖。
  npm 缓存首次由 `pnpm prepare:deps` 准备，插件构建使用 `npm ci --offline`。
- 产物是完整目录，不含宿主 SDK、开发机路径或符号链接。用户安装只复制、校验，不执行 npm。
- Claude 产物实测 2,798 个文件、235,920,776 字节，低于宿主 4,096 文件/256 MiB 上限。
  类型文件和 source map 不发布；JS、原生二进制、资源、包元数据及许可证保留。
- `acp.json.launch` 的包内入口由宿主 SDK 使用 Worker 的 `process.execPath` 启动。
  入口相对插件解析，工作目录仍为用户工作区。外部 command 路径保持兼容。

## 本次证据

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 宿主自动检查 | 宿主 `pnpm run verify` | 通过；514 个 Node 测试，另含架构、类型、迁移检查及前端构建 |
| 插件自动检查 | 插件 `pnpm run verify` | 通过；46 个测试、离线构建、Cursor 假 ACP smoke、Claude 真实包 smoke |
| 原生回归 | `cargo test --manifest-path src-tauri/Cargo.toml --lib` | 最终 267 passed、2 ignored；其中产物验收已用 `--ignored` 单独通过，另一个为既有迁移探针 |
| 包内启动 | `node --test test/acp-package-launch.test.mjs` | 空 PATH、特殊字符路径、不同 cwd、回合和跨进程恢复通过；路径逃逸、缺文件、歧义声明拒绝 |
| 真 ACP 产物 | `node scripts/smoke-claude-package.mjs <built-package>` | 内置 Node + 空 PATH 下，Worker 握手、ACP initialize、包内原生 CLI `--version` 均通过 |
| 原生安装 | `AIBO_TEST_PLUGIN_PATH=<built-package> cargo test --manifest-path src-tauri/Cargo.toml --lib packaged_node_plugin_installs_and_initializes -- --ignored` | 实际复制/摘要/平台检查、启用、SDK 加载、Worker 握手和卸载通过 |
| 真实配置 | `PROBE_CONFIG_ONLY=1 CLAUDE_PLUGIN_PATH=<built-package> node scripts/probe-claude-code.mjs` | 现有登录、私有 Node、包内 ACP 打开 Plan 会话；读取 44 个命令、5 个模型、6 个推理等级 |
| 发布资源 | `pnpm tauri build --bundles app` | 生成 macOS Aibo.app；Resources/node-runtime 中的 Node 在空环境、空 PATH 下输出 v24.18.0 |

构建产物：`dist/build-klaxkY/claude-code/`（本地生成目录，不提交）。
宿主应用：`../aibo/src-tauri/target/release/bundle/macos/Aibo.app`。

## 验证边界

- 本次真实配置探针未发送模型提示；真实写回合、审批、提问的旧验收不算本次重跑。
- 已有登录可以使用；未验收全新机器的认证引导，不宣称“无须登录”。
- Claude 包仍只声明 darwin-arm64。其他 OS/架构未验收，macOS 公证/发布签名也未验收。
- 桌面探针首次完成安装和能力调用后，在旧菜单空查询假设处失败；当前全局搜索空查询每组只显示五项。
  临时改为明确命令查询后能找到入口，但仍未命中 `section.installed-workbench` 视图断言。
  临时探针改动已撤回，未修改 UI 或降低原断言；因此完整双皮肤桌面验收未通过。
  原生安装、SDK 调用及 Rust 中失败升级/卸载回归有独立证据，不等同于 UI 验收。

## 后续修复：未指定模式的新建会话

0.4.0 用户安装后的失败记录为 `aibo.session.open / invalid_input`，保存的初始配置是 Ask。
用同一已安装包重放该配置得到 `Claude Code requires a supported interaction mode`；
只改为 Plan 后成功。此前的真实配置探针显式传了 Plan，未覆盖桌面入口的缺省配置。

宿主修复创建 IPC 对缺省 requestedProfile 的处理，并由 SessionHost 根据绑定 release 的
可用 mode 声明选择兼容只读初始模式。该插件会选择 Plan；不自动选择 Manual/Auto，
不替换明确请求的配置，不改写已有会话。插件 0.4.0 内容保持不变，修复需更新宿主。

新增回归：无 Ask 的通用 ACP fixture 通过真实宿主默认创建、发送及显式 Ask 拒绝检查；
`packaged_session_opens_with_implicit_profile` 用已安装 0.4.0 的副本在隔离数据库中执行
与桌面相同的 prepare/resume 链路（不传 Plan），真实会话成功打开，不发送模型提示。
桌面 IPC 探针为宿主 `probes/default-session-profile-native.mjs`。

另在反复原生构建时复现 macOS 对原地覆盖的 Node 资源返回 SIGKILL；同摘要的新文件可运行。
宿主构建改为在 Tauri 复制前移除旧的构建输出 Node 文件，避免沿用旧 inode。
这与用户记录的模式错误分别验证，不混为同一个根因。

后续验收结果：完整 Rust 回归 269 passed、3 ignored；真实包默认创建探针单独通过。
桌面 IPC 探针返回 `{ "ok": true, "pluginVersion": "0.4.0", "mode": "plan",
"deferred": true, "nativeOpen": true, "closed": true }`，证据为
`/tmp/aibo-default-session-profile-native.json`。这覆盖默认创建 IPC 与真实 ACP，
不替代前述旧双皮肤呈现探针的未通过项。
