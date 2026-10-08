# Presentation example

Customize Aibo with an Ocean theme and an AgentStatusMark control. Other controls inherit the
host implementation. This example does not replace the full workbench or semantic renderer.

## Try it

Follow the [build guide](../../docs/installation.md#build-from-source). In Aibo, choose
**安装皮肤插件**, select the emitted `presentation/` directory containing `presentation.json`,
then select the installed presentation. Check the Ocean theme, status label, and inherited controls.

The source manifest is [presentation.source.json](presentation.source.json). The build generates
resource sizes and hashes; install the generated package, not this source directory.

## Make it yours

Edit the theme and [worker.js](worker.js). Return the restricted visual tree expected by the host,
using its current action tokens. Returning null for an unimplemented control inherits the host control.
See [the development guide](../../docs/plugin-development.md#修改呈现示例) and the
[host presentation contract](https://github.com/chldu2000/aibo/blob/main/docs/presentation-package.md).
