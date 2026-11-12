import { describe, expect, it } from "vitest";
import { ClaudeUnavailable, type ElevenMusic } from "../src/server/ports.ts";
import { err, ok, type Result } from "../src/server/result.ts";
import { fakeClaudeByTask, fakeMusic } from "../src/testing/fakes.ts";
import { createHarness, MAKE_ODE, pollUntil } from "./harness.ts";
import { seedExtraction, seedLyrics, seedNotes } from "../src/testing/seed.ts";

interface TimedLineBody {
  text: string;
  startMs: number;
  endMs: number;
}
type SectionBody =
  | { kind: "intro"; startMs: number; endMs: number }
  | { kind: "verse"; friend: string; startMs: number; endMs: number; lines: TimedLineBody[] }
  | { kind: "hook" | "chorus"; text: string; startMs: number; endMs: number };
type OdeBody =
  | { status: "none" }
  | { status: "making"; steps: { name: string; state: string }[] }
  | { status: "failed"; error: string }
  | { status: "ready"; durationMs: number; audioUrl: string; sections: SectionBody[] };

// Response.json() is untyped, so assigning it to a declared type needs no cast.
async function json<T>(res: Response): Promise<T> {
  return res.json();
}

/** The Ode status once the run has settled: ready or failed (or never started). */
function settledOde(get: (path: string) => Response | Promise<Response>): Promise<OdeBody> {
  return pollUntil(
    async () => json<OdeBody>(await get("/api/ode")),
    (ode) => ode.status !== "making",
  );
}

function expectReady(ode: OdeBody) {
  if (ode.status !== "ready") throw new Error(`expected a ready Ode, got ${JSON.stringify(ode)}`);
  return ode;
}

/** The label a section is listed under: "verse:Tharun", "hook", ... */
function label(section: SectionBody): string {
  return section.kind === "verse" ? `verse:${section.friend}` : section.kind;
}

function verses(ode: { sections: SectionBody[] }) {
  return ode.sections.flatMap((section) => (section.kind === "verse" ? [section] : []));
}

/** A verse's line windows as [start, end] offsets from the start of the verse. */
function relativeWindows(verse: { startMs: number; lines: TimedLineBody[] }) {
  return verse.lines.map((line) => [line.startMs - verse.startMs, line.endMs - verse.startMs]);
}

// The fake singer starts the four lines 1.0 s, 4.5 s, 9.5 s and 13.0 s into a verse and takes 2.5 s over
// each. A window ends halfway through the silence before the next line starts, so the windows tile the
// 20 s verse but are not equal quarters.
const sungWindows = [
  [0, 4_000],
  [4_000, 8_250],
  [8_250, 12_500],
  [12_500, 20_000],
];

const quarters = [
  [0, 5_000],
  [5_000, 10_000],
  [10_000, 15_000],
  [15_000, 20_000],
];

/** The seed ledger with its lyrics written, ready for "Make the Ode". */
async function lyricsHarness(music?: ElevenMusic) {
  const harness = await createHarness({
    claude: fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics }),
    ...(music === undefined ? {} : { music }),
  });
  await harness.post("/api/ledger", { notes: seedNotes });
  await harness.post("/api/lyrics", {});
  return harness;
}

/** A music port that holds the song back until `release()`, and counts the songs asked for. */
function heldMusic() {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const inner = fakeMusic();
  let asked = 0;
  const music: ElevenMusic = {
    compose: async (chunks) => {
      asked += 1;
      await gate;
      return inner.compose(chunks);
    },
  };
  return { music, release, asked: () => asked };
}

/** A gate a test opens when the run it holds may go on. */
function openable() {
  let open = () => {};
  const opened = new Promise<void>((resolve) => {
    open = resolve;
  });
  return { opened, open };
}

/** The status once the run is composing, so its first step is done. */
function composingOde(get: (path: string) => Response | Promise<Response>): Promise<OdeBody> {
  return pollUntil(
    async () => json<OdeBody>(await get("/api/ode")),
    (ode) => ode.status !== "making" || ode.steps.some((step) => step.name === "composing" && step.state === "active"),
  );
}

