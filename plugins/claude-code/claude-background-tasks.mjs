/** AIR async tasks describe non-agent background work; subagents use a separate lifecycle. */
export function claudeBackgroundNotification(session, message) {
  if (message.method !== 'session/update' || message.params?.sessionId !== session.sessionId || session.phase === 'loading') return false;
  const update = message.params.update;
  if (!['async_task_spawned','async_task_progress','async_task_state_update'].includes(update?.sessionUpdate)) return false;
  const id = update.asyncTaskId;
  if (typeof id !== 'string' || !id) return true;
  const tool = session.tools.get(update.toolCallId);
  const task = { id };
  if (update.sessionUpdate === 'async_task_spawned') {
    task.name = update.name || update.description || '后台命令';
    task.status = 'running';
  }
  if (typeof tool?.rawInput?.command === 'string') task.command = tool.rawInput.command;
  if (typeof update.summary === 'string') task.activity = update.summary;
  if (typeof update.outputFilePath === 'string') task.outputPath = update.outputFilePath;
  if (update.sessionUpdate === 'async_task_state_update') task.status = ({running:'running',completed:'completed',failed:'failed',stopped:'stopped',cancelled:'stopped'})[update.state] ?? 'unknown';
  session.updateBackgroundTask(task);
  return true;
}
