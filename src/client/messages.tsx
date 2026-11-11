import type { ReactElement } from "react";

/** What the page says when a request never got an answer. */
export const UNREACHABLE = "Couldn’t reach Ode. Check your connection and try again.";

/** The `error` message of a failed API response, or a generic one. */
export async function failureMessage(res: Response): Promise<string> {
  const body: unknown = await res.json().catch(() => undefined);
  const error = typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
  return typeof error === "string" ? error : "Something went wrong. Try again.";
}

/** A list of warnings under a field; nothing when there are none. */
export function Warnings({ messages }: { messages: readonly string[] }): ReactElement | null {
  if (messages.length === 0) return null;
  return (
    <ul style={{ color: "#8a4b00", margin: "0.25rem 0 0", paddingLeft: "1.25rem" }}>
      {messages.map((message) => (
        <li key={message}>{message}</li>
      ))}
    </ul>
  );
}
