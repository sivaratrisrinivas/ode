import type { Hono } from "hono";
import { audioResponse } from "./audio-response.ts";
import { renderShareCard } from "./card-image.ts";
import { requestOrigin, withShareCard } from "./share-page.ts";
import { linkOwner } from "./friend-view.ts";
import type { LedgerStore } from "./ledger-service.ts";
import type { OdeStore } from "./ode-service.ts";
import type { FriendStanding } from "./payments.ts";
import { chorusDropped } from "./unlock.ts";
import { err, ok, type Result } from "./result.ts";
import {
  buildVerseShare,
  byteStretches,
  CROSSFADE_MS,
  shareRecordFor,
  shareTitle,
  UnknownShare,
  type ByteStretch,
  type NoOdeToShare,
  type VerseShare,
} from "./verse-share.ts";
import type { VerseShareStore } from "./verse-share-store.ts";
import type { VisitorEnv } from "./visitor.ts";
import type { VisitorId } from "./visitor-id.ts";

/** What the verse share routes read. */
export interface VerseShareDeps {
  ledger: Pick<LedgerStore, "friendForToken" | "trip">;
  odes: Pick<OdeStore, "read" | "readAudio">;
  shares: VerseShareStore;
  /** Every friend's standing in the visitor's copy of the Ode. */
  standings: (visitor: VisitorId) => Promise<readonly FriendStanding[]>;
  /** The built app's `index.html`, which the share page is made from. */
  indexHtml: string;
}

/** A share as it is opened: what it holds, cut from the Ode as it stands, with the trip's name and the audio it is cut from. */
interface OpenShare {
  readonly share: VerseShare;
  readonly trip: string;
  readonly audio: Uint8Array;
  readonly bytes: readonly ByteStretch[];
}

/** Open the share a token names, or say why it cannot be: nobody holds the token, or the Ode it was cut from is gone. */
async function openShare(deps: VerseShareDeps, token: string): Promise<Result<OpenShare, UnknownShare | NoOdeToShare>> {
  const record = await deps.shares.read(token);
  if (record === undefined) return err(new UnknownShare());
  const [ode, audio, trip] = await Promise.all([deps.odes.read(), deps.odes.readAudio(), deps.ledger.trip()]);
  if (ode === undefined || audio === undefined) return err(new UnknownShare());
  const share = buildVerseShare(ode, record);
  if (share._tag === "err") return share;
  return ok({ share: share.value, trip, audio, bytes: byteStretches(share.value.stretches, ode, audio.byteLength) });
}

/**
 * Mount the verse share routes on the API: a friend makes a share from their private link, and anyone with the share's own
 * link can read it. The share's link says nothing about the friend's private page.
 *
 * @param api - The API to add routes to.
 * @param deps - Where the routes read from.
 */
export function mountVerseShares(api: Hono<VisitorEnv>, deps: VerseShareDeps): void {
  // The friend's own request: it is the friend's link that proves who is sharing, so only a friend can make a share.
  api.post("/api/friends/:token/share", async (c) => {
    const friend = linkOwner(await deps.ledger.friendForToken(c.req.param("token")));
    if (friend._tag === "err") return c.json({ error: friend.error.message }, 404);

    if ((await deps.odes.read()) === undefined) return c.json({ error: "The Ode isn't ready yet, so there is nothing to share." }, 422);
    const standings = await deps.standings(c.get("visitor"));
    const record = shareRecordFor(
      friend.value,
      standings.find((standing) => standing.friend === friend.value),
      chorusDropped(standings),
    );
    if (record._tag === "err") return c.json({ error: record.error.message }, 422);

    return c.json({ sharePath: `/s/${await deps.shares.create(record.value)}` }, 201);
  });

  // Only the stretches the share holds are sent, joined end to end, so the audio carries nothing of a locked line.
  api.get("/api/shares/:token/audio", async (c) => {
    const open = await openShare(deps, c.req.param("token"));
    if (open._tag === "err") return c.json({ error: open.error.message }, 404);

    const { audio, bytes } = open.value;
    const clip = new Uint8Array(bytes.reduce((sum, stretch) => sum + stretch.end - stretch.start, 0));
    let at = 0;
    for (const stretch of bytes) {
      clip.set(audio.subarray(stretch.start, stretch.end), at);
      at += stretch.end - stretch.start;
    }
    return audioResponse(c, clip);
  });

  // The page a share's link opens. A chat app fetches it for the preview card and never runs its script, so the card's tags
  // are in the HTML; a browser goes on to load the app, which draws the share. An unknown link gets the plain app page
  // (the app says the link doesn't work) with no card.
  api.get("/s/:token", async (c) => {
    const token = c.req.param("token");
    const open = await openShare(deps, token);
    if (open._tag === "err") return c.html(deps.indexHtml, 404);

    const { share, trip } = open.value;
    const origin = requestOrigin(c.req.url, c.req.raw.headers);
    const title = shareTitle(share.friend, trip);
    return c.html(
      withShareCard(deps.indexHtml, {
        title,
        description: `A short song about ${share.friend} and the ${trip} trip.`,
        pageUrl: `${origin}/s/${token}`,
        imageUrl: `${origin}/s/${token}/card.png`,
        audioUrl: `${origin}/api/shares/${token}/audio`,
      }),
    );
  });

  api.get("/s/:token/card.png", async (c) => {
    const open = await openShare(deps, c.req.param("token"));
    if (open._tag === "err") return c.json({ error: open.error.message }, 404);

    const { share, trip } = open.value;
    const png = renderShareCard({ headline: `An Ode for ${share.friend}`, subline: trip });
    // A copy, because a response body must be backed by a plain ArrayBuffer.
    return c.body(new Uint8Array(png), 200, { "content-type": "image/png", "cache-control": "public, max-age=300" });
  });

  // The share's own link is all a reader has: it opens the same for anyone, whoever paid what in their copy.
  api.get("/api/shares/:token", async (c) => {
    const token = c.req.param("token");
    const open = await openShare(deps, token);
    if (open._tag === "err") return c.json({ error: open.error.message }, 404);

    const { share, trip, bytes } = open.value;
    return c.json({
      friend: share.friend,
      trip,
      title: shareTitle(share.friend, trip),
      audioUrl: `/api/shares/${token}/audio`,
      crossfadeMs: CROSSFADE_MS,
      sections: share.sections,
      stretches: share.stretches.map((stretch, index) => ({
        durationMs: stretch.endMs - stretch.startMs,
        bytes: (bytes[index]?.end ?? 0) - (bytes[index]?.start ?? 0),
      })),
    });
  });
}
