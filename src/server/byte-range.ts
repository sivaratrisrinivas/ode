import { err, ok, type Result } from "./result.ts";

/** The part of a body to send, as inclusive byte offsets, `start <= end < size`. */
export interface ByteRange {
  /** First byte to send. */
  readonly start: number;
  /** Last byte to send (inclusive). */
  readonly end: number;
}

/** The requested range lies past the end of the body. */
export class RangeNotSatisfiable extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "RangeNotSatisfiable" as const;
  /** The body's length, which a 416 reply reports. */
  readonly size: number;

  /** @param size - The body's length in bytes. */
  constructor(size: number) {
    super(`The requested range is past the end of the ${size} bytes`);
    this.size = size;
  }
}

/**
 * Read a `Range` header for a body of `size` bytes. Browsers ask for ranges to seek in audio, and
 * Safari will not play audio without them. Only one `bytes=` range is served; a missing, malformed
 * or multiple range gets the whole body, which HTTP allows.
 *
 * @param header - The `Range` header, if the request had one.
 * @param size - The body's length in bytes.
 * @returns The range to send, undefined to send everything, or `RangeNotSatisfiable`.
 */
export function parseByteRange(header: string | undefined, size: number): Result<ByteRange | undefined, RangeNotSatisfiable> {
  const match = header === undefined ? null : /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  const first = match?.[1];
  const second = match?.[2];
  if (first === undefined || second === undefined || (first === "" && second === "")) return ok(undefined);

  if (first === "") {
    // "bytes=-N": the last N bytes.
    const length = Number(second);
    return length === 0 || size === 0 ? err(new RangeNotSatisfiable(size)) : ok({ start: Math.max(0, size - length), end: size - 1 });
  }
  const start = Number(first);
  if (start >= size) return err(new RangeNotSatisfiable(size));
  const end = second === "" ? size - 1 : Math.min(Number(second), size - 1);
  return end < start ? ok(undefined) : ok({ start, end });
}
