/** An expected outcome as a value: success, or a failure the caller must handle. */
export type Result<T, E> =
  | { readonly _tag: "ok"; readonly value: T }
  | { readonly _tag: "err"; readonly error: E };

/** Wrap a success value. */
export function ok<T>(value: T): Result<T, never> {
  return { _tag: "ok", value };
}

/** Wrap an expected failure. */
export function err<E>(error: E): Result<never, E> {
  return { _tag: "err", error };
}
