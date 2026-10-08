# Claude Code 额度映射验证

日期：2026-10-08。基线：Aibo `50b32ac`、插件仓库 `e42e58c`，加本次未提交改动；Darwin arm64，Node v24.18.0。

## 版本及产物

- cc 插件：0.4.7；ACP：0.81.2；最低外部 Claude CLI：2.1.280（声明要求，本次未运行真实模型）。
- 配套宿主 SDK：0.1.10，未发布；三个运行时 SDK 包与嵌入快照同步升级。
- 共享外部工作台：0.2.3；Material 3 / shadcn 外部呈现：0.4.2。
- 本地插件安装目录：`dist/build-EEvc2B/claude-code/`。本次未安装、未发布，也未修改用户现用插件。
- 宿主完成前端生产构建与原生库编译/测试；未生成新的 macOS `.app` / DMG。插件必须配合包含本改动的宿主使用。

## 执行结果

| 仓库 / 命令 | 结果与证明范围 |
| --- | --- |
| Aibo：`pnpm run verify` | 通过；569 项测试、迁移/SDK/架构/类型检查及前端生产构建通过。构建仍有大 chunk 提示。 |
| 插件：`AIBO_SDK=local pnpm run verify` | 通过；53 项测试、各插件本地 SDK 构建和打包 smoke 通过。Claude smoke 验证实际打包 Worker 初始化、外部 CLI 委托及 ACP initialize，不发送模型请求。 |
| Aibo：`cargo test --lib` | 308 通过、0 失败、4 ignored；包括嵌入 SDK、安装与原生会话相邻行为。 |
| Aibo：`node probes/session-usage-browser.mjs` | 通过；实际 App 事件处理、缓存和状态栏，Material 3 / ak-ui 浅深主题，到期自动变未知、背景会话清理、上下文/token 保留。事件由探针注入。 |
| Aibo：`node probes/presentation-full-skins-browser.mjs` | 通过；实际 App 与独立构建的两套外部呈现 Worker，新增额度到期显示和未知重置时间断言，连同原有交互/换肤/故障回退回归。原生 IPC 为替身。 |

首次受限运行的本机监听及进程测试因沙箱权限失败；获得工具自动审批后在沙箱外重跑，以上为最终成功结果。无需访问账号或发送付费模型请求。

## 覆盖的额度语义

- 多窗口优先、旧版单窗口回退；0 和 1 边界，非数值/非有限/越界比例忽略。
- 仅支持已知订阅窗口，不从 rejected 状态推算 100%，不展示额外付费窗口。
- 缺少窗口时保留旧观测，后续上下文和回合 token 更新不覆盖额度。
- 当前会话验证、空闲更新、历史回放忽略、旧 transport 事件丢弃、重连不恢复额度。
- 过期不假定全部恢复；无重置时间仍显示最近比例并标记时间未知。
- 外部 wire 的数值 `limits` 合同保持，过期窗口经新增 `unknownLimits` 传递，旧呈现不会将空值当作 0% 已用。

## 未验证边界

- 未抓取真实 Claude 登录账号的 rate-limit 事件，不能保证每个账号、模型或响应都返回完整窗口。
- 未验证真实桌面中安装新版宿主和 cc 插件后的账号端到端显示。
- SDK 尚未发布，registry 构建不作为本次成功结论；本次使用本地 SDK 源码构建。

产品规则见 [额度规格](claude-quota-spec.md)。
