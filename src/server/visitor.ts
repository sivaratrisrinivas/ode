import { randomUUID } from "node:crypto";
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { parseVisitorId, type VisitorId } from "./visitor-id.ts";

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
