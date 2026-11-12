/** Which settings the running service has, as yes or no: never a value, so the answer is safe to show anyone who asks. */
export interface ConfigReadiness {
  /** `ANTHROPIC_API_KEY` is set: trip notes can become a ledger and lyrics. */
  anthropic: boolean;
  /** `ELEVENLABS_API_KEY` is set. On Render only the Workflow task needs it, so false there can still be right. */
  elevenlabs: boolean;
  /** `PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET` are both set: an order can be created. */
  paypalClient: boolean;
  /** `FRIEND_PAYPAL_ACCOUNTS` names at least one account: a friend can be paid. */
  friendAccounts: boolean;
  /** `PAYPAL_WEBHOOK_ID` is set and looks like a webhook id (letters and digits), not the URL it is often mixed up with. */
  paypalWebhookId: boolean;
}

/** True when `value` looks like a PayPal webhook id: only letters and digits, so no URL or quoted copy passes. */
export function looksLikeWebhookId(value: string | undefined): boolean {
  return value !== undefined && /^[A-Za-z0-9]+$/.test(value);
}

/**
 * Say which settings are in place, from the process environment's values.
 *
 * @param env - The settings by name; a name that is unset or empty counts as missing.
 * @returns One yes or no per setting; nothing in it is a secret or a value.
 */
export function configReadiness(env: Readonly<Record<string, string | undefined>>): ConfigReadiness {
  const set = (name: string) => Boolean(env[name]);
  return {
    anthropic: set("ANTHROPIC_API_KEY"),
    elevenlabs: set("ELEVENLABS_API_KEY"),
    paypalClient: set("PAYPAL_CLIENT_ID") && set("PAYPAL_CLIENT_SECRET"),
    friendAccounts: set("FRIEND_PAYPAL_ACCOUNTS"),
    paypalWebhookId: looksLikeWebhookId(env["PAYPAL_WEBHOOK_ID"]),
  };
}
