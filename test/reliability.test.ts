import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";
import { writeFallbackRecording } from "../src/ops/fallback-recording.ts";
import { buildSeededOde } from "../src/ops/seed-ode.ts";
import { clipPlan, decide, readElevenCredits, renderReport, runClip, type RunRecord } from "../src/ops/reliability.ts";
import { createOdeStore } from "../src/server/ode-store.ts";
import { SEEDED } from "../src/server/owner.ts";
import { migrate } from "../src/server/schema.ts";
import { fakeClaudeByTask, fakeMusic } from "../src/testing/fakes.ts";
import { MusicUnavailable, type ElevenMusic, type Sql } from "../src/server/ports.ts";
import { err, ok } from "../src/server/result.ts";
import { seedExtraction, seedLyrics, seedNotes } from "./seed.ts";

/** A fetch that answers every request with `body`, and remembers what it was asked. */
function fetchAnswering(status: number, body: unknown) {
  const asked: { url: string; key: string | null }[] = [];
  const fake: typeof fetch = async (input, init) => {
    asked.push({ url: String(input), key: new Headers(init?.headers).get("xi-api-key") });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  };
  return { fake, asked };
}

describe("reading the ElevenLabs credit balance", () => {
  it("reports credits used and the limit from the subscription", async () => {
    const { fake, asked } = fetchAnswering(200, { tier: "starter", character_count: 12733, character_limit: 40000 });

    const credits = await readElevenCredits({ apiKey: "k", fetch: fake });

    expect(credits).toEqual({ _tag: "ok", value: { used: 12733, limit: 40000 } });
    expect(asked).toEqual([{ url: "https://api.elevenlabs.io/v1/user/subscription", key: "k" }]);
  });

  it.each([
    ["an HTTP error", 401, { detail: "no" }],
    ["a reply without the counts", 200, { tier: "starter" }],
    ["a reply that is not JSON", 200, "<html>"],
  ])("says the balance is unavailable for %s", async (_name, status, body) => {
    const { fake } = fetchAnswering(status, body);

    const credits = await readElevenCredits({ apiKey: "k", fetch: fake });

    expect(credits._tag).toBe("err");
  });
});

/** An MP3 at the 128 kbps the app asks for, `seconds` long: 16,000 bytes a second. */
const mp3Seconds = (seconds: number) => new Uint8Array(seconds * 16_000);

describe("one 35-second clip run", () => {
  const plan = clipPlan(seedLyrics.friends[0]?.lines ?? [], seedLyrics.hook);

  it("is the day-1 probe's shape: intro 6 s, four 5 s lines, hook 9 s", () => {
    expect(plan.map((chunk) => chunk.durationMs)).toEqual([6000, 5000, 5000, 5000, 5000, 9000]);
    expect(plan[1]?.text).toBe(`[Verse 1]\n${seedLyrics.friends[0]?.lines[0]}`);
    expect(plan[5]?.text).toBe(`[Hook]\n${seedLyrics.hook}`);
  });

  it("succeeds when the audio is about as long as planned", async () => {
    const music: ElevenMusic = { compose: async () => ok({ audio: mp3Seconds(35), words: [] }) };

    const run = await runClip(music, plan);

    expect(run._tag === "ok" && run.value.audioSeconds).toBeCloseTo(35, 1);
  });

  it("fails as MusicUnavailable when Eleven Music does not answer", async () => {
    const music: ElevenMusic = { compose: async () => err(new MusicUnavailable("HTTP 429")) };

    const run = await runClip(music, plan);

    expect(run._tag === "err" && run.error._tag).toBe("MusicUnavailable");
  });

  it("fails as ClipWrongLength when the audio is far from 35 s, which would break every verse window", async () => {
    const music: ElevenMusic = { compose: async () => ok({ audio: mp3Seconds(20), words: [] }) };

    const run = await runClip(music, plan);

    expect(run._tag === "err" && run.error._tag).toBe("ClipWrongLength");
  });
});

describe("building the Seeded Ode from the seed notes", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const claude = fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics, "rewrite-line": () => ({ line: "unused" }) });

  async function freshSql(): Promise<Sql> {
    const db = await PGlite.create();
    const sql: Sql = { query: (text, params) => db.query(text, params), transaction: (work) => db.transaction((tx) => work(tx)) };
    await migrate(sql);
    return sql;
  }

  it("saves the Seeded Ode (ledger, lyrics, Ode and audio) and returns what was made", async () => {
    const sql = await freshSql();

    const built = await buildSeededOde({ sql, claude, music: fakeMusic(), notes: seedNotes, now, releaseDate: "2026-12-01" });

    expect(built._tag).toBe("ok");
    const saved = createOdeStore(sql, SEEDED);
    const ode = await saved.read();
    expect(ode?.sections.filter((section) => section.kind === "verse")).toHaveLength(3);
    expect((await saved.readAudio())?.length).toBe(256);
    expect(await saved.releaseDate()).toBe("2026-12-01");
  });

  it("fails with the pipeline's failure tag, and saves no Ode, when Eleven Music is down", async () => {
    const sql = await freshSql();
    const music = fakeMusic();
    music.failNextCompose();

    const built = await buildSeededOde({ sql, claude, music, notes: seedNotes, now, releaseDate: "2026-12-01" });

    expect(built._tag === "err" && built.error.tag).toBe("MusicUnavailable");
    expect(await createOdeStore(sql, SEEDED).read()).toBeUndefined();
  });

  it("says plainly that the Seeded Ode already exists instead of making a second", async () => {
    const sql = await freshSql();
    await buildSeededOde({ sql, claude, music: fakeMusic(), notes: seedNotes, now, releaseDate: "2026-12-01" });

    const again = await buildSeededOde({ sql, claude, music: fakeMusic(), notes: seedNotes, now, releaseDate: "2026-12-01" });

    expect(again._tag === "err" && again.error.tag).toBe("OdeAlreadyMade");
  });

  it("builds again over an existing Seeded Ode when asked to replace it", async () => {
    const sql = await freshSql();
    await buildSeededOde({ sql, claude, music: fakeMusic(), notes: seedNotes, now, releaseDate: "2026-12-01" });

    const again = await buildSeededOde({ sql, claude, music: fakeMusic(), notes: seedNotes, now, releaseDate: "2026-12-02", replace: true });

    expect(again._tag).toBe("ok");
    expect(await createOdeStore(sql, SEEDED).releaseDate()).toBe("2026-12-02");
  });
});

