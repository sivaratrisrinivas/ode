import type { Context } from "hono";
import { parseByteRange } from "./byte-range.ts";

/**
 * Answer a request with MP3 bytes, honouring a `Range` header so players can seek: 200 for everything, 206 for a range,
 * 416 for a range past the end.
 *
 * @param c - The request being answered.
 * @param audio - The bytes to serve.
 */
export function audioResponse(c: Context, audio: Uint8Array): Response {
  const headers = { "content-type": "audio/mpeg", "accept-ranges": "bytes" };
  const range = parseByteRange(c.req.header("range"), audio.byteLength);
  if (range._tag === "err") return c.body(null, 416, { ...headers, "content-range": `bytes */${audio.byteLength}` });
  // A copy, because a response body must be backed by a plain ArrayBuffer and the database's bytes may not be.
  if (range.value === undefined) return c.body(new Uint8Array(audio), 200, { ...headers, "content-length": String(audio.byteLength) });

  const { start, end } = range.value;
  return c.body(new Uint8Array(audio.subarray(start, end + 1)), 206, {
    ...headers,
    "content-length": String(end - start + 1),
    "content-range": `bytes ${start}-${end}/${audio.byteLength}`,
  });
}
