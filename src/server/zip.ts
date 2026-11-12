import { inflateRawSync } from "node:zlib";
import { err, ok, type Result } from "./result.ts";

/** One file in a ZIP archive. */
export interface ZipEntry {
  readonly name: string;
  readonly data: Uint8Array;
}

/** The archive is not a ZIP this reader understands: damaged, cut short, ZIP64 or compressed some other way than stored or deflated. */
export class UnreadableZip extends Error {
  /** Identifies this error in a union. */
  readonly _tag = "UnreadableZip" as const;

  /** @param reason - What was wrong with the archive. */
  constructor(reason: string) {
    super(`unreadable ZIP archive: ${reason}`);
  }
}

const END_OF_DIRECTORY = 0x06054b50;
const DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_ENTRY = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

/**
 * Read the files of a ZIP archive, from its central directory (the only part that is always right, whether or not entries
 * carry data descriptors). ElevenLabs' stem separation replies with one.
 *
 * @param zip - The archive's bytes.
 * @returns Every file in the archive, directories left out; or why the archive could not be read.
 */
export function readZip(zip: Uint8Array): Result<ZipEntry[], UnreadableZip> {
  const view = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  // The end record is the last 22 bytes unless a comment follows it, so look back for its signature.
  let end = zip.byteLength - 22;
  while (end >= 0 && view.getUint32(end, true) !== END_OF_DIRECTORY) end -= 1;
  if (end < 0) return err(new UnreadableZip("no end-of-directory record"));

  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  const entries: ZipEntry[] = [];
  for (let index = 0; index < count; index += 1) {
    if (at + 46 > zip.byteLength || view.getUint32(at, true) !== DIRECTORY_ENTRY) return err(new UnreadableZip("a directory entry is damaged"));
    const method = view.getUint16(at + 10, true);
    const compressedSize = view.getUint32(at + 20, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const localAt = view.getUint32(at + 42, true);
    const name = new TextDecoder().decode(zip.subarray(at + 46, at + 46 + nameLength));
    at += 46 + nameLength + extraLength + commentLength;
    if (name.endsWith("/")) continue;

    if (localAt + 30 > zip.byteLength || view.getUint32(localAt, true) !== LOCAL_ENTRY) return err(new UnreadableZip(`${name} has no data`));
    const start = localAt + 30 + view.getUint16(localAt + 26, true) + view.getUint16(localAt + 28, true);
    const stored = zip.subarray(start, start + compressedSize);
    if (stored.byteLength !== compressedSize) return err(new UnreadableZip(`${name} is cut short`));
    if (method === STORED) entries.push({ name, data: stored });
    else if (method === DEFLATED) {
      try {
        entries.push({ name, data: new Uint8Array(inflateRawSync(stored)) });
      } catch {
        // zlib throws on damaged data; that is this archive being unreadable, as a value.
        return err(new UnreadableZip(`${name} is damaged`));
      }
    } else return err(new UnreadableZip(`${name} uses compression method ${method}`));
  }
  return ok(entries);
}
