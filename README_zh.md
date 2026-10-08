# Aibo Plugins

**接入更多 Agent，扩展能力，定制你的工作台。**

[English](README.md) | [简体中文](README_zh.md)

将 Cursor、Claude Code 接入 [Aibo](https://github.com/chldu2000/aibo)，
为兼容 ACP 的 Agent 创建集成，或从示例开始添加工具能力、定制界面。

[安装插件](docs/installation.md) · [开发扩展](docs/plugin-development.md) · [文档导航](docs/README.md)

## 找到需要的插件或开发起点

| 项目 | 用途 | 从这里开始 |
| --- | --- | --- |
| Cursor | 通过官方 `agent acp` 接入 Cursor Agent 会话 | [接入与功能说明](plugins/cursor/README.md) |
| Claude Code | 接入 Claude Code，展示工具活动、审批、提问和原生报告的订阅额度 | [接入与功能说明](plugins/claude-code/README.md) |
| ACP Agent 模板 | 为兼容 ACP 的 Agent 创建配置式接入 | [修改模板](plugins/acp-template/README.md) |
| 能力示例 | 只读操作、详情视图和刷新动作 | [查看示例](plugins/capability/README.md) |
| 呈现示例 | Ocean 主题与 Agent 状态控件，其余控件继承宿主 | [查看示例](plugins/presentation/README.md) |

功能取决于原生实现、模型与实际协商结果。ACP 模板需要配置后才能使用，Agent 专用扩展可能需要编写代码。

## 安装使用

需要兼容的 **Aibo 桌面构建**、**构建好的插件目录**和对应 Agent 的原生依赖。
安装准备好的插件包不需要检出源码，也不执行 npm。

1. 阅读[兼容表](docs/installation.md#compatibility)，准备 Agent CLI 与登录状态。
2. Agent 或能力插件：在能力插件管理入口安装含 `plugin.json` 的构建目录，再启用插件。
3. 呈现包：点击 **安装皮肤插件**，选择含 `presentation.json` 的目录，再选中该呈现。
4. 创建新会话，验证刚安装的 Agent 版本。

本仓库提供本地构建产物的安装流程。没有准备好的包时，按[源码构建步骤](docs/installation.md#build-from-source)操作。
源码目录不能直接代替构建包，这个流程也不支持直接粘贴 Git 仓库地址安装。

## 构建与开发

需要 Node.js 22+、pnpm、npm 和 tar。测试使用匹配的 Aibo 源码，默认位置为相邻的 `../aibo`，
先在宿主仓库安装依赖。当前源码组合使用：

```sh
pnpm install
pnpm prepare:deps
AIBO_SDK=local pnpm run verify
```

当前 Claude Code 插件需要宿主 SDK 0.1.10，宿主登记的已发布 SDK 基线为 0.1.8。
`AIBO_SDK=local` 使用匹配宿主源码构建 SDK，安装目标也必须包含对应宿主功能。
详细要求见[兼容与构建指南](docs/installation.md)。

每次构建在新的 `dist/build-*` 下输出五个安装目录。ACP 模板需要先改为真实 Agent 配置。
运行时 SDK 由 Aibo 提供，插件所需的第三方依赖在构建时打包。

开发流程见[插件开发文档](docs/plugin-development.md)，接入 Agent 可以从 [ACP 模板](plugins/acp-template/README.md)开始。

## 参与完善

遇到问题时，在 [issue](https://github.com/chldu2000/aibo-plugins/issues) 中提供 Aibo 构建、系统与架构、
插件和 CLI 版本、复现步骤及脱敏错误。修改适配器或添加集成前，请阅读[贡献指南](CONTRIBUTING.md)。

本仓库采用 [MIT 许可证](LICENSE)。打包依赖与第三方标识遵循各自的许可证和权利归属。