const clip = (n: number, outcome: { tag: string } | undefined = undefined): RunRecord =>
  outcome === undefined
    ? { kind: "clip", label: `clip ${n}`, ok: true, seconds: 8.5, credits: 600 }
    : { kind: "clip", label: `clip ${n}`, ok: false, tag: outcome.tag, seconds: 3, credits: 0 };
const full = (ok: boolean): RunRecord =>
  ok ? { kind: "full", label: "full Ode", ok: true, seconds: 41, credits: 1900 } : { kind: "full", label: "full Ode", ok: false, tag: "MusicUnavailable", seconds: 20, credits: 0 };
const clips = (failures: number) => Array.from({ length: 10 }, (_, i) => (i < failures ? clip(i + 1, { tag: "MusicUnavailable" }) : clip(i + 1)));

describe("the reliability decision", () => {
  it("keeps the live Ode when at most 1 of the 11 runs fails", () => {
    expect(decide([...clips(0), full(true)])).toBe("live");
    expect(decide([...clips(1), full(true)])).toBe("live");
  });

  it("uses the labeled fallback when 2 of the 11 runs fail", () => {
    expect(decide([...clips(2), full(true)])).toBe("fallback");
  });

  it("uses the labeled fallback when the full run fails, however well the clips did", () => {
    expect(decide([...clips(0), full(false)])).toBe("fallback");
  });
});

describe("the reliability report", () => {
  const report = renderReport({
    date: "2026-11-11",
    records: [...clips(2), full(true)],
    creditsBefore: { used: 12_733, limit: 40_000 },
    creditsAfter: { used: 18_233, limit: 40_000 },
    claude: { inputTokens: 3_000, outputTokens: 1_200, calls: 4 },
  });

  it("lists every run with its result, failure tag, seconds and credits", () => {
    expect(report).toContain("| clip 1 | failed | MusicUnavailable | 3.0 | 0 |");
    expect(report).toContain("| clip 3 | ok |  | 8.5 | 600 |");
    expect(report).toContain("| full Ode | ok |  | 41.0 | 1900 |");
  });

  it("states the failure rate, the ElevenLabs balance before and after, and Claude's tokens", () => {
    expect(report).toContain("Failure rate: 2 of 11 runs (18%)");
    expect(report).toContain("ElevenLabs credits: 12733 before, 18233 after, 5500 used (of 40000)");
    expect(report).toContain("Claude: 4 calls, 3000 input tokens, 1200 output tokens");
  });

  it("states the decision rule and what it decided", () => {
    expect(report).toContain("Decision rule: failure rate high (more than 10% of runs, or the full run fails) -> use the labeled fallback in the video.");
    expect(report).toContain("Decision: use the labeled fallback");
  });
});

describe("keeping the recorded fallback", () => {
  it("writes the audio and a description that labels it a recording, not a live run", async () => {
    const sql = await (async () => {
      const db = await PGlite.create();
      const made: Sql = { query: (text, params) => db.query(text, params), transaction: (work) => db.transaction((tx) => work(tx)) };
      await migrate(made);
      return made;
    })();
    const claude = fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics, "rewrite-line": () => ({ line: "unused" }) });
    const built = await buildSeededOde({ sql, claude, music: fakeMusic(), notes: seedNotes, now: new Date("2026-11-11T12:00:00Z"), releaseDate: "2026-12-01" });
    if (built._tag === "err") throw built.error;
    const dir = mkdtempSync(join(tmpdir(), "fallback-"));

    try {
      writeFallbackRecording(dir, built.value, { madeAt: new Date("2026-11-11T12:00:00Z"), source: "seed/notes.txt" });

      expect(readFileSync(join(dir, "seeded-ode-fallback.mp3")).length).toBe(256);
      const described = JSON.parse(readFileSync(join(dir, "seeded-ode-fallback.json"), "utf8"));
      expect(described.label).toMatch(/^RECORDING/);
      expect(described.madeAt).toBe("2026-11-11T12:00:00.000Z");
      expect(described.source).toBe("seed/notes.txt");
      expect(described.friends.map((friend: { name: string }) => friend.name)).toEqual(["Tharun", "Vikram", "Sahiti"]);
      expect(described.durationMs).toBe(built.value.ode.durationMs);
    } finally {
      rmSync(dir, { recursive: true });
    }
  });
});
