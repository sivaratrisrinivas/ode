import { useEffect } from "react";

/** The title of the landing page and the fallback everywhere; `index.html` carries the same word until the page loads. */
export const ODE_TITLE = "Ode";

/** The title of the payer's own page. */
export const PAYER_TITLE = "Your Ode";

/**
 * The title of a friend's private page.
 *
 * @param friend - The friend's name, or `null` while the page has not heard it yet.
 * @returns "An Ode for <friend>", or {@link ODE_TITLE} when the name is not known yet.
 */
export function friendTitle(friend: string | null): string {
  return friend === null ? ODE_TITLE : `An Ode for ${friend}`;
}

/**
 * Show `title` as the browser tab's title for as long as the calling component is on the page; it is set after the page
 * is drawn, never while it is being drawn.
 *
 * @param title - The text for the tab.
 */
export function usePageTitle(title: string): void {
  useEffect(() => {
    document.title = title;
  }, [title]);
}
