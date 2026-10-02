# aibo-plugins

Aibo 独立插件开发项目，包含 Cursor Agent、Claude Code、ACP Agent 模板、一个能力示例和一个呈现示例。

- [插件开发文档](docs/plugin-development.md)
- [Cursor ACP 实现规格](docs/cursor-acp-spec.md) · [开发与验收 checklist](docs/cursor-acp-checklist.md) · [验证记录](docs/cursor-acp-validation.md)
- [Cursor Agent 插件](plugins/cursor/)：通过官方 `agent acp` 接入本地 Cursor 会话。
- [Claude Code](plugins/claude-code/)：携带 ACP 与 JavaScript 依赖，通过轻量启动器调用用户安装的 Claude Code。
- [ACP Agent 模板](plugins/acp-template/)：支持 ACP 的 Agent 只写 `plugin.json` 与 `acp.json` 即可接入，无需代码。
- [能力插件](plugins/capability/)：读取能力、详情语义视图和刷新动作。
- [呈现插件](plugins/presentation/)：Ocean 主题和 AgentStatusMark Worker 控件，其他控件继承宿主。

## 快速开始

需要 Node.js 22+、pnpm、npm、tar。测试与 smoke 用宿主的 SDK resolver 模拟插件运行时，
因此还需要相邻的 `../aibo` 源码仓库（先在其中运行 `pnpm install`）。在本项目运行：

```sh
pnpm install
pnpm prepare:deps
pnpm run verify
```

`prepare:deps` 按 lockfile 准备 Claude ACP 构建依赖缓存；用户安装插件不执行 npm。构建按各插件的
`package-lock.json` 从 npm 安装 `@aibolabs/*` SDK（项目 `.npmrc` 把该 scope 固定到 `https://registry.npmjs.org/`，
其他包仍使用你配置的镜像），在独立构建目录中编译打包，并输出五个可安装目录的绝对路径。
自定义宿主位置：`AIBO_ROOT=/path/to/aibo pnpm run verify`；改用宿主源码中尚未发布的 SDK：`AIBO_SDK=local pnpm run verify`。
每次构建创建独立 `dist/build-*` 目录；安装包不依赖宿主源码或开发路径，也不携带 Aibo SDK。插件导入 `@aibolabs/*` 并声明 `hostSdk.min` 0.1.8，需要宿主 SDK 0.1.8 及以上的 Aibo；旧宿主需先升级。

在 Aibo 的能力插件管理入口安装输出的 `cursor` 或 `capability` 目录并启用；在呈现包管理入口安装 `presentation` 目录并选择该呈现。Cursor 插件需要预先安装 Cursor CLI，并运行 `agent login`。
构建和自动检查不能代替桌面端安装与交互验收。
