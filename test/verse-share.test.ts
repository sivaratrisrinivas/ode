import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { fakeClaudeByTask } from "../src/testing/fakes.ts";
import { createHarness, pollUntil } from "./harness.ts";
import { goaExtraction, goaNotes, lyricsForFriends, seedExtraction, seedLyrics, seedNotes } from "./seed.ts";

interface ReadyOde {
  status: string;
  sections: { kind: string; friend?: string; friendViewPath?: string }[];
}
interface ShareBody {
  friend: string;
  title: string;
  sections: { kind: string; friend?: string; lines?: string[]; text?: string }[];
  stretches?: { durationMs: number; bytes: number }[];
}
interface FriendViewBody {
  you: { linesUnlocked: number } | null;
  canShare: boolean;
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The seed ledger (Tharun owes $97.50, Vikram $82.50, Sahiti $77.50, trip "Florida '25") with its Ode made. */
async function madeOde({ extraction = seedExtraction, lyrics = seedLyrics }: { extraction?: object; lyrics?: object } = {}) {
  const harness = await createHarness({
    claude: fakeClaudeByTask({ "extract-ledger": () => extraction, "write-lyrics": () => lyrics }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  await harness.post("/api/ode", {});
  await pollUntil(
    async () => json<ReadyOde>(await harness.get("/api/ode")),
    (ode) => ode.status === "ready",
  );
  return harness;
}

type Harness = Awaited<ReturnType<typeof madeOde>>;

/** A friend's private page path, as the payer's page shows it. */
async function linkOf(harness: Harness, friend: string): Promise<string> {
  const ode = await json<ReadyOde>(await harness.get("/api/ode"));
  return ode.sections.find((section) => section.friend === friend)?.friendViewPath ?? "";
}

async function pay(harness: Harness, friend: string, amountCents: number) {
  const { orderId } = await json<{ orderId: string }>(await harness.post("/api/payments/orders", { friend, amountCents }));
  const res = await harness.post("/api/payments/capture", { orderId });
  expect(res.status).toBe(200);
}

/** The friend asks to share: `POST /api/friends/<token>/share`. */
async function share(harness: Harness, friend: string) {
  const link = await linkOf(harness, friend);
  return harness.post(link.replace("/f/", "/api/friends/") + "/share", {});
}

/** The API path behind a share's page link: `/s/<token>` is the page, `/api/shares/<token>` its data. */
const shareApi = (sharePath: string) => sharePath.replace("/s/", "/api/shares/");

describe("sharing a verse", () => {
  it("is refused for a friend with no unlocked line, and offered once one unlocks", async () => {
    const harness = await madeOde();
    const view = async () =>
      json<FriendViewBody>(await harness.get((await linkOf(harness, "Tharun")).replace("/f/", "/api/friends/")));

    expect((await view()).canShare).toBe(false);
    const refused = await share(harness, "Tharun");
    expect(refused.status).toBe(422);
    expect(await json<{ error: string }>(refused)).toEqual({ error: expect.stringMatching(/unlock/i) });

    await pay(harness, "Tharun", 2_437);
    expect((await view()).canShare).toBe(false);
    expect((await share(harness, "Tharun")).status).toBe(422);

    await pay(harness, "Tharun", 1);
    expect((await view()).canShare).toBe(true);
    const made = await share(harness, "Tharun");
    expect(made.status).toBe(201);
    expect((await json<{ sharePath: string }>(made)).sharePath).toMatch(/^\/s\/[0-9a-f]{64}$/);
  });

  it("is refused for a link that belongs to nobody", async () => {
    const harness = await madeOde();

    const res = await harness.post(`/api/friends/${"0".repeat(64)}/share`, {});

    expect(res.status).toBe(404);
  });

  it("holds only that friend's unlocked lines, the intro and their hook: no locked line, other verse or amount", async () => {
    const harness = await madeOde();
    await pay(harness, "Vikram", 4_125);
    const made = await json<{ sharePath: string }>(await share(harness, "Vikram"));

    const res = await harness.anonymous(shareApi(made.sharePath));
    const text = await res.text();
    const body: ShareBody = JSON.parse(text);

    expect(res.status).toBe(200);
    expect(body.friend).toBe("Vikram");
    expect(body.title).toBe("An Ode for Vikram · Florida '25");
    const [line1, line2, line3, line4] = seedLyrics.friends[1]?.lines ?? [];
    expect(body.sections).toEqual([
      { kind: "intro" },
      { kind: "verse", friend: "Vikram", lines: [line1, line2] },
      { kind: "hook", text: seedLyrics.hook },
    ]);
    for (const hidden of [line3, line4, ...(seedLyrics.friends[0]?.lines ?? []), ...(seedLyrics.friends[2]?.lines ?? []), seedLyrics.chorus]) {
      expect(text).not.toContain(hidden);
    }
    // No amounts, no private link, no talk of debt.
    for (const secret of ["amount", "repaid", "cents", "\$", "friendViewPath", "/f/", (await linkOf(harness, "Vikram")).replace("/f/", ""), "owe", "debt", "paid"]) {
      expect(text.toLowerCase()).not.toContain(secret.toLowerCase());
    }
  });

  it("answers an unknown share link with 404", async () => {
    const harness = await madeOde();

    expect((await harness.get(`/api/shares/${"0".repeat(64)}`)).status).toBe(404);
    expect((await harness.get("/api/shares/nonsense")).status).toBe(404);
  });

  it("is one link for the same verse, and a new one when more of it is unlocked", async () => {
    const harness = await madeOde();
    await pay(harness, "Tharun", 2_438);

    const first = await json<{ sharePath: string }>(await share(harness, "Tharun"));
    const again = await json<{ sharePath: string }>(await share(harness, "Tharun"));
    await pay(harness, "Tharun", 2_437);
    const longer = await json<{ sharePath: string }>(await share(harness, "Tharun"));

    expect(again.sharePath).toBe(first.sharePath);
    expect(longer.sharePath).not.toBe(first.sharePath);
    const lines = async (path: string) => (await json<ShareBody>(await harness.get(shareApi(path)))).sections.find((s) => s.kind === "verse")?.lines;
    expect(await lines(first.sharePath)).toHaveLength(1);
    expect(await lines(longer.sharePath)).toHaveLength(2);
  });

  it("includes the chorus only in a share made after it has dropped", async () => {
    const harness = await madeOde();
    await pay(harness, "Tharun", 9_750);
    await pay(harness, "Vikram", 8_250);
    await pay(harness, "Sahiti", 7_749);
    const before = await json<{ sharePath: string }>(await share(harness, "Tharun"));
    await pay(harness, "Sahiti", 1);
    const after = await json<{ sharePath: string }>(await share(harness, "Tharun"));

    const kinds = async (path: string) => (await json<ShareBody>(await harness.get(shareApi(path)))).sections.map((s) => s.kind);
    expect(await kinds(before.sharePath)).toEqual(["intro", "verse", "hook"]);
    expect(await kinds(after.sharePath)).toEqual(["intro", "verse", "hook", "chorus"]);
    const chorus = (await json<ShareBody>(await harness.get(shareApi(after.sharePath)))).sections.find((s) => s.kind === "chorus");
    expect(chorus?.text).toBe(seedLyrics.chorus);
  });

  it("opens for someone who is not the friend, who has paid nothing in their own copy", async () => {
    const harness = await madeOde();
    await pay(harness, "Tharun", 9_750);
    const made = await json<{ sharePath: string }>(await share(harness, "Tharun"));

    const stranger = harness.newBrowser();
    const body = await json<ShareBody>(await stranger.get(shareApi(made.sharePath)));

    expect(body.sections.find((s) => s.kind === "verse")?.lines).toHaveLength(4);
  });

  describe("link preview", () => {
    /** The `<meta>` tags of a page, by their `property` or `name`, with HTML entities decoded. */
    function metaOf(html: string): Map<string, string> {
      const decode = (text: string) =>
        text.replaceAll("&lt;", "<").replaceAll("&gt;", ">").replaceAll("&quot;", '"').replaceAll("&#39;", "'").replaceAll("&amp;", "&");
      const found = new Map<string, string>();
      for (const [tag] of html.matchAll(/<meta\b[^>]*>/g)) {
        const key = /(?:property|name)="([^"]*)"/.exec(tag)?.[1];
        const content = /content="([^"]*)"/.exec(tag)?.[1];
        if (key !== undefined && content !== undefined) found.set(decode(key), decode(content));
      }
      return found;
    }

    /** The pixels of a palette PNG: its size and one palette index per pixel. */
    function decodePng(png: Uint8Array) {
      const bytes = Buffer.from(png);
      expect([...bytes.subarray(0, 8)]).toEqual([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
      const width = bytes.readUInt32BE(16);
      const height = bytes.readUInt32BE(20);
      const data: Buffer[] = [];
      for (let at = 8; at < bytes.length; ) {
        const length = bytes.readUInt32BE(at);
        if (bytes.toString("ascii", at + 4, at + 8) === "IDAT") data.push(bytes.subarray(at + 8, at + 8 + length));
        at += 12 + length;
      }
      const rows = inflateSync(Buffer.concat(data));
      expect(rows.length).toBe((width + 1) * height);
      return { width, height, pixel: (x: number, y: number) => rows[y * (width + 1) + 1 + x] };
    }

    async function sharedPath(harness: Harness, friend: string): Promise<string> {
      return (await json<{ sharePath: string }>(await share(harness, friend))).sharePath;
    }

    it("serves the share page with the preview card as server-rendered Open Graph and Twitter tags", async () => {
      const harness = await madeOde();
      await pay(harness, "Tharun", 2_438);
      const path = await sharedPath(harness, "Tharun");

      const res = await harness.anonymous(path);
      const html = await res.text();
      const meta = metaOf(html);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/html/);
      const title = "An Ode for Tharun · Florida '25";
      expect(meta.get("og:title")).toBe(title);
      expect(meta.get("twitter:title")).toBe(title);
      expect(meta.get("twitter:card")).toBe("summary_large_image");
      expect(meta.get("og:type")).toBe("website");
      expect(meta.get("og:url")).toBe(`http://localhost${path}`);
      expect(meta.get("og:image")).toBe(`http://localhost${path}/card.png`);
      expect(meta.get("twitter:image")).toBe(`http://localhost${path}/card.png`);
      expect(meta.get("og:image:width")).toBe("1200");
      expect(meta.get("og:image:height")).toBe("630");
      expect(meta.get("og:image:alt")).toBe(title);
      expect(meta.get("og:audio")).toBe(`http://localhost${path.replace("/s/", "/api/shares/")}/audio`);
      expect(html).toContain("<title>An Ode for Tharun \u00b7 Florida &#39;25</title>");
      // The page itself is still the app's page.
      expect(html).toContain('<div id="root"></div>');
    });

    it("names the share by the address it was reached at, behind a proxy too", async () => {
      const harness = await madeOde();
      await pay(harness, "Tharun", 2_438);
      const path = await sharedPath(harness, "Tharun");

      const res = await harness.anonymous(path, { headers: { host: "ode.example.com", "x-forwarded-proto": "https" } });
      const meta = metaOf(await res.text());

      expect(meta.get("og:image")).toBe(`https://ode.example.com${path}/card.png`);
      expect(meta.get("og:url")).toBe(`https://ode.example.com${path}`);
    });

    it("puts nothing in the page that the share does not hold: no locked line, other friend, amount or debt", async () => {
      const harness = await madeOde();
      await pay(harness, "Vikram", 4_125);
      const path = await sharedPath(harness, "Vikram");

      const res = await harness.anonymous(path);
      const html = (await res.text()).toLowerCase();

      expect(res.status).toBe(200);
      expect(html).toContain("vikram");
      for (const hidden of [...(seedLyrics.friends[1]?.lines.slice(2) ?? []), ...(seedLyrics.friends[0]?.lines ?? []), seedLyrics.chorus, "tharun", "sahiti", "owe", "debt", "repaid", "$"]) {
        expect(html).not.toContain(hidden.toLowerCase());
      }
    });

    it("escapes a trip name that is not safe to put in a page", async () => {
      const trip = `Fl <b>"orida"</b> & '25`;
      const harness = await madeOde({ extraction: { ...seedExtraction, trip } });
      await pay(harness, "Tharun", 2_438);
      const path = await sharedPath(harness, "Tharun");

      const html = await (await harness.anonymous(path)).text();

      expect(html).not.toContain("<b>");
      expect(metaOf(html).get("og:title")).toBe(`An Ode for Tharun \u00b7 ${trip}`);
    });

    it("is a 404 for an unknown share, with no card", async () => {
      const harness = await madeOde();

      const res = await harness.anonymous(`/s/${"0".repeat(64)}`);

      expect(res.status).toBe(404);
      expect(metaOf(await res.text()).has("og:title")).toBe(false);
      expect((await harness.get(`/s/${"0".repeat(64)}/card.png`)).status).toBe(404);
    });

    it("serves the preview image: a 1200 by 630 PNG with this share's name drawn on it", async () => {
      const harness = await madeOde();
      await pay(harness, "Tharun", 2_438);
      await pay(harness, "Vikram", 4_125);
      const tharun = await sharedPath(harness, "Tharun");
      const vikram = await sharedPath(harness, "Vikram");

      const res = await harness.anonymous(`${tharun}/card.png`);
      const png = new Uint8Array(await res.arrayBuffer());
      const other = new Uint8Array(await (await harness.anonymous(`${vikram}/card.png`)).arrayBuffer());

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("image/png");
      const card = decodePng(png);
      expect([card.width, card.height]).toEqual([1200, 630]);
      // The headline band holds dark letters on the paper, and a different friend's card differs.
      let ink = 0;
      for (let y = 150; y < 250; y++) for (let x = 0; x < 1200; x++) if (card.pixel(x, y) === 1) ink++;
      expect(ink).toBeGreaterThan(2_000);
      expect(Buffer.from(other).equals(Buffer.from(png))).toBe(false);
    });
  });

  describe("audio", () => {
    /** The payer's page's Ode: every section's window, and each line's lock for the paying visitor. */
    async function odeWindows(harness: Harness) {
      return json<{
        durationMs: number;
        sections: { kind: string; friend?: string; startMs: number; endMs: number; lines?: { startMs: number; endMs: number; locked: boolean }[] }[];
      }>(await harness.get("/api/ode"));
    }

    it("plays only the stretches of the Ode the share holds: the audio has no locked line, other verse or chorus", async () => {
      const harness = await madeOde();
      await pay(harness, "Vikram", 4_125);
      const made = await json<{ sharePath: string }>(await share(harness, "Vikram"));

      const res = await harness.anonymous(shareApi(made.sharePath) + "/audio");
      const heard = new Uint8Array(await res.arrayBuffer());
      const { stretches } = await json<ShareBody>(await harness.get(shareApi(made.sharePath)));
      const ode = await odeWindows(harness);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/mpeg");
      expect(heard.byteLength).toBe(stretches?.reduce((sum, stretch) => sum + stretch.bytes, 0));
      // The fake Ode's audio counts 0 to 255 from start to end, so a byte says when in the Ode it was sung.
      const msPerByte = ode.durationMs / 256;
      const present = new Set(heard);
      /** The bytes sung well inside a window, a byte's width in from each edge. */
      const sungIn = (window: { startMs: number; endMs: number } | undefined) =>
        [...Array(256).keys()].filter(
          (byte) => byte * msPerByte >= (window?.startMs ?? 0) + msPerByte && (byte + 1) * msPerByte <= (window?.endMs ?? 0) - msPerByte,
        );

      const vikram = ode.sections.find((section) => section.friend === "Vikram");
      const hooks = ode.sections.filter((section) => section.kind === "hook");
      const allowed = [ode.sections[0], ...(vikram?.lines?.filter((line) => !line.locked) ?? []), hooks[1]];
      const forbidden = [
        ...(vikram?.lines?.filter((line) => line.locked) ?? []),
        ...ode.sections.filter((section) => section.kind === "chorus" || (section.kind === "verse" && section.friend !== "Vikram")),
        hooks[0],
        hooks[2],
      ];
      for (const window of allowed) {
        const bytes = sungIn(window);
        expect(bytes.length).toBeGreaterThan(0);
        for (const byte of bytes) expect(present.has(byte)).toBe(true);
      }
      for (const window of forbidden) {
        const bytes = sungIn(window);
        expect(bytes.length).toBeGreaterThan(0);
        for (const byte of bytes) expect(present.has(byte)).toBe(false);
      }
    });

    it("is one continuous stretch when the share's parts sit together in the Ode, and has seams where they do not", async () => {
      const harness = await madeOde();
      await pay(harness, "Tharun", 9_750);
      await pay(harness, "Vikram", 4_125);
      const whole = await json<{ sharePath: string }>(await share(harness, "Tharun"));
      const gapped = await json<{ sharePath: string }>(await share(harness, "Vikram"));

      const seams = async (path: string) => (await json<ShareBody>(await harness.get(shareApi(path)))).stretches?.length;

      // Tharun's four lines: intro, verse and hook run on from the start of the song.
      expect(await seams(whole.sharePath)).toBe(1);
      // Vikram's first two lines: the intro, then two lines, then the hook after the locked ones.
      expect(await seams(gapped.sharePath)).toBe(3);
    });

    it("can be seeked: a range gets that part of the clip", async () => {
      const harness = await madeOde();
      await pay(harness, "Tharun", 9_750);
      const made = await json<{ sharePath: string }>(await share(harness, "Tharun"));
      const path = shareApi(made.sharePath) + "/audio";
      const all = new Uint8Array(await (await harness.get(path)).arrayBuffer());

      const part = await harness.request(path, { headers: { range: "bytes=3-9" } });

      expect(part.status).toBe(206);
      expect([...new Uint8Array(await part.arrayBuffer())]).toEqual([...all.subarray(3, 10)]);
      expect(part.headers.get("content-range")).toBe(`bytes 3-9/${all.byteLength}`);
    });

    it("is a 404 for an unknown share", async () => {
      const harness = await madeOde();

      expect((await harness.get(`/api/shares/${"0".repeat(64)}/audio`)).status).toBe(404);
    });
  });
});

describe("sharing a verse from a judge's own Ode", () => {
  it("shares the judge's Ode as counted in the judge's copy, for a friend who opens the link in their own browser", async () => {
    const harness = await createHarness({
      claude: fakeClaudeByTask({
        "extract-ledger": (notes) => (notes.includes("Goa") ? goaExtraction : seedExtraction),
        "write-lyrics": lyricsForFriends,
      }),
    });
    await harness.post("/api/ledger", { notes: seedNotes });
    await harness.post("/api/lyrics", {});
    await harness.post("/api/ode", {});
    const judge = harness.newBrowser();
    await judge.post("/api/judge-ode", {});
    await judge.post("/api/ledger", { notes: goaNotes });
    await judge.post("/api/lyrics", {});
    await judge.post("/api/ode", {});
    const own = await pollUntil(
      async () => json<ReadyOde>(await judge.get("/api/ode")),
      (ode) => ode.status === "ready",
    );
    const meera = own.sections.find((section) => section.friend === "Meera")?.friendViewPath ?? "";
    const friendsPhone = harness.newBrowser();
    const apiLink = meera.replace("/f/", "/api/friends/");

    // Nothing of Meera's is paid, so her link offers nothing to share.
    expect((await json<FriendViewBody>(await friendsPhone.get(apiLink))).canShare).toBe(false);
    expect((await friendsPhone.post(`${apiLink}/share`, {})).status).toBe(422);

    const { orderId } = await json<{ orderId: string }>(await judge.post("/api/payments/orders", { friend: "Meera", amountCents: 5_000 }));
    await judge.post("/api/payments/capture", { orderId });
    expect((await json<FriendViewBody>(await friendsPhone.get(apiLink))).canShare).toBe(true);
    const made = await json<{ sharePath: string }>(await friendsPhone.post(`${apiLink}/share`, {}));

    const stranger = harness.newBrowser();
    const text = await (await stranger.get(shareApi(made.sharePath))).text();
    const body: ShareBody = JSON.parse(text);
    expect(body.title).toBe("An Ode for Meera · Goa '26");
    expect(body.sections.find((section) => section.kind === "verse")?.lines).toEqual(["Meera laughed the whole way there"]);
    expect(text).not.toContain("Tharun");
    expect(text).not.toContain("Dev");
    expect((await stranger.get(`${shareApi(made.sharePath)}/audio`)).status).toBe(200);
    expect(await (await stranger.get(made.sharePath)).text()).toContain("Goa &#39;26");
  });
});

