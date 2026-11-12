import { err, ok, type Result } from "../server/result.ts";

/** Variables a command cannot run without are not set (or are empty). */
export class MissingEnv extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "MissingEnv" as const;

  /** The names that were missing, in the order asked for. */
  readonly names: readonly string[];

  /** @param names - The variables that are not set. Only their names go in the message, never a value. */
  constructor(names: readonly string[]) {
    super(`${names.join(", ")} ${names.length === 1 ? "is" : "are"} not set; put ${names.length === 1 ? "it" : "them"} in .env or run with node --env-file=<path to .env>`);
    this.names = names;
  }
}

/**
 * Read the variables an operator command needs, all at once so one run names everything that is missing.
 *
 * @param names - The variables required.
 * @param env - Where to read them from; the process environment by default.
 * @returns Every variable's value by name, or `MissingEnv` naming each that is unset or empty. The caller decides how the
 *   command ends: the scripts print the message and exit non-zero.
 */
export function readEnv<const Name extends string>(names: readonly Name[], env: Readonly<Record<string, string | undefined>> = process.env): Result<Record<Name, string>, MissingEnv> {
  const missing = names.filter((name) => !env[name]);
  if (missing.length > 0) return err(new MissingEnv(missing));
  // SAFETY: the check above found every name set and non-empty, so each key of the record holds a string.
  return ok(Object.fromEntries(names.map((name) => [name, env[name]])) as Record<Name, string>);
}
