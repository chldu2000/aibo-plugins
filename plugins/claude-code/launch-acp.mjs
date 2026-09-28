import { accessSync, constants, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Use the host's executable search path, without executing a shell or searching the workspace. */
export function resolveClaudeExecutable(searchPath = process.env.PATH ?? '') {
  for (const directory of searchPath.split(path.delimiter)) {
    if (!path.isAbsolute(directory)) continue;
    const candidate = path.join(directory, 'claude');
    try {
      accessSync(candidate, constants.X_OK);
      if (statSync(candidate).isFile()) return realpathSync(candidate);
    } catch { /* Continue past missing, broken or non-executable entries. */ }
  }
  throw new Error('未找到 Claude Code。请先安装并登录 Claude Code，确保 claude 位于 Aibo 可搜索的 PATH 中，然后重试。');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    // This pinned ACP supports an explicit executable and otherwise searches for its bundled binary.
    process.env.CLAUDE_CODE_EXECUTABLE = resolveClaudeExecutable();
    await import('./vendor/node_modules/@agentclientprotocol/claude-agent-acp/dist/index.js');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