/** The status steps a payer sees while the Ode is made, each as done, active or waiting. */
const steps = (writing: string, composing: string, finding: string) => [
  { name: "writing", state: writing },
  { name: "composing", state: composing },
  { name: "finding-lines", state: finding },
];

describe("making the Ode", () => {
  it("composes an intro, one verse per friend each followed by a hook, and a chorus, back to back", async () => {
    const { post, get } = await lyricsHarness();

    const started = await post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(get));

    expect(started.status).toBe(202);
    expect(ode.sections.map(label)).toEqual([
      "intro",
      "verse:Tharun",
      "hook",
      "verse:Vikram",
      "hook",
      "verse:Sahiti",
      "hook",
      "chorus",
    ]);
    expect(ode.sections[0]?.startMs).toBe(0);
    ode.sections.forEach((section, i) => {
      expect(section.endMs).toBeGreaterThan(section.startMs);
      expect(section.startMs).toBe(ode.sections[i - 1]?.endMs ?? 0);
    });
    expect(ode.durationMs).toBe(ode.sections.at(-1)?.endMs);
    // One chunk per verse (ADR 0001): each verse window is one ~20 s chunk.
    for (const section of ode.sections.filter((s) => s.kind === "verse")) {
      expect(section.endMs - section.startMs).toBe(20_000);
    }
    const hooks = ode.sections.flatMap((s) => (s.kind === "hook" ? [s.text] : []));
    expect(hooks).toEqual([seedLyrics.hook, seedLyrics.hook, seedLyrics.hook]);
    expect(ode.sections.at(-1)).toMatchObject({ kind: "chorus", text: seedLyrics.chorus });
  });

  it("stores a time window for every line, found from when the words are sung", async () => {
    const { post, get } = await lyricsHarness();

    await post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(get));

    expect(verses(ode).map((v) => [v.friend, v.lines.map((l) => l.text)])).toEqual(
      seedLyrics.friends.map((f) => [f.name, f.lines]),
    );
    expect(verses(ode).map(relativeWindows)).toEqual([sungWindows, sungWindows, sungWindows]);
  });

  it("still finds the windows when one sung word in each line is not the written word", async () => {
    const { post, get } = await lyricsHarness(fakeMusic({ singing: "one-word-misheard" }));

    await post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(get));

    expect(verses(ode).map(relativeWindows)).toEqual([sungWindows, sungWindows, sungWindows]);
  });

  it.each([
    ["words that are not the lyrics", "wrong-words"],
    ["missing", "silent"],
    ["the lines sung in a different order", "scrambled"],
  ] as const)("splits each verse window into equal quarters when the timestamps are %s", async (_case, singing) => {
    const { post, get } = await lyricsHarness(fakeMusic({ singing }));

    await post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(get));

    expect(ode.sections.map(label)).toHaveLength(8);
    expect(verses(ode).map(relativeWindows)).toEqual([quarters, quarters, quarters]);
  });

  it("falls back verse by verse: only the verse whose words do not line up is split into quarters", async () => {
    const music = fakeMusic({ singing: (verse) => (verse === 2 ? "wrong-words" : "faithful") });
    const { post, get } = await lyricsHarness(music);

    await post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(get));

    expect(verses(ode).map(relativeWindows)).toEqual([sungWindows, quarters, sungWindows]);
  });

  it("leaves no Ode when composing fails, says so, and makes the Ode when the payer retries", async () => {
    const music = fakeMusic();
    const { post, get } = await lyricsHarness(music);
    music.failNextCompose();

    const started = await post("/api/ode", MAKE_ODE);
    const failed = await settledOde(get);

    expect(started.status).toBe(202);
    expect(failed).toEqual({ status: "failed", error: expect.stringContaining("Try again") });
    expect(await json<OdeBody>(await get("/api/ode"))).toEqual(failed);

    const retried = await post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(get));

    expect(retried.status).toBe(202);
    expect(ode.sections).toHaveLength(8);
  });

  it("fails the same way, and stays retryable, when something unexpected goes wrong while composing", async () => {
    let broken = true;
    const inner = fakeMusic();
    const music: ElevenMusic = {
      compose: async (chunks) => {
        if (broken) throw new Error("adapter bug");
        return inner.compose(chunks);
      },
    };
    const { post, get } = await lyricsHarness(music);

    await post("/api/ode", MAKE_ODE);
    const failed = await settledOde(get);

    expect(failed).toEqual({ status: "failed", error: expect.stringContaining("Try again") });

    broken = false;
    await post("/api/ode", MAKE_ODE);
    expect((await settledOde(get)).status).toBe("ready");
  });

  describe("while the Ode is being made", () => {
    it("shows the status steps: writing, composing, finding every line", async () => {
      const { music, release } = heldMusic();
      const { post, get } = await lyricsHarness(music);

      const started = await json<OdeBody>(await post("/api/ode", MAKE_ODE));
      const composing = await pollUntil(
        async () => json<OdeBody>(await get("/api/ode")),
        (ode) => ode.status !== "making" || ode.steps.some((step) => step.name === "composing" && step.state === "active"),
      );

      expect(started).toEqual({ status: "making", steps: steps("active", "waiting", "waiting") });
      expect(composing).toEqual({ status: "making", steps: steps("done", "active", "waiting") });
      release();
      expect((await settledOde(get)).status).toBe("ready");
    });

    it("keeps showing the run and its steps after the web service restarts, and shows the Ode when the run ends", async () => {
      const { music, release } = heldMusic();
      const harness = await lyricsHarness(music);
      await harness.post("/api/ode", MAKE_ODE);
      await pollUntil(
        async () => json<OdeBody>(await harness.get("/api/ode")),
        (ode) => ode.status === "making" && ode.steps.some((step) => step.name === "composing" && step.state === "active"),
      );

      const restarted = harness.restartWebService();
      const afterRestart = await json<OdeBody>(await restarted.get("/api/ode"));
      release();
      const ode = expectReady(await settledOde(restarted.get));

      expect(afterRestart).toEqual({ status: "making", steps: steps("done", "active", "waiting") });
      expect(ode.sections).toHaveLength(8);
    });

    it("does not start a second run, or spend a second song, when the restarted web service is asked again", async () => {
      const { music, release, asked } = heldMusic();
      const harness = await lyricsHarness(music);
      await harness.post("/api/ode", MAKE_ODE);

      const restarted = harness.restartWebService();
      const again = await restarted.post("/api/ode", MAKE_ODE);
      release();
      await settledOde(restarted.get);

      expect(again.status).toBe(202);
      expect((await json<OdeBody>(again)).status).toBe("making");
      expect(asked()).toBe(1);
    });

    it("does not start a second run, or spend a second song, when asked again", async () => {
      const { music, release, asked } = heldMusic();
      const { post, get } = await lyricsHarness(music);

      await post("/api/ode", MAKE_ODE);
      const again = await post("/api/ode", MAKE_ODE);

      expect(again.status).toBe(202);
      expect((await json<OdeBody>(again)).status).toBe("making");
      release();
      expect((await settledOde(get)).status).toBe("ready");
      expect(asked()).toBe(1);
    });

    it("saves no Ode for friends who left the ledger when new trip notes replace it mid-run", async () => {
      const { music, release } = heldMusic();
      let extraction: unknown = seedExtraction;
      const { post, get } = await createHarness({
        claude: fakeClaudeByTask({ "extract-ledger": () => extraction, "write-lyrics": () => seedLyrics }),
        music,
      });
      await post("/api/ledger", { notes: seedNotes });
      await post("/api/lyrics", {});
      await post("/api/ode", MAKE_ODE);
      await pollUntil(
        async () => json<OdeBody>(await get("/api/ode")),
        (ode) => ode.status === "making" && ode.steps.some((step) => step.name === "composing" && step.state === "active"),
      );

      extraction = {
        friends: [{ name: "Maya", amountOwedCents: 5_000, amountIsEstimate: false, insideJoke: "Missed the ferry" }],
        groupCosts: [],
      };
      expect((await post("/api/ledger", { notes: "Maya covered the ferry, $50." })).status).toBe(200);
      release();
      const settled = await settledOde(get);

      expect(settled.status).toBe("failed");
      expect((await get("/api/ode/audio")).status).toBe(404);
    });
  });

  describe("when the Workflow run does not finish", () => {
    it("asks the payer to try again, leaves no Ode, and makes the Ode on retry, when the run dies without saying why", async () => {
      const { post, get, workflow } = await lyricsHarness();
      workflow.loseNextRun();

      const started = await post("/api/ode", MAKE_ODE);
      const failed = await settledOde(get);

      expect(started.status).toBe(202);
      expect(failed).toEqual({ status: "failed", error: expect.stringContaining("Try again") });
      expect((await get("/api/ode/audio")).status).toBe(404);

      const retried = await post("/api/ode", MAKE_ODE);
      const ode = expectReady(await settledOde(get));

      expect(retried.status).toBe(202);
      expect(ode.sections).toHaveLength(8);
    });

    it("asks the payer to try again, and starts nothing, when the Workflow cannot be reached", async () => {
      const { post, get, workflow } = await lyricsHarness();
      workflow.refuseNextStart();

      const refused = await post("/api/ode", MAKE_ODE);

      expect(refused.status).toBe(502);
      expect((await json<{ error: string }>(refused)).error).toContain("Try again");
      expect(await json<OdeBody>(await get("/api/ode"))).toEqual({ status: "none" });

      await post("/api/ode", MAKE_ODE);
      expect((await settledOde(get)).status).toBe("ready");
    });

    it("does not let a run the web service gave up on save an Ode while the payer's retry is still running", async () => {
      const inner = fakeMusic();
      const gates = [openable(), openable()];
      let composed = 0;
      const music: ElevenMusic = {
        compose: async (chunks) => {
          await gates[composed++]?.opened;
          return inner.compose(chunks);
        },
      };
      const { post, get, workflow } = await lyricsHarness(music);
      const songsAskedFor = (count: number) =>
        pollUntil(
          async () => composed,
          (asked) => asked === count,
        );
      await post("/api/ode", MAKE_ODE);
      await songsAskedFor(1);

      // The Workflow reports the first run ended, though its instance carries on composing.
      workflow.reportStartedRunsFailed();
      const gaveUp = await json<OdeBody>(await get("/api/ode"));
      await post("/api/ode", MAKE_ODE);
      await songsAskedFor(2);
      gates[0]?.open();
      const afterFirst = await workflow.whenRunsEnd(1);
      const whileRetrying = await json<OdeBody>(await get("/api/ode"));
      gates[1]?.open();
      const ode = expectReady(await settledOde(get));

      expect(gaveUp).toEqual({ status: "failed", error: expect.stringContaining("Try again") });
      expect(afterFirst).toEqual(["superseded"]);
      expect(whileRetrying).toEqual({ status: "making", steps: steps("done", "active", "waiting") });
      expect(await workflow.whenRunsEnd(2)).toEqual(["superseded", "ready"]);
      expect(ode.sections).toHaveLength(8);
    });

    it("tells the payer what to fix when the ledger changed before the Workflow run could read it", async () => {
      let extraction: unknown = seedExtraction;
      const { post, get, workflow } = await createHarness({
        claude: fakeClaudeByTask({ "extract-ledger": () => extraction, "write-lyrics": () => seedLyrics }),
      });
      await post("/api/ledger", { notes: seedNotes });
      const instanceStarts = workflow.holdNextRun();
      await post("/api/ode", MAKE_ODE);

      // New notes with no amount replace the ledger while the Workflow's instance is still starting up.
      extraction = {
        friends: [{ name: "Vikram", amountOwedCents: null, amountIsEstimate: false, insideJoke: "The pier at nine" }],
        groupCosts: [],
      };
      await post("/api/ledger", { notes: "vikram" });
      instanceStarts();
      const failed = await settledOde(get);

      expect(failed).toEqual({ status: "failed", error: expect.stringContaining("No amount found for Vikram") });
      expect((await get("/api/ode/audio")).status).toBe(404);
    });

    it("lets the payer try again once the run has waited half a minute for a Workflow the web service never reached", async () => {
      const harness = await lyricsHarness();
      harness.workflow.hangNextStart();
      void harness.post("/api/ode", MAKE_ODE);
      await pollUntil(
        async () => json<OdeBody>(await harness.get("/api/ode")),
        (ode) => ode.status === "making",
      );

      const restarted = harness.restartWebService();
      harness.clock.advance(10_000);
      const waiting = await json<OdeBody>(await restarted.get("/api/ode"));
      harness.clock.advance(21_000);
      const failed = await json<OdeBody>(await restarted.get("/api/ode"));

      expect(waiting).toEqual({ status: "making", steps: steps("active", "waiting", "waiting") });
      expect(failed).toEqual({ status: "failed", error: expect.stringContaining("Try again") });

      await restarted.post("/api/ode", MAKE_ODE);
      expect((await settledOde(restarted.get)).status).toBe("ready");
    });

    it("stops waiting after ten minutes, and saves nothing later, for a run the Workflow can no longer report on", async () => {
      const { music, release } = heldMusic();
      const harness = await lyricsHarness(music);
      await harness.post("/api/ode", MAKE_ODE);
      await composingOde(harness.get);

      // For example the API key was revoked, so every question to Render is refused.
      harness.workflow.refuseStatusChecks();
      harness.clock.advance(5 * 60_000);
      const waiting = await json<OdeBody>(await harness.get("/api/ode"));
      harness.clock.advance(6 * 60_000);
      const failed = await json<OdeBody>(await harness.get("/api/ode"));
      release();
      const outcomes = await harness.workflow.whenRunsEnd(1);

      expect(waiting).toEqual({ status: "making", steps: steps("done", "active", "waiting") });
      expect(failed).toEqual({ status: "failed", error: expect.stringContaining("Try again") });
      expect(outcomes).toEqual(["superseded"]);
      expect((await harness.get("/api/ode/audio")).status).toBe(404);
    });

    it("does nothing, and spends no lyrics, when the Workflow starts a run the web service has already given up on", async () => {
      let lyricsWritten = 0;
      const { post, get, workflow } = await createHarness({
        claude: fakeClaudeByTask({
          "extract-ledger": () => seedExtraction,
          "write-lyrics": () => {
            lyricsWritten += 1;
            return seedLyrics;
          },
        }),
      });
      await post("/api/ledger", { notes: seedNotes });
      const instanceStarts = workflow.holdNextRun();
      await post("/api/ode", MAKE_ODE);

      workflow.reportStartedRunsFailed();
      const gaveUp = await json<OdeBody>(await get("/api/ode"));
      instanceStarts();
      const outcomes = await workflow.whenRunsEnd(1);

      expect(gaveUp).toEqual({ status: "failed", error: expect.stringContaining("Try again") });
      expect(outcomes).toEqual(["superseded"]);
      expect(lyricsWritten).toBe(0);
      expect(await json<OdeBody>(await get("/api/ode"))).toEqual(gaveUp);
    });
  });

  describe("when a lyric line is flagged", () => {
    /** A music fake that counts the songs it is asked to compose. */
    function countingMusic() {
      const inner = fakeMusic();
      const spy = { composed: 0 };
      const music: ElevenMusic = {
        compose: async (chunks) => {
          spy.composed += 1;
          return inner.compose(chunks);
        },
      };
      return { music, spy };
    }

    it("refuses to make the Ode, naming each flagged line, and starts and composes nothing", async () => {
      const { music, spy } = countingMusic();
      const { post, patch, get } = await lyricsHarness(music);
      await patch("/api/lyrics/verses/Vikram/lines/3", { text: "Key lime pie for nine dollars" });
      await patch("/api/lyrics/hook", { text: "We ate at Chipotle, we were there" });
      await patch("/api/lyrics/chorus", { text: "Sing Hotel California to the friends" });

      const refused = await post("/api/ode", MAKE_ODE);

      expect(refused.status).toBe(422);
      const { error } = await json<{ error: string }>(refused);
      expect(error).toContain("Vikram's line 3");
      expect(error).toContain("the hook");
      expect(error).toContain("the chorus");
      expect(error).not.toContain("Tharun");
      expect(error).not.toContain("Sahiti");
      expect(await json<OdeBody>(await get("/api/ode"))).toEqual({ status: "none" });
      expect(spy.composed).toBe(0);
    });

    it("fails a run, composing nothing, when a line is flagged after the run started but before it read the lyrics", async () => {
      const { music, spy } = countingMusic();
      const { post, patch, get, workflow } = await lyricsHarness(music);
      const instanceStarts = workflow.holdNextRun();
      expect((await post("/api/ode", MAKE_ODE)).status).toBe(202);

      await patch("/api/lyrics/hook", { text: "We ate at Chipotle, we were there" });
      instanceStarts();
      const outcomes = await workflow.whenRunsEnd(1);

      expect(outcomes).toEqual(["failed"]);
      expect(await json<OdeBody>(await get("/api/ode"))).toEqual({ status: "failed", error: expect.stringMatching(/flagged/) });
      expect(spy.composed).toBe(0);
    });

    it("still answers 409 for an Ode already made, and the running status for a run in progress, whatever the lyrics say", async () => {
      const { post, patch, get } = await lyricsHarness();
      await post("/api/ode", MAKE_ODE);
      expectReady(await settledOde(get));
      await patch("/api/lyrics/hook", { text: "We ate at Chipotle, we were there" });

      expect((await post("/api/ode", MAKE_ODE)).status).toBe(409);
    });

    it("makes the Ode once the payer has fixed every flagged line", async () => {
      const { music, spy } = countingMusic();
      const { post, patch, get } = await lyricsHarness(music);
      await patch("/api/lyrics/verses/Vikram/lines/3", { text: "Key lime pie for nine dollars" });
      await patch("/api/lyrics/chorus", { text: "Sing Hotel California to the friends" });
      expect((await post("/api/ode", MAKE_ODE)).status).toBe(422);

      await patch("/api/lyrics/verses/Vikram/lines/3", { text: "Key lime pie at nine under the lights" });
      expect((await post("/api/ode", MAKE_ODE)).status).toBe(422);
      await patch("/api/lyrics/chorus", { text: "Here is to the friends who carried the trip" });
      const started = await post("/api/ode", MAKE_ODE);
      const ode = expectReady(await settledOde(get));

      expect(started.status).toBe(202);
      expect(verses(ode)[1]?.lines[2]?.text).toBe("Key lime pie at nine under the lights");
      expect(spy.composed).toBe(1);
    });

    it("stops a run that wrote a still-flagged line before composing, keeps the lyrics with their flags, and lets the payer fix and retry", async () => {
      const { music, spy } = countingMusic();
      const flagged = "Sahiti screamed at the gator for ninety bucks";
      const written = structuredClone(seedLyrics);
      written.friends[2]?.lines.splice(0, 1, flagged);
      const harness = await createHarness({
        music,
        claude: fakeClaudeByTask({
          "extract-ledger": () => seedExtraction,
          "write-lyrics": () => written,
          // The one rewrite is no better, so the line stays flagged.
          "rewrite-line": () => ({ line: "Sahiti screamed at the gator for fifty bucks" }),
        }),
      });
      await harness.post("/api/ledger", { notes: seedNotes });

      const started = await harness.post("/api/ode", MAKE_ODE);
      const failed = await settledOde(harness.get);

      expect(started.status).toBe(202);
      expect(failed).toEqual({ status: "failed", error: expect.stringContaining("lyrics") });
      expect(failed.status === "failed" && failed.error).toMatch(/flagged/i);
      expect(spy.composed).toBe(0);
      expect((await harness.get("/api/ode/audio")).status).toBe(404);
      const lyrics = await json<{ verses: { lines: { text: string; problems: string[] }[] }[] }>(await harness.get("/api/lyrics"));
      expect(lyrics.verses).toHaveLength(3);
      expect(lyrics.verses[2]?.lines[0]).toEqual({
        text: "Sahiti screamed at the gator for fifty bucks",
        problems: [expect.stringContaining("amount")],
      });

      // The saved lyrics are flagged now, so a retry is refused until the payer fixes the line.
      expect((await harness.post("/api/ode", MAKE_ODE)).status).toBe(422);
      await harness.patch("/api/lyrics/verses/Sahiti/lines/1", { text: "Sahiti screamed at the gator and laughed" });
      expect((await harness.post("/api/ode", MAKE_ODE)).status).toBe(202);
      expect((await settledOde(harness.get)).status).toBe("ready");
      expect(spy.composed).toBe(1);
    });
  });

  it("writes the lyrics first, as its first step, when none have been written", async () => {
    const harness = await createHarness({
      claude: fakeClaudeByTask({ "extract-ledger": () => seedExtraction, "write-lyrics": () => seedLyrics }),
    });
    await harness.post("/api/ledger", { notes: seedNotes });

    await harness.post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(harness.get));

    expect(verses(ode).map((v) => [v.friend, v.lines.map((l) => l.text)])).toEqual(
      seedLyrics.friends.map((f) => [f.name, f.lines]),
    );
    const lyrics = await json<{ verses: unknown[] }>(await harness.get("/api/lyrics"));
    expect(lyrics.verses).toHaveLength(3);
  });

  it("composes the lyrics as the payer edited them", async () => {
    const { post, patch, get } = await lyricsHarness();
    await patch("/api/lyrics/verses/Vikram/lines/3", { text: "Key lime pie at nine, the best of the trip" });
    await patch("/api/lyrics/hook", { text: "Oh we were there, always there" });

    await post("/api/ode", MAKE_ODE);
    const ode = expectReady(await settledOde(get));

    expect(verses(ode)[1]?.lines[2]?.text).toBe("Key lime pie at nine, the best of the trip");
    expect(ode.sections.filter((s) => s.kind === "hook").map((s) => s.kind === "hook" && s.text)).toEqual([
      "Oh we were there, always there",
      "Oh we were there, always there",
      "Oh we were there, always there",
    ]);
    // The edited line is still found where it is sung: its words were given to the singer.
    expect(verses(ode).map(relativeWindows)).toEqual([sungWindows, sungWindows, sungWindows]);
  });

  it("asks the payer to build the ledger first, and starts nothing, when it is empty or not ready", async () => {
    const empty = await createHarness();
    const noLedger = await empty.post("/api/ode", MAKE_ODE);
    expect(noLedger.status).toBe(422);
    expect((await json<{ error: string }>(noLedger)).error).toContain("Build the ledger first");
    expect(await json<OdeBody>(await empty.get("/api/ode"))).toEqual({ status: "none" });

    const claude = fakeClaudeByTask({
      "extract-ledger": () => ({
        friends: [{ name: "Vikram", amountOwedCents: null, amountIsEstimate: false, insideJoke: "The pier at nine" }],
        groupCosts: [],
      }),
    });
    const unfinished = await createHarness({ claude });
    await unfinished.post("/api/ledger", { notes: "vikram" });
    const missingAmount = await unfinished.post("/api/ode", MAKE_ODE);
    expect(missingAmount.status).toBe(422);
    expect((await json<{ error: string }>(missingAmount)).error).toContain("No amount found for Vikram");
    expect(await json<OdeBody>(await unfinished.get("/api/ode"))).toEqual({ status: "none" });
  });

  it("asks the payer to try again when Claude cannot write the lyrics, and makes the Ode on retry", async () => {
    let writing: Result<unknown, ClaudeUnavailable> = err(new ClaudeUnavailable("rate limited"));
    const ledgerReader = fakeClaudeByTask({ "extract-ledger": () => seedExtraction });
    const harness = await createHarness({
      claude: { structured: async (request) => (request.task === "write-lyrics" ? writing : ledgerReader.structured(request)) },
    });
    await harness.post("/api/ledger", { notes: seedNotes });

    await harness.post("/api/ode", MAKE_ODE);
    const failed = await settledOde(harness.get);

    expect(failed).toEqual({ status: "failed", error: expect.stringContaining("lyrics") });
    expect(await json<{ verses: unknown[] }>(await harness.get("/api/lyrics"))).toEqual({ verses: [], hook: null, chorus: null });

    writing = ok(seedLyrics);
    await harness.post("/api/ode", MAKE_ODE);
    expect((await settledOde(harness.get)).status).toBe("ready");
  });

  it("refuses to make a second Ode over the first", async () => {
    const { post, get } = await lyricsHarness();
    await post("/api/ode", MAKE_ODE);
    const first = expectReady(await settledOde(get));

    const again = await post("/api/ode", MAKE_ODE);

    expect(again.status).toBe(409);
    expect((await json<{ error: string }>(again)).error).toContain("already made");
    expect(await json<OdeBody>(await get("/api/ode"))).toEqual(first);
  });

  it("drops the Ode, and its audio, when new trip notes replace the ledger", async () => {
    const { post, get } = await lyricsHarness();
    await post("/api/ode", MAKE_ODE);
    expectReady(await settledOde(get));

    await post("/api/ledger", { notes: seedNotes });

    expect(await json<OdeBody>(await get("/api/ode"))).toEqual({ status: "none" });
    expect((await get("/api/ode/audio")).status).toBe(404);
  });

  describe("playing the Ode", () => {
    async function madeOde() {
      const harness = await lyricsHarness();
      await harness.post("/api/ode", MAKE_ODE);
      const ode = expectReady(await settledOde(harness.get));
      return { ...harness, ode };
    }
    // The fake Eleven Music returns 256 bytes: 0, 1, 2 ... 255.
    const bytes = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

    it("serves the composed audio from the address the status gives", async () => {
      const { get, ode } = await madeOde();

      const res = await get(ode.audioUrl);

      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toBe("audio/mpeg");
      expect(res.headers.get("accept-ranges")).toBe("bytes");
      expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(bytes(0, 255));
    });

    it("serves a byte range, so a browser can seek", async () => {
      const { request, ode } = await madeOde();

      const slice = await request(ode.audioUrl, { headers: { range: "bytes=10-19" } });
      const tail = await request(ode.audioUrl, { headers: { range: "bytes=250-" } });
      const last = await request(ode.audioUrl, { headers: { range: "bytes=-4" } });

      expect(slice.status).toBe(206);
      expect(slice.headers.get("content-range")).toBe("bytes 10-19/256");
      expect([...new Uint8Array(await slice.arrayBuffer())]).toEqual(bytes(10, 19));
      expect(tail.headers.get("content-range")).toBe("bytes 250-255/256");
      expect([...new Uint8Array(await tail.arrayBuffer())]).toEqual(bytes(250, 255));
      expect([...new Uint8Array(await last.arrayBuffer())]).toEqual(bytes(252, 255));
    });

    it.each(["bytes=abc", "bytes=-", "bytes=9-5", "bytes=0-1,5-6", "items=0-9"])(
      "serves the whole audio for the Range header %s, which it does not serve",
      async (range) => {
        const { request, ode } = await madeOde();

        const res = await request(ode.audioUrl, { headers: { range } });

        expect(res.status).toBe(200);
        expect([...new Uint8Array(await res.arrayBuffer())]).toEqual(bytes(0, 255));
      },
    );

    it("refuses a range that asks for the last zero bytes", async () => {
      const { request, ode } = await madeOde();

      expect((await request(ode.audioUrl, { headers: { range: "bytes=-0" } })).status).toBe(416);
    });

    it("refuses a range that starts past the end of the audio", async () => {
      const { request, ode } = await madeOde();

      const res = await request(ode.audioUrl, { headers: { range: "bytes=256-300" } });

      expect(res.status).toBe(416);
      expect(res.headers.get("content-range")).toBe("bytes */256");
    });

    it("has no audio before an Ode is made, or after a failed run", async () => {
      const music = fakeMusic();
      const { get, post } = await lyricsHarness(music);
      expect((await get("/api/ode/audio")).status).toBe(404);

      music.failNextCompose();
      await post("/api/ode", MAKE_ODE);
      await settledOde(get);

      expect((await get("/api/ode/audio")).status).toBe(404);
    });
  });
});
