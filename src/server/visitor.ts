import { randomUUID } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
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

/** A visitor ID nobody has had. */
function newVisitorId(): VisitorId {
  const visitor = parseVisitorId(randomUUID());
  // Defect: randomUUID always returns a lower-case UUID.
  if (visitor._tag === "err") throw visitor.error;
  return visitor.value;
}

/** The cookie that names the visitor's copy. */
export const VISITOR_COOKIE = "ode_visitor";

/** A year, so a judge who comes back later finds the copy as they left it. */
const COOKIE_MAX_AGE_S = 365 * 24 * 60 * 60;

/** What the middleware puts on the request for the handlers behind it. */
export interface VisitorEnv {
  Variables: { visitor: VisitorId };
}

/**
 * Tell each request which visitor it comes from. A request with a valid visitor cookie is that visitor; one with none,
 * or with one that is not a visitor ID (cleared, or made up), is a new visitor, and the response sets their cookie. It
 * runs on every request, the page's own among them, so the cookie is set before the page asks the API for anything.
 */
export const visitorMiddleware = createMiddleware<VisitorEnv>(async (c, next) => {
  const known = parseVisitorId(getCookie(c, VISITOR_COOKIE));
  const visitor = known._tag === "ok" ? known.value : newVisitorId();
  if (known._tag === "err") {
    setCookie(c, VISITOR_COOKIE, visitor, {
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
      maxAge: COOKIE_MAX_AGE_S,
      secure: c.req.header("x-forwarded-proto") === "https" || new URL(c.req.url).protocol === "https:",
    });
  }
  c.set("visitor", visitor);
  await next();
});
