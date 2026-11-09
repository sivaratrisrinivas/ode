import { err, ok, type Result } from "./result.ts";

/** Longest trip notes accepted; keeps one request's Claude cost bounded. */
export const MAX_NOTES_LENGTH = 20_000;

/** Trip notes the payer pasted: trimmed, non-empty and within the length limit. */
export type TripNotes = string & { readonly __brand: "TripNotes" };

/** The pasted text cannot be used as trip notes. */
export class InvalidTripNotes extends Error {
  readonly _tag = "InvalidTripNotes" as const;

  constructor(reason: "missing" | "too-long") {
    super(
      reason === "missing"
        ? "Paste your trip notes first."
        : `Trip notes are too long. Keep them under ${MAX_NOTES_LENGTH} characters.`,
    );
  }
}

/**
 * Parse untrusted input into trip notes.
 *
 * @param input - The `notes` field of a request body.
 * @returns The trimmed notes, or `InvalidTripNotes` when empty, not text, or too long.
 */
export function parse(input: unknown): Result<TripNotes, InvalidTripNotes> {
  const text = typeof input === "string" ? input.trim() : "";
  if (text === "") return err(new InvalidTripNotes("missing"));
  if (text.length > MAX_NOTES_LENGTH) return err(new InvalidTripNotes("too-long"));
  // SAFETY: TypeScript cannot express the brand; the checks above are the only path to a TripNotes.
  return ok(text as TripNotes);
}
