/**
 * A secret (an API key, a database URL with its password) that cannot leak by accident: logging it, interpolating
 * it into a message or serializing it prints a placeholder. Only `reveal` returns the value, so a secret is
 * unwrapped where it is used, inside the adapter that makes the call.
 *
 * @template T - The type of the secret.
 */
export class Redacted<T> {
  readonly #value: T;

  /** @param value - The secret; wrap it where it is read from the environment. */
  constructor(value: T) {
    this.#value = value;
  }

  /**
   * The secret itself. Call it only where the raw value is needed, such as when constructing an API client.
   *
   * @template T - The type of the secret.
   * @param secret - The wrapped secret.
   * @returns The secret.
   */
  static reveal<T>(secret: Redacted<T>): T {
    return secret.#value;
  }

  /** The placeholder, never the secret. */
  toString(): string {
    return "<redacted>";
  }

  /** The placeholder, never the secret, so JSON logs do not carry it. */
  toJSON(): string {
    return "<redacted>";
  }
}
