/**
 * What a private token looks like: two UUIDs' hex digits. The one place the shape is written, for the schema that generates
 * tokens and the stores that refuse a malformed one before it reaches a query.
 */
const TOKEN_SHAPE = /^[0-9a-f]{64}$/;

/** The SQL default that generates a token in the schema: two random UUIDs, 244 bits, so a token cannot be guessed. */
export const TOKEN_DEFAULT_SQL = "replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '')";

/**
 * Whether the text has the shape of a token the schema generates. A malformed token holds nothing, and a stray NUL byte would
 * make the database refuse the query, so a store asks this before looking one up.
 *
 * @param text - Untrusted: from a link or a request.
 */
export function isTokenShaped(text: string): boolean {
  return TOKEN_SHAPE.test(text);
}
