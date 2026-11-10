import { describe, expect, it } from "vitest";
import { Redacted } from "../src/server/redacted.ts";
import { parseWorkflowConfig } from "../src/server/workflow-config.ts";
import { parseTaskConfig } from "../src/workflow/task-config.ts";

describe("which Workflow the web service uses", () => {
  it("uses the Render Workflow when both its API key and workflow slug are set, keeping the key out of logs", () => {
    const config = parseWorkflowConfig({ RENDER_API_KEY: "rnd_key", ODE_WORKFLOW_SLUG: "ode-workflow", RENDER: "true" });

    if (config._tag === "err" || config.value._tag !== "Render") throw new Error(`expected the Render Workflow, got ${JSON.stringify(config)}`);
    expect(config.value.workflowSlug).toBe("ode-workflow");
    expect(Redacted.reveal(config.value.apiKey)).toBe("rnd_key");
    expect(JSON.stringify(config)).not.toContain("rnd_key");
  });

  it("runs the job in the web service process off Render, when neither is set, for development", () => {
    expect(parseWorkflowConfig({})).toEqual({ _tag: "ok", value: { _tag: "InProcess" } });
  });

  it.each([
    ["on Render with neither set", { RENDER: "true" }, ["RENDER_API_KEY", "ODE_WORKFLOW_SLUG"]],
    ["on Render with only the slug", { RENDER: "true", ODE_WORKFLOW_SLUG: "ode-workflow" }, ["RENDER_API_KEY"]],
    ["off Render with only the API key", { RENDER_API_KEY: "rnd_secret_value" }, ["ODE_WORKFLOW_SLUG"]],
    ["with empty values", { RENDER_API_KEY: "", ODE_WORKFLOW_SLUG: "", RENDER: "true" }, ["RENDER_API_KEY", "ODE_WORKFLOW_SLUG"]],
  ])("does not quietly fall back to running in the web service %s", (_case, env, missing) => {
    const config = parseWorkflowConfig(env);

    if (config._tag === "ok") throw new Error(`expected a configuration error, got ${JSON.stringify(config.value)}`);
    for (const name of missing) expect(config.error.message).toContain(name);
    // A message is logged at startup: it names what is missing, never a value.
    expect(config.error.message).not.toContain("rnd_secret_value");
  });
});

describe("what the Workflow task reads from its environment", () => {
  const complete = { DATABASE_URL: "postgres://user:hunter2@db/ode", ANTHROPIC_API_KEY: "sk-ant-x", ELEVENLABS_API_KEY: "xi-x" };

  it("reads the database URL and the two API keys, keeping all three out of logs", () => {
    const config = parseTaskConfig(complete);

    if (config._tag === "err") throw config.error;
    expect(Redacted.reveal(config.value.databaseUrl)).toBe("postgres://user:hunter2@db/ode");
    expect(Redacted.reveal(config.value.anthropicApiKey)).toBe("sk-ant-x");
    expect(Redacted.reveal(config.value.elevenLabsApiKey)).toBe("xi-x");
    expect(JSON.stringify(config)).not.toMatch(/hunter2|sk-ant-x|xi-x/);
  });

  it("names every variable that is missing or empty, and none of the values", () => {
    const config = parseTaskConfig({ DATABASE_URL: "postgres://user:hunter2@db/ode", ANTHROPIC_API_KEY: "" });

    if (config._tag === "ok") throw new Error("expected a configuration error");
    expect(config.error.message).toContain("ANTHROPIC_API_KEY");
    expect(config.error.message).toContain("ELEVENLABS_API_KEY");
    expect(config.error.message).not.toContain("DATABASE_URL");
    expect(config.error.message).not.toContain("hunter2");
  });
});
