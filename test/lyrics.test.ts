import { describe, expect, it } from "vitest";
import { ClaudeUnavailable } from "../src/server/ports.ts";
import { err, ok, type Result } from "../src/server/result.ts";
import { fakeClaudeByTask } from "../src/testing/fakes.ts";
import { createHarness } from "./harness.ts";
import { seedExtraction, seedLyrics as cleanLyrics, seedNotes } from "../src/testing/seed.ts";

interface LineBody {
  text: string;
  problems: string[];
}
interface LyricsBody {
  verses: { friend: string; lines: LineBody[] }[];
  hook: LineBody | null;
  chorus: LineBody | null;
}
interface ErrorBody {
  error: string;
}

// Response.json() is untyped, so assigning it to a declared type needs no cast.
async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The cleanLyrics with some slots changed. Verse lines are numbered from 1. */
function lyricsWith(changes: { verse?: [friend: "Tharun" | "Vikram" | "Sahiti", line: 1 | 2 | 3 | 4, text: string][]; hook?: string; chorus?: string }) {
  const lyrics = structuredClone(cleanLyrics);
  for (const [friend, line, text] of changes.verse ?? []) {
    const verse = lyrics.friends.find((f) => f.name === friend);
    if (!verse) throw new Error(`no verse for ${friend}`);
    verse.lines[line - 1] = text;
  }
  return { ...lyrics, hook: changes.hook ?? lyrics.hook, chorus: changes.chorus ?? lyrics.chorus };
}

/**
 * The payer's confirmed seed ledger plus a Claude that writes `lyrics`.
 * `rewrites` maps a failing line's text to the replacements Claude gives, one per request, in order.
 */
