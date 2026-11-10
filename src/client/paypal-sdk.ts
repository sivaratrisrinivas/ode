/** What the page uses of PayPal's Buttons: the popup that asks the payer to approve an order. */
export interface PayPalButtons {
  render(container: HTMLElement): Promise<void>;
  close(): Promise<void>;
}

/** The options the page gives PayPal's Buttons. */
export interface PayPalButtonsOptions {
  /** Decides whether the popup opens: `actions.reject()` keeps it closed. */
  onClick(data: unknown, actions: { resolve(): Promise<void>; reject(): Promise<void> }): Promise<void>;
  /** Makes the order the popup asks the payer to approve; throwing closes the popup. */
  createOrder(): Promise<string>;
  /** The payer approved the order in the popup. */
  onApprove(data: { orderID: string }): Promise<void>;
  /** The payer closed the popup. */
  onCancel(): void;
  /** The popup failed. */
  onError(error: unknown): void;
}

/** The part of PayPal's page script that the page uses. */
export interface PayPalSdk {
  Buttons(options: PayPalButtonsOptions): PayPalButtons;
}

function isSdk(value: unknown): value is PayPalSdk {
  return typeof value === "object" && value !== null && typeof Reflect.get(value, "Buttons") === "function";
}

const loads = new Map<string, Promise<PayPalSdk>>();

/**
 * Load PayPal's page script for an app, once.
 *
 * @param clientId - The app's public client ID.
 * @returns The script's `paypal` object; rejects if the script cannot be loaded, and a later call tries again.
 */
export function loadPayPalSdk(clientId: string): Promise<PayPalSdk> {
  const known = loads.get(clientId);
  if (known !== undefined) return known;

  const load = new Promise<PayPalSdk>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture`;
    script.onload = () => {
      const sdk: unknown = Reflect.get(window, "paypal");
      if (isSdk(sdk)) resolve(sdk);
      else reject(new Error("PayPal's script loaded without its buttons"));
    };
    script.onerror = () => reject(new Error("PayPal's script could not be loaded"));
    document.head.append(script);
  });
  loads.set(clientId, load);
  load.catch(() => loads.delete(clientId));
  return load;
}
