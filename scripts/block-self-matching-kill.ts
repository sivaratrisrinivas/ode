/**
 * A Claude Code `PreToolUse` hook for `Bash`. `pkill -f` and `pgrep -f` match against full command lines, and the
 * command line of the shell running them contains the pattern, so they match that shell and kill it. Exits 2 with the
 * way to stop a process instead; exits 0 for any other command.
 */

const SELF_MATCHING = /\b(pkill|pgrep)\b[^|;&\n]*\s(-[a-zA-Z]*f[a-zA-Z]*|--full)(\s|$)/;

let text = "";
for await (const chunk of process.stdin) text += chunk;
const input: unknown = JSON.parse(text || "{}");
const toolInput = typeof input === "object" && input !== null ? Reflect.get(input, "tool_input") : undefined;
const command = typeof toolInput === "object" && toolInput !== null ? Reflect.get(toolInput, "command") : undefined;

if (typeof command === "string" && SELF_MATCHING.test(command)) {
  console.error('`pkill -f` and `pgrep -f` match the shell running them and kill it. Stop a server with `kill $(lsof -ti :PORT)`; find a process with `ps -eo pid,cmd | grep "[p]attern"` (the brackets keep grep from matching itself).');
  process.exit(2);
}
