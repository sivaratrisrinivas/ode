import { spawnSync } from "node:child_process";
import { describe, expect, it } from "vitest";

/** Run the hook as Claude Code does: the tool call as JSON on stdin; the exit code says whether the command is allowed. */
function exitCode(command: string): number | null {
  const run = spawnSync("node", ["scripts/block-self-matching-kill.ts"], { input: JSON.stringify({ tool_input: { command } }) });
  return run.status;
}

describe("the hook that blocks process-name kills that match their own shell", () => {
  it.each(["pkill -f dev-fake", "pkill -9 -f dev-fake", "pgrep -af node", "kill $(pgrep -f 'vitest run')", "cd ode; pkill --full node", "npm test && pkill -f x"])(
    "blocks %s",
    (command) => expect(exitCode(command)).toBe(2),
  );

  it.each(["pkill node", "pgrep node | head", "kill $(lsof -ti :3000)", "ps -eo pid,cmd | grep '[v]itest'", 'git commit -m "never pkill -f"', "ls -f"])(
    "allows %s",
    (command) => expect(exitCode(command)).toBe(0),
  );

  it("allows a call it cannot read", () => {
    const run = spawnSync("node", ["scripts/block-self-matching-kill.ts"], { input: "{}" });
    expect(run.status).toBe(0);
  });
});
