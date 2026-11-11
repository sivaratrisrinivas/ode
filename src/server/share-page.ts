import { CARD_HEIGHT, CARD_WIDTH } from "./card-image.ts";

/** The page to serve when none was built: enough for the share page's tags to land in. */
export const BARE_SHELL = '<!doctype html><html lang="en"><head><meta charset="UTF-8" /><title>Ode</title></head><body><div id="root"></div></body></html>';

/** Text made safe to put inside an HTML element or a double-quoted attribute. */
export function escapeHtml(text: string): string {
  return text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

/**
 * The address a request was made at, for links a chat app follows from a page it has fetched. A proxy in front of the
 * app says what the reader typed in `x-forwarded-proto` and `host`; without them the request's own address stands.
 *
 * @param url - The request's URL.
 * @param headers - The request's headers.
 * @returns Scheme and host with no trailing slash, such as `https://ode.example.com`.
 */
export function requestOrigin(url: string, headers: { get(name: string): string | null }): string {
  const own = new URL(url);
  const scheme = headers.get("x-forwarded-proto")?.split(",")[0]?.trim() || own.protocol.replace(":", "");
  const host = headers.get("x-forwarded-host")?.split(",")[0]?.trim() || headers.get("host") || own.host;
  return `${scheme === "https" ? "https" : "http"}://${host}`;
}

/** What a chat app shows for a verse share's link. */
export interface ShareCardMeta {
  /** "An Ode for [name] · [trip]". */
  readonly title: string;
  readonly description: string;
  /** Absolute address of the page itself. */
  readonly pageUrl: string;
  /** Absolute address of the preview image. */
  readonly imageUrl: string;
  /** Absolute address of the share's audio. */
  readonly audioUrl: string;
}

/**
 * Put a share's link-preview card into the app's page: Open Graph and Twitter tags in the head, and a title. Chat apps read
 * these from the HTML they fetch and never run its script, so they are rendered here rather than by the page.
 *
 * @param shell - The app's `index.html`.
 * @param card - What the card says and where its parts are.
 * @returns The page with the tags added; any `<title>` it had is replaced.
 */
export function withShareCard(shell: string, card: ShareCardMeta): string {
  const tag = (key: "property" | "name", name: string, content: string) => `<meta ${key}="${name}" content="${escapeHtml(content)}" />`;
  const head = [
    `<title>${escapeHtml(card.title)}</title>`,
    tag("name", "description", card.description),
    tag("property", "og:type", "website"),
    tag("property", "og:site_name", "Ode"),
    tag("property", "og:title", card.title),
    tag("property", "og:description", card.description),
    tag("property", "og:url", card.pageUrl),
    tag("property", "og:image", card.imageUrl),
    tag("property", "og:image:type", "image/png"),
    tag("property", "og:image:width", String(CARD_WIDTH)),
    tag("property", "og:image:height", String(CARD_HEIGHT)),
    tag("property", "og:image:alt", card.title),
    tag("property", "og:audio", card.audioUrl),
    tag("property", "og:audio:type", "audio/mpeg"),
    tag("name", "twitter:card", "summary_large_image"),
    tag("name", "twitter:title", card.title),
    tag("name", "twitter:description", card.description),
    tag("name", "twitter:image", card.imageUrl),
    tag("name", "twitter:image:alt", card.title),
  ].join("\n    ");
  const withoutTitle = shell.replace(/<title>[\s\S]*?<\/title>/i, "");
  return withoutTitle.includes("</head>") ? withoutTitle.replace("</head>", `    ${head}\n  </head>`) : `${head}\n${withoutTitle}`;
}
