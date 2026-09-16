# aibo-plugins

Aibo 独立插件开发起点，包含一个能力插件和一个呈现插件。

- [插件开发文档](docs/plugin-development.md)
- [Cursor ACP 实现规格](docs/cursor-acp-spec.md) · [开发与验收 checklist](docs/cursor-acp-checklist.md)
- [能力插件](plugins/capability/)：读取能力、详情语义视图和刷新动作。
- [呈现插件](plugins/presentation/)：Ocean 主题和 AgentStatusMark Worker 控件，其他控件继承宿主。

## 快速开始

需要 Node.js 22+、pnpm、npm、tar，以及相邻的 `../aibo` 源码仓库。
先在 Aibo 仓库运行 `pnpm install`，然后在本项目运行：

```sh
pnpm run verify
```

本项目根目录没有第三方依赖，无需先安装。构建会从本地 Aibo 源码打包尚未公开发布的 SDK，离线安装到独立构建目录，并输出两个可安装目录的绝对路径。
自定义宿主位置：`AIBO_ROOT=/path/to/aibo pnpm run verify`。
每次构建创建独立 `dist/build-*` 目录；安装包不依赖宿主源码或开发路径。

在 Aibo 的能力插件管理入口安装输出的 `capability` 目录并启用；在呈现包管理入口安装 `presentation` 目录并选择该呈现。
构建和自动检查不能代替桌面端安装与交互验收。
