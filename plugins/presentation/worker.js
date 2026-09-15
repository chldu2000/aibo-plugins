// 自包含 Worker：只返回视觉树，业务操作由宿主执行。
self.aiboPresentation = {
  render(input) {
    if (input.surface !== 'controls' || input.data.control !== 'AgentStatusMark') return null;
    const { label, tone } = input.data.props;
    return {
      tag: 'span', key: 'agent-status', text: label,
      className: `status status-${tone}`,
    };
  },
};
