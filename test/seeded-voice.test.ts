import { describe, expect, it } from "vitest";
import { convertSeededVoice } from "../src/server/voice-conversion.ts";
import { FAKE_VOICE_BYTES, fakeAudioTools, fakeClaudeByTask, fakeVoice } from "../src/testing/fakes.ts";
import { createHarness, MAKE_ODE, pollUntil } from "./harness.ts";
import { goaExtraction, goaNotes, lyricsForFriends, seedExtraction, seedLyrics, seedNotes } from "../src/testing/seed.ts";

interface OdeBody {
  status: string;
  voiceLabel?: string | null;
  sections?: { kind: string; startMs: number; endMs: number }[];
}

async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The Seeded Ode made (the fake singer's 256 bytes of audio), and the way to be a judge. */
async function seededHarness() {
  const harness = await createHarness({
    claude: fakeClaudeByTask({
      "extract-ledger": (input) => (input.includes("Goa") ? goaExtraction : seedExtraction),
      "write-lyrics": (input) => (input.includes("Meera") ? lyricsForFriends(input) : seedLyrics),
    }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  await harness.post("/api/ode", MAKE_ODE);
  await readyOde(harness);
  return harness;
}

type Harness = Awaited<ReturnType<typeof seededHarness>>;

async function readyOde(browser: Pick<Harness, "get">) {
  return pollUntil(
    async () => json<OdeBody>(await browser.get("/api/ode")),
    (ode) => ode.status === "ready",
  );
}

async function audioOf(browser: Pick<Harness, "get">): Promise<number[]> {
  return [...new Uint8Array(await (await browser.get("/api/ode/audio")).arrayBuffer())];
}

describe("the Seeded Ode in the payer's voice", () => {
  it("replaces the Seeded Ode's audio with the converted remix and labels it in the payer's voice", async () => {
    const harness = await seededHarness();
    const before = await audioOf(harness);
    expect((await readyOde(harness)).voiceLabel).toBeNull();

    const converted = await convertSeededVoice({ sql: harness.sql, voice: fakeVoice(), audio: fakeAudioTools() });

    expect(converted._tag).toBe("ok");
    const after = await audioOf(harness);
    // The fake mix: neither the singer's own bytes nor anything of another length.
    expect(after).toEqual(new Array(before.length).fill(FAKE_VOICE_BYTES.mixed));
    // A second browser, and a friend's link, play the same converted audio.
    const other = harness.newBrowser();
    expect(await audioOf(other)).toEqual(after);
    expect((await readyOde(other)).voiceLabel).toBe("in my voice");
    expect((await readyOde(harness)).voiceLabel).toBe("in my voice");
  });

  it("leaves the line windows as they were", async () => {
    const harness = await seededHarness();
    const windows = async () => (await readyOde(harness)).sections?.map(({ kind, startMs, endMs }) => ({ kind, startMs, endMs }));
    const before = await windows();

    await convertSeededVoice({ sql: harness.sql, voice: fakeVoice(), audio: fakeAudioTools() });

    expect(await windows()).toEqual(before);
  });
});

describe("a conversion that cannot be trusted", () => {
  it("is refused, and the audio kept, when the remix is a length the line windows no longer fit", async () => {
    const harness = await seededHarness();
    const before = await audioOf(harness);
    const voice = fakeVoice();
    voice.lengthenNextConversion(5_000);

    const converted = await convertSeededVoice({ sql: harness.sql, voice, audio: fakeAudioTools() });

    expect(converted).toMatchObject({ _tag: "err", error: { _tag: "LengthChanged" } });
    expect(await audioOf(harness)).toEqual(before);
    expect((await readyOde(harness)).voiceLabel).toBeNull();
  });

  it("is refused, and the audio kept, when the singing starts later than it did", async () => {
    const harness = await seededHarness();
    const before = await audioOf(harness);
    const voice = fakeVoice();
    // Half a second of silence ahead of the singing at the real MP3 rate: every line window would be half a second early.
    voice.delayNextConversion(8_000);

    const converted = await convertSeededVoice({ sql: harness.sql, voice, audio: fakeAudioTools() });

    expect(converted).toMatchObject({ _tag: "err", error: { _tag: "VocalsMoved" } });
    expect(await audioOf(harness)).toEqual(before);
    expect((await readyOde(harness)).voiceLabel).toBeNull();
  });

  it("is accepted when the singing starts a hair later", async () => {
    const harness = await seededHarness();
    const voice = fakeVoice();
    voice.delayNextConversion(100);

    const converted = await convertSeededVoice({ sql: harness.sql, voice, audio: fakeAudioTools() });

    expect(converted._tag).toBe("ok");
  });

  it("is accepted when the remix is only a hair longer", async () => {
    const harness = await seededHarness();
    const voice = fakeVoice();
    voice.lengthenNextConversion(3);

    const converted = await convertSeededVoice({ sql: harness.sql, voice, audio: fakeAudioTools() });

    expect(converted._tag).toBe("ok");
    expect((await readyOde(harness)).voiceLabel).toBe("in my voice");
  });

  it.each(["ElevenLabs", "the audio tools"])("keeps the audio when %s fail", async (failing) => {
    const harness = await seededHarness();
    const before = await audioOf(harness);
    const voice = fakeVoice();
    const audio = fakeAudioTools();
    (failing === "ElevenLabs" ? voice : audio).failNextRequest();

    const converted = await convertSeededVoice({ sql: harness.sql, voice, audio });

    expect(converted._tag).toBe("err");
    expect(await audioOf(harness)).toEqual(before);
    expect((await readyOde(harness)).voiceLabel).toBeNull();
  });

  it("does not spend a conversion when the audio tools are missing", async () => {
    const harness = await seededHarness();
    const voice = fakeVoice();
    const audio = fakeAudioTools();
    audio.failNextRequest();

    await convertSeededVoice({ sql: harness.sql, voice, audio });

    expect(voice.conversions()).toBe(0);
  });

  it("says so when there is no Seeded Ode to convert", async () => {
    const harness = await createHarness();

    const converted = await convertSeededVoice({ sql: harness.sql, voice: fakeVoice(), audio: fakeAudioTools() });

    expect(converted).toMatchObject({ _tag: "err", error: { _tag: "NoSeededOde" } });
  });

  it("converts once: a second run leaves the converted audio alone", async () => {
    const harness = await seededHarness();
    const voice = fakeVoice();
    await convertSeededVoice({ sql: harness.sql, voice, audio: fakeAudioTools() });
    const after = await audioOf(harness);

    const again = await convertSeededVoice({ sql: harness.sql, voice, audio: fakeAudioTools() });

    expect(again).toMatchObject({ _tag: "err", error: { _tag: "AlreadyInPayersVoice" } });
    expect(voice.conversions()).toBe(1);
    expect(await audioOf(harness)).toEqual(after);
  });

  it("makes the Seeded Ode Eleven Music's again, without the label, when it is made over", async () => {
    const harness = await seededHarness();
    await convertSeededVoice({ sql: harness.sql, voice: fakeVoice(), audio: fakeAudioTools() });

    await harness.post("/api/ledger", { notes: seedNotes });
    await harness.post("/api/lyrics", {});
    await harness.post("/api/ode", MAKE_ODE);

    expect((await readyOde(harness)).voiceLabel).toBeNull();
    expect(await audioOf(harness)).toEqual(Array.from({ length: 256 }, (_, index) => index));
  });
});

describe("a judge's own Ode", () => {
  it("is neither converted nor labelled when the Seeded Ode is", async () => {
    const harness = await seededHarness();
    await convertSeededVoice({ sql: harness.sql, voice: fakeVoice(), audio: fakeAudioTools() });
    const judge = harness.newBrowser();
    await judge.post("/api/judge-ode", {});
    await judge.post("/api/ledger", { notes: goaNotes });
    await judge.post("/api/lyrics", {});
    await judge.post("/api/ode", MAKE_ODE);

    const own = await readyOde(judge);

    expect(own.voiceLabel).toBeNull();
    // The fake singer's audio, byte for byte: 0 to 255.
    expect(await audioOf(judge)).toEqual(Array.from({ length: 256 }, (_, index) => index));
  });
});
