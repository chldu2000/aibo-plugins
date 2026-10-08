# 插件文档导航

[English catalog](../README.md) · [中文目录](../README_zh.md) · [Aibo](https://github.com/chldu2000/aibo)

## 使用插件

- [安装与兼容性](installation.md)：准备好的包如何安装，当前版本要求，源码构建与问题排查。
- [Cursor](../plugins/cursor/README.md)：首次会话、模式、模型、图片与恢复限制。
- [Claude Code](../plugins/claude-code/README.md)：首次会话、授权、审批、后台任务、额度与恢复限制。

## 开发扩展

- [开发指南](plugin-development.md)：环境、打包、SDK、合同与验证。
- [ACP Agent 模板](../plugins/acp-template/README.md)：通过配置接入兼容 Agent。
- [能力示例](../plugins/capability/README.md)：只读操作与语义视图。
- [呈现示例](../plugins/presentation/README.md)：主题与控件默认继承。
- [参与贡献](../CONTRIBUTING.md)：报告问题和提交改动。

## 实现规格与验收证据

以下文档面向维护者；验证记录描述当时的版本和环境，不代表所有后续版本或平台已通过。

- Cursor：[实现规格](cursor-acp-spec.md)、[验收清单](cursor-acp-checklist.md)、[验证记录](cursor-acp-validation.md)、[集成研究](cursor-integration-research.md)。
- Claude Code：[外部运行时验证](claude-external-runtime-validation.md)、[额度规格](claude-quota-spec.md)、[额度验证](claude-quota-validation.md)。
- [自包含运行时历史验证](self-contained-runtime-validation.md)：早期打包方案的记录；当前安装要求以插件 README 为准。
- 插件变更记录：[Cursor](../plugins/cursor/CHANGELOG.md)、[Claude Code](../plugins/claude-code/CHANGELOG.md)。
