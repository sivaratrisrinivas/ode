import { err, ok, type Result } from "./result.ts";

/** Names a value of type `T` that only a parser can produce. */
type Brand<T, Name extends string> = T & { readonly __brand: Name };

/** Identifies one browser: the owner of one copy of the Seeded Ode's payment state. */
export type VisitorId = Brand<string, "VisitorId">;

/** The text is not a visitor ID. */
export class InvalidVisitorId extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "InvalidVisitorId" as const;

  /** Takes no arguments: the message says what a visitor ID looks like. */
  constructor() {
    super("A visitor ID is a UUID");
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Parse a visitor ID from a cookie or a stored row.
 *
 * @param input - Anything; only a lower-case UUID string is a visitor ID.
 * @returns The visitor ID, or `InvalidVisitorId`.
 */
export function parseVisitorId(input: unknown): Result<VisitorId, InvalidVisitorId> {
  if (typeof input !== "string" || !UUID.test(input)) return err(new InvalidVisitorId());
  // SAFETY: TypeScript cannot express the brand. The check above is the only way to get here, and callers cannot build a VisitorId otherwise.
  return ok(input as VisitorId);
}
