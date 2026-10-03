// ACP 0.81.2 forwards only a command's name, description and input hint; the SDK's
// `builtin` marker is dropped. Claude Code tags skill origins in description suffixes
// and namespaces plugin skills as `<plugin>:<skill>`. Other parenthesised suffixes
// occur on builtin commands (`/fast`, `/clear`), so only known origins count.
const SKILL_ORIGIN = /\((?:project|user|claude\.ai sync)\)$/;

export function claudeCommandCategory(command) {
  if (typeof command?.name !== 'string') return 'agent';
  if (typeof command.description === 'string' && SKILL_ORIGIN.test(command.description)) return 'skill';
  // ACP renames MCP prompts to `mcp:<name>`; they are not skills.
  return command.name.includes(':') && !command.name.startsWith('mcp:') ? 'skill' : 'agent';
}
