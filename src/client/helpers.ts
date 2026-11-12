/**
 * Join the class names that are set into one `className`.
 *
 * @param parts - Class names, or `false`, `null` or `undefined` for one that does not apply.
 * @returns The names separated by spaces; `undefined` when none applies, so the attribute is left off.
 */
export function classNames(...parts: (string | false | null | undefined)[]): string | undefined {
  const names = parts.filter((part): part is string => typeof part === "string" && part !== "");
  return names.length > 0 ? names.join(" ") : undefined;
}

/**
 * Hold a fraction to the range 0 to 1.
 *
 * @returns `value` limited to 0 and 1 (infinities included); 0 for NaN.
 */
export function clamp01(value: number): number {
  if (Number.isNaN(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
