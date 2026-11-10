import { Redacted } from "../server/redacted.ts";
import { err, ok, type Result } from "../server/result.ts";

/** What the Workflow task needs from its environment: the same variables the web service uses. All three are secrets. */
export interface TaskConfig {
  readonly databaseUrl: Redacted<string>;
  readonly anthropicApiKey: Redacted<string>;
  readonly elevenLabsApiKey: Redacted<string>;
}

/** The task's environment lacks a variable it needs. */
export class MissingTaskConfig extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "MissingTaskConfig" as const;

  /** The names of the variables that are missing or empty; never their values. */
  readonly missing: readonly string[];

  /** @param missing - The names of the variables that are missing or empty; never their values. */
  constructor(missing: readonly string[]) {
    super(`The Ode task is missing ${missing.join(", ")}: set them on the Workflow service.`);
    this.missing = missing;
  }
}

/**
 * Read the task's settings from its environment. The task calls this when a run starts, never when
 * its file is loaded: Render loads the file to register the task, and that must not need any secret.
 *
 * @param env - The process environment: `DATABASE_URL`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`.
 * @returns The settings, or `MissingTaskConfig` naming each variable that is missing or empty.
 */
export function parseTaskConfig(env: Readonly<Record<string, string | undefined>>): Result<TaskConfig, MissingTaskConfig> {
  const databaseUrl = env["DATABASE_URL"];
  const anthropicApiKey = env["ANTHROPIC_API_KEY"];
  const elevenLabsApiKey = env["ELEVENLABS_API_KEY"];
  if (databaseUrl && anthropicApiKey && elevenLabsApiKey) {
    return ok({
      databaseUrl: new Redacted(databaseUrl),
      anthropicApiKey: new Redacted(anthropicApiKey),
      elevenLabsApiKey: new Redacted(elevenLabsApiKey),
    });
  }

  const settings = { DATABASE_URL: databaseUrl, ANTHROPIC_API_KEY: anthropicApiKey, ELEVENLABS_API_KEY: elevenLabsApiKey };
  const missing = Object.entries(settings).flatMap(([name, value]) => (value ? [] : [name]));
  return err(new MissingTaskConfig(missing));
}