async function seededHarness(lyrics: unknown = cleanLyrics, rewrites: Record<string, string[]> = {}) {
  const writeInputs: string[] = [];
  const harness = await createHarness({
    claude: fakeClaudeByTask({
      "extract-ledger": () => seedExtraction,
      "write-lyrics": (input) => {
        writeInputs.push(input);
        return lyrics;
      },
      "rewrite-line": (input) => {
        const request: { line: string } = JSON.parse(input);
        const replacement = rewrites[request.line]?.shift();
        if (replacement === undefined) throw new Error(`fake Claude has no rewrite left for: ${request.line}`);
        return { line: replacement };
      },
    }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  return { ...harness, writeInputs };
}

describe("the ledger becomes lyrics", () => {
  it("gives the seed ledger 4 lines per friend, a hook and a chorus, and keeps them across a reload", async () => {
    const { post, get } = await seededHarness();

    const res = await post("/api/lyrics", {});

    expect(res.status).toBe(200);
    const lyrics = await json<LyricsBody>(res);
    expect(lyrics.verses.map((v) => [v.friend, v.lines.length])).toEqual([
      ["Tharun", 4],
      ["Vikram", 4],
      ["Sahiti", 4],
    ]);
    expect(lyrics.verses[0]?.lines.map((l) => l.text)).toEqual(cleanLyrics.friends[0]?.lines);
    expect(lyrics.hook).toEqual({ text: cleanLyrics.hook, problems: [] });
    expect(lyrics.chorus).toEqual({ text: cleanLyrics.chorus, problems: [] });
    expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual(lyrics);
  });

  it("never sends an amount to Claude when writing", async () => {
    const { post, writeInputs } = await seededHarness();

    await post("/api/lyrics", {});

    expect(writeInputs).toHaveLength(1);
    expect(writeInputs[0]).toContain("Tharun");
    expect(writeInputs[0]).not.toMatch(/9750|97\.5|8250|82\.5|7750|77\.5/);
  });

  it("regenerates a line that sings an amount, once, and uses the clean replacement", async () => {
    const lyrics = lyricsWith({
      verse: [["Tharun", 2, "He fronted ninety bucks and never said a word"]],
      hook: "Fifty dollars for the road, we were there",
    });
    const { post, get } = await seededHarness(lyrics, {
      "He fronted ninety bucks and never said a word": ["He covered the stay and never said a word"],
      "Fifty dollars for the road, we were there": ["One more mile for the road, we were there"],
    });

    const res = await post("/api/lyrics", {});

    const body = await json<LyricsBody>(res);
    expect(body.verses[0]?.lines[1]).toEqual({ text: "He covered the stay and never said a word", problems: [] });
    expect(body.hook).toEqual({ text: "One more mile for the road, we were there", problems: [] });
    expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual(body);
  });

  it.each([
    ["a brand", "We split the Airbnb and never looked back"],
    ["a brand with a possessive and odd casing", "Sahiti paid for CHIPOTLE's burritos twice"],
    ["a song title", "We sang Mr. Brightside at full volume in the car"],
    ["a song title without punctuation", "Vikram knew every word of mr brightside"],
  ])("regenerates a line that names %s", async (_kind, failing) => {
    const lyrics = lyricsWith({ verse: [["Vikram", 3, failing]] });
    const { post } = await seededHarness(lyrics, { [failing]: ["We sang at full volume in the car"] });

    const body = await json<LyricsBody>(await post("/api/lyrics", {}));

    expect(body.verses[1]?.lines[2]).toEqual({ text: "We sang at full volume in the car", problems: [] });
  });

  it("leaves lines alone that only look like a brand or a song title", async () => {
    const lyrics = lyricsWith({ hook: "We rode the airship home and sang all night" });
    const { post } = await seededHarness(lyrics);

    const body = await json<LyricsBody>(await post("/api/lyrics", {}));

    expect(body.hook).toEqual({ text: "We rode the airship home and sang all night", problems: [] });
  });

  it("regenerates a failing line exactly once, then flags what still fails, and keeps the flag across a reload", async () => {
    const failing = "He fronted ninety bucks and never said a word";
    const stillFailing = "He fronted fifty dollars and never said a word";
    const { post, get } = await seededHarness(lyricsWith({ verse: [["Tharun", 2, failing]] }), {
      // A third attempt would be clean; the payer gets the second text, flagged.
      [failing]: [stillFailing],
      [stillFailing]: ["He covered the stay and never said a word"],
    });

    const body = await json<LyricsBody>(await post("/api/lyrics", {}));

    const line = body.verses[0]?.lines[1];
    expect(line?.text).toBe(stillFailing);
    expect(line?.problems).toEqual([expect.stringContaining("amount")]);
    expect(body.verses[0]?.lines[0]?.problems).toEqual([]);
    expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual(body);
  });

  it("flags the original line when Claude cannot rewrite it, instead of failing the lyrics", async () => {
    const failing = "Sahiti paid ninety bucks for the airboat ride";
    const writer = fakeClaudeByTask({
      "extract-ledger": () => seedExtraction,
      "write-lyrics": () => lyricsWith({ verse: [["Sahiti", 1, failing]] }),
    });
    const { post } = await createHarness({
      claude: {
        structured: async (request) =>
          request.task === "rewrite-line" ? err(new ClaudeUnavailable("rate limited")) : writer.structured(request),
      },
    });
    await post("/api/ledger", { notes: seedNotes });

    const res = await post("/api/lyrics", {});

    expect(res.status).toBe(200);
    const body = await json<LyricsBody>(res);
    expect(body.verses[2]?.lines[0]?.text).toBe(failing);
    expect(body.verses[2]?.lines[0]?.problems).not.toEqual([]);
  });

  it("accepts a line of exactly 200 characters", async () => {
    const longest = "la ".repeat(100).slice(0, 199) + "!";
    expect(longest).toHaveLength(200);
    const { post } = await seededHarness(lyricsWith({ verse: [["Tharun", 1, longest]] }));

    const body = await json<LyricsBody>(await post("/api/lyrics", {}));

    expect(body.verses[0]?.lines[0]).toEqual({ text: longest, problems: [] });
  });

  it("regenerates a line over 200 characters once, and cuts one that is still too long and flags it", async () => {
    const tooLong = "Tharun drove ".repeat(20).trim();
    const stillTooLong = "Tharun kept driving ".repeat(20).trim();
    const hookTooLong = "We were there ".repeat(20).trim();
    const shorter = "Tharun drove through the night while the rest of us slept";
    const { post } = await seededHarness(lyricsWith({ verse: [["Tharun", 1, tooLong], ["Tharun", 2, hookTooLong]] }), {
      [tooLong]: [stillTooLong],
      [stillTooLong]: [shorter],
      [hookTooLong]: [shorter],
    });

    const body = await json<LyricsBody>(await post("/api/lyrics", {}));

    const stubborn = body.verses[0]?.lines[0];
    expect(stubborn?.text.length).toBeLessThanOrEqual(200);
    expect(stillTooLong.startsWith(stubborn?.text ?? "x")).toBe(true);
    expect(stubborn?.problems).toEqual([expect.stringContaining("200")]);
    expect(body.verses[0]?.lines[1]).toEqual({ text: shorter, problems: [] });
  });

  it("keeps every generated line within 200 characters", async () => {
    const { post } = await seededHarness();

    const body = await json<LyricsBody>(await post("/api/lyrics", {}));

    const lines = [...body.verses.flatMap((v) => v.lines), body.hook, body.chorus];
    expect(lines).toHaveLength(14);
    for (const line of lines) expect(line?.text.length).toBeLessThanOrEqual(200);
  });

  it("keeps the payer's edits to any line after a reload", async () => {
    const { post, patch, get } = await seededHarness();
    await post("/api/lyrics", {});

    const verse = await patch("/api/lyrics/verses/Vikram/lines/3", { text: "Key lime pie at nine, the best of the trip" });
    const hook = await patch("/api/lyrics/hook", { text: "Oh we were there, always there" });
    const chorus = await patch("/api/lyrics/chorus", { text: "Here is to the ones who drove us home" });

    expect(verse.status).toBe(200);
    expect(await json<LineBody>(verse)).toEqual({ text: "Key lime pie at nine, the best of the trip", problems: [] });
    expect(hook.status).toBe(200);
    expect(chorus.status).toBe(200);
    const reloaded = await json<LyricsBody>(await get("/api/lyrics"));
    expect(reloaded.verses[1]?.lines.map((l) => l.text)).toEqual([
      "Vikram swore the sunset was just around the bend",
      "Wrong turn, wrong turn, and a pier at the end",
      "Key lime pie at nine, the best of the trip",
      "The best night of the trip came from getting lost right",
    ]);
    expect(reloaded.hook?.text).toBe("Oh we were there, always there");
    expect(reloaded.chorus?.text).toBe("Here is to the ones who drove us home");
  });

  it("clears a line's flag when the payer fixes it, and flags an edit that brings a problem back", async () => {
    const failing = "He fronted ninety bucks and never said a word";
    const { post, patch, get } = await seededHarness(lyricsWith({ verse: [["Tharun", 2, failing]] }), {
      [failing]: ["He fronted fifty dollars and never said a word"],
    });
    const written = await json<LyricsBody>(await post("/api/lyrics", {}));
    expect(written.verses[0]?.lines[1]?.problems).not.toEqual([]);

    const fixed = await json<LineBody>(await patch("/api/lyrics/verses/Tharun/lines/2", { text: "He covered the stay and never said a word" }));
    expect(fixed.problems).toEqual([]);

    const spoiled = await json<LineBody>(await patch("/api/lyrics/verses/Tharun/lines/2", { text: "He put the Airbnb on his card" }));
    expect(spoiled).toEqual({ text: "He put the Airbnb on his card", problems: [expect.stringContaining("Airbnb")] });
    const reloaded = await json<LyricsBody>(await get("/api/lyrics"));
    expect(reloaded.verses[0]?.lines[1]).toEqual(spoiled);
  });

  it("refuses an edit that is empty, not text, or over 200 characters, and keeps the line", async () => {
    const { post, patch, get } = await seededHarness();
    const written = await json<LyricsBody>(await post("/api/lyrics", {}));

    for (const body of [{}, { text: "   " }, { text: 7 }, { text: "la ".repeat(100) }]) {
      const res = await patch("/api/lyrics/verses/Tharun/lines/1", body);
      expect(res.status).toBe(422);
      expect((await json<ErrorBody>(res)).error).not.toBe("");
    }
    expect((await patch("/api/lyrics/hook", { text: "" })).status).toBe(422);
    expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual(written);
  });

  it("answers 404 when editing a line that does not exist", async () => {
    const { post, patch } = await seededHarness();
    const text = { text: "A new line" };

    expect((await patch("/api/lyrics/verses/Tharun/lines/1", text)).status).toBe(404);
    expect((await patch("/api/lyrics/hook", text)).status).toBe(404);

    await post("/api/lyrics", {});
    expect((await patch("/api/lyrics/verses/Nobody/lines/1", text)).status).toBe(404);
    expect((await patch("/api/lyrics/verses/Tharun/lines/5", text)).status).toBe(404);
    expect((await patch("/api/lyrics/verses/Tharun/lines/0", text)).status).toBe(404);
    expect((await patch("/api/lyrics/verses/Tharun/lines/two", text)).status).toBe(404);
  });

  it("starts with no lyrics", async () => {
    const { get } = await seededHarness();

    expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual({ verses: [], hook: null, chorus: null });
  });

  it("asks the payer to build the ledger first when it is empty", async () => {
    const { post } = await createHarness();

    const res = await post("/api/lyrics", {});

    expect(res.status).toBe(422);
    expect((await json<ErrorBody>(res)).error).toContain("Build the ledger first");
  });

  it("asks the payer to fix a missing amount or inside joke before writing lyrics", async () => {
    const claude = fakeClaudeByTask({
      "extract-ledger": () => ({
        friends: [
          { name: "Vikram", amountOwedCents: null, amountIsEstimate: false, insideJoke: "The pier at nine" },
          { name: "Sahiti", amountOwedCents: 5000, amountIsEstimate: false, insideJoke: null },
        ],
        groupCosts: [],
      }),
    });
    const { post, patch } = await createHarness({ claude });
    await post("/api/ledger", { notes: "vikram and sahiti" });

    const res = await post("/api/lyrics", {});

    expect(res.status).toBe(422);
    const { error } = await json<ErrorBody>(res);
    expect(error).toContain("No amount found for Vikram");
    expect(error).toContain("No inside joke found for Sahiti");

    await patch("/api/ledger/Vikram", { amountOwedCents: 4000 });
    await patch("/api/ledger/Sahiti", { insideJoke: "Screamed at the gator" });
    expect((await post("/api/lyrics", {})).status).not.toBe(422);
  });

  it("asks the payer to try again when Claude is unavailable or answers wrongly, and keeps the current lyrics", async () => {
    const [tharun, vikram, sahiti] = cleanLyrics.friends;
    let writing: Result<unknown, ClaudeUnavailable> = ok(cleanLyrics);
    const ledgerReader = fakeClaudeByTask({ "extract-ledger": () => seedExtraction });
    const { post, get } = await createHarness({
      claude: { structured: async (request) => (request.task === "write-lyrics" ? writing : ledgerReader.structured(request)) },
    });
    await post("/api/ledger", { notes: seedNotes });
    const written = await json<LyricsBody>(await post("/api/lyrics", {}));

    const failures = [
      err(new ClaudeUnavailable("rate limited")),
      ok({ ...cleanLyrics, friends: [{ name: "Tharun", lines: tharun?.lines.slice(0, 3) }, vikram, sahiti] }),
      ok({ ...cleanLyrics, friends: [tharun, vikram] }),
      ok({ friends: "none", hook: 1 }),
      ok({ ...cleanLyrics, friends: [{ name: "Tharun", lines: ["a", " ", "c", "d"] }, vikram, sahiti] }),
      ok({ ...cleanLyrics, hook: "  " }),
      ok({ ...cleanLyrics, friends: [tharun, tharun, vikram, sahiti] }),
    ];
    for (const failure of failures) {
      writing = failure;
      const res = await post("/api/lyrics", {});
      expect(res.status).toBe(502);
      expect((await json<ErrorBody>(res)).error).toContain("Try again");
      expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual(written);
    }
  });

  it("replaces the lyrics, including the payer's edits, when they are written again", async () => {
    const { post, patch, get } = await seededHarness();
    await post("/api/lyrics", {});
    await patch("/api/lyrics/hook", { text: "My own hook" });

    await post("/api/lyrics", {});

    expect((await json<LyricsBody>(await get("/api/lyrics"))).hook?.text).toBe(cleanLyrics.hook);
  });

  it("drops the lyrics when new trip notes replace the ledger, but not when a ledger row is edited", async () => {
    const { post, patch, get } = await seededHarness();
    await post("/api/lyrics", {});

    await patch("/api/ledger/Vikram", { insideJoke: "A different memory" });
    expect((await json<LyricsBody>(await get("/api/lyrics"))).verses).toHaveLength(3);

    await post("/api/ledger", { notes: seedNotes });
    expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual({ verses: [], hook: null, chorus: null });
  });

  it("flags a hook or chorus that still fails after its one regeneration", async () => {
    const hook = "Airbnb nights, we were there";
    const chorus = "We sang Mr. Brightside all the way home";
    const { post, get } = await seededHarness(lyricsWith({ hook, chorus }), {
      [hook]: ["Chipotle nights, we were there"],
      [chorus]: ["We sang Hotel California all the way home"],
    });

    const body = await json<LyricsBody>(await post("/api/lyrics", {}));

    expect(body.hook).toEqual({ text: "Chipotle nights, we were there", problems: [expect.stringContaining("Chipotle")] });
    expect(body.chorus).toEqual({
      text: "We sang Hotel California all the way home",
      problems: [expect.stringContaining("Hotel California")],
    });
    expect(await json<LyricsBody>(await get("/api/lyrics"))).toEqual(body);
  });

  it("says a cut line was cut, and clears that flag once the payer saves the line", async () => {
    const tooLong = "Tharun drove ".repeat(20).trim();
    const { post, patch } = await seededHarness(lyricsWith({ verse: [["Tharun", 1, tooLong]] }), {
      [tooLong]: [tooLong],
    });
    const body = await json<LyricsBody>(await post("/api/lyrics", {}));
    const cut = body.verses[0]?.lines[0];
    expect(cut?.problems).toEqual([expect.stringMatching(/was cut/)]);

    const resaved = await json<LineBody>(await patch("/api/lyrics/verses/Tharun/lines/1", { text: cut?.text }));

    expect(resaved).toEqual({ text: cut?.text, problems: [] });
  });

  it("names the covered amount when group costs cancel what is owed, instead of asking for a missing one", async () => {
    const { post } = await createHarness({
      claude: fakeClaudeByTask({
        "extract-ledger": () => ({
          friends: [{ name: "Tharun", amountOwedCents: 500, amountIsEstimate: false, insideJoke: "Drove all night" }],
          groupCosts: [{ description: "Parking", amountCents: 3000 }],
        }),
      }),
    });
    await post("/api/ledger", { notes: "tiny debt" });

    const res = await post("/api/lyrics", {});

    expect(res.status).toBe(422);
    expect((await json<ErrorBody>(res)).error).toContain("cancel out what you owe Tharun");
  });
});
