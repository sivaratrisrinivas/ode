import { readFileSync, writeFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import { writeFallbackRecording } from "../src/ops/fallback-recording.ts";
import { clipPlan, decide, readElevenCredits, renderReport, runClip, type Credits, type RunRecord } from "../src/ops/reliability.ts";
import { buildSeededOde } from "../src/ops/seed-ode.ts";
import { createAnthropicClaude } from "../src/server/claude.ts";
import { createElevenMusic } from "../src/server/eleven-music.ts";
import type { Sql } from "../src/server/ports.ts";
import { migrate } from "../src/server/schema.ts";
import { seedLyrics } from "../test/seed.ts";

/**
 * The reliability runs (#16): N clip runs of 35 s and one full Ode run through the real pipeline (Claude and Eleven Music),
 * logged to `notes/reliability-<date>.md` with each run's result, failure tag, seconds and ElevenLabs credits.
 *
 *   node --env-file=.env scripts/reliability.ts [--smoke] [--clips 10] [--no-full]
 *
 * `--smoke` makes one clip run and stops: the cheap check before the real thing. The full run builds the Seeded Ode from
 * `seed/notes.txt` in in-process Postgres (the hosted database is not needed to measure the pipeline) and keeps it as the
 * recorded fallback in `seed/`. It stops early, without spending more, after 3 failures in a row (a bad key or no credits is
 * not a reliability number). Needs ELEVENLABS_API_KEY and ANTHROPIC_API_KEY.
 */
const args = process.argv.slice(2);
const smoke = args.includes("--smoke");
const clipCount = smoke ? 1 : Number(args[args.indexOf("--clips") + 1] || 10);
const withFull = !smoke && !args.includes("--no-full");
const MAX_CONSECUTIVE_FAILURES = 3;

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set; run with node --env-file=<path to .env>`);
  return value;
}
const elevenKey = requireEnv("ELEVENLABS_API_KEY");
const anthropicKey = requireEnv("ANTHROPIC_API_KEY");

// Claude's port returns the answer only, so the tokens are read off the API replies as they pass.
const claude = { calls: 0, inputTokens: 0, outputTokens: 0 };
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const response = await realFetch(input, init);
  if (String(input instanceof Request ? input.url : input).startsWith("https://api.anthropic.com/") && response.ok) {
    try {
      const usage: unknown = (await response.clone().json())?.usage;
      const tokens = (name: string) => (typeof usage === "object" && usage !== null && typeof Reflect.get(usage, name) === "number" ? Number(Reflect.get(usage, name)) : 0);
      claude.calls += 1;
      claude.inputTokens += tokens("input_tokens");
      claude.outputTokens += tokens("output_tokens");
    } catch {
      // A reply whose usage cannot be read only leaves the token count short.
    }
  }
  return response;
};

const music = createElevenMusic({ apiKey: elevenKey });
const realClaude = createAnthropicClaude(anthropicKey);

async function balance(): Promise<Credits | undefined> {
  const credits = await readElevenCredits({ apiKey: elevenKey });
  if (credits._tag === "err") console.warn("could not read the ElevenLabs balance:", credits.error.message);
  return credits._tag === "ok" ? credits.value : undefined;
}

/** ElevenLabs updates the balance some seconds after a run, so read it until two reads 20 s apart agree (at most 5 reads). */
async function settledBalance(): Promise<Credits | undefined> {
  let last = await balance();
  for (let attempt = 0; attempt < 4; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 20_000));
    const next = await balance();
    if (next?.used === last?.used) return next;
    last = next;
  }
  return last;
}

const records: RunRecord[] = [];
const creditsBefore = await balance();
console.log(`ElevenLabs credits before: ${creditsBefore ? `${creditsBefore.used} of ${creditsBefore.limit}` : "unknown"}`);

const lines = seedLyrics.friends[0]?.lines ?? [];
const plan = clipPlan(lines, seedLyrics.hook);
let consecutive = 0;
let stoppedEarly = false;
let afterClips: Credits | undefined = creditsBefore;
for (let n = 1; n <= clipCount; n++) {
  const started = performance.now();
  const run = await runClip(music, plan);
  const seconds = (performance.now() - started) / 1000;
  const record: RunRecord = run._tag === "ok" ? { kind: "clip", label: `clip ${n}`, ok: true, seconds } : { kind: "clip", label: `clip ${n}`, ok: false, tag: run.error._tag, seconds };
  records.push(record);
  console.log(`clip ${n}: ${run._tag === "ok" ? `ok, audio ${run.value.audioSeconds.toFixed(1)} s` : `FAILED ${run.error._tag}: ${String(run.error.cause ?? run.error.message)}`} in ${seconds.toFixed(1)} s`);

  consecutive = record.ok ? 0 : consecutive + 1;
  if (consecutive >= MAX_CONSECUTIVE_FAILURES) {
    console.error(`${MAX_CONSECUTIVE_FAILURES} failures in a row: stopping instead of spending more credits.`);
    stoppedEarly = true;
    break;
  }
  // After the first clip, check there are credits for the rest at the rate it showed (the full Ode is about 3 clips long), with half as much again to spare.
  if (n === 1 && record.ok && clipCount > 1) {
    afterClips = await settledBalance();
    const perClip = creditsBefore && afterClips ? afterClips.used - creditsBefore.used : undefined;
    console.log(`first clip used ${perClip ?? "?"} credits (this includes anything else using the account)`);
    if (perClip !== undefined && afterClips) {
      const needed = Math.ceil(perClip * ((clipCount - 1) + (withFull ? 3 : 0)) * 1.5);
      if (afterClips.limit - afterClips.used < needed) {
        console.error(`Only ${afterClips.limit - afterClips.used} credits left; this needs about ${needed}. Stopping.`);
        stoppedEarly = true;
        break;
      }
    }
  }
}
const clipsMade = records.length;
if (clipsMade > 1 || smoke) afterClips = await settledBalance();
const clipCredits = creditsBefore && afterClips ? afterClips.used - creditsBefore.used : undefined;

const seedNotes = readFileSync(new URL("../seed/notes.txt", import.meta.url), "utf8");
let fallbackSaved = false;
if (withFull && !stoppedEarly) {
  const db = await PGlite.create();
  const sql: Sql = { query: (text, params) => db.query(text, params), transaction: (work) => db.transaction((tx) => work(tx)) };
  await migrate(sql);
  const now = new Date();
  const releaseDate = new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  const started = performance.now();
  const built = await buildSeededOde({ sql, claude: realClaude, music, notes: seedNotes, now, releaseDate });
  const seconds = (performance.now() - started) / 1000;
  const afterFull = await settledBalance();
  const credits = afterClips && afterFull ? afterFull.used - afterClips.used : undefined;
  if (built._tag === "ok") {
    records.push({ kind: "full", label: "full Ode", ok: true, seconds, credits });
    writeFallbackRecording(new URL("../seed/", import.meta.url).pathname, built.value, { madeAt: now, source: "seed/notes.txt (invented placeholder notes)" });
    fallbackSaved = true;
    console.log(`full Ode: ok, ${built.value.ode.durationMs / 1000} s of song in ${seconds.toFixed(1)} s, ${credits ?? "?"} credits; saved seed/seeded-ode-fallback.*`);
  } else {
    records.push({ kind: "full", label: "full Ode", ok: false, tag: built.error.tag, seconds, credits });
    console.error(`full Ode: FAILED ${built.error.message}`);
  }
}

const creditsAfter = await settledBalance();
const date = new Date().toISOString().slice(0, 10);
const report = renderReport({ date, records, creditsBefore, creditsAfter, claude });
const outFile = new URL(`../notes/${smoke ? "reliability-smoke" : `reliability-${date}`}.md`, import.meta.url);
const context = [
  "## How these runs were made",
  "",
  `- Command: \`node --env-file=.env scripts/reliability.ts${smoke ? " --smoke" : ""}\` (\`src/ops/reliability.ts\` holds the logic).`,
  `- Clip runs: ${clipCount} requested, ${records.filter((record) => record.kind === "clip").length} made${stoppedEarly ? " (stopped early, see below)" : ""}. Each is a 35 s plan (intro 6 s, four 5 s lines of one friend, hook 9 s: the day-1 probe's shape) sent to Eleven Music v2.5 with word timestamps; it passes when Eleven answers and the audio is within 3 s of 35 s.`,
  `- Full run: ${withFull ? "the real pipeline in in-process Postgres (the hosted database is Render-internal and not reachable from here): Claude extracts the ledger from `seed/notes.txt`, writes the lyrics, then Eleven Music composes the whole Ode (intro, three verses, two hooks, chorus). It is the same code the app's Workflow task runs." : "not run."}`,
  `- Notes used: \`seed/notes.txt\`, which is **invented placeholder data**, not the real Florida notes. Costs are for those notes; the real ones are the same size, so they should cost about the same.`,
  `- Clip credits: ${clipCredits ?? "unknown"} in all for ${clipsMade} clips (about ${clipCredits === undefined || clipsMade === 0 ? "?" : Math.round(clipCredits / clipsMade)} each). The per-run column is blank for clips because the balance lags a run by several seconds; the full run's figure is the balance change over it.`,
  `- Credits are ElevenLabs's \`character_count\` from \`GET /v1/user/subscription\`, read before the runs and again once the balance settled, so anything else using the account at the same time (here, the #35 voice work) is counted in. Claude is reported in tokens only: the app's Claude port does not price calls.`,
  `- Recorded fallback: ${fallbackSaved ? "`seed/seeded-ode-fallback.mp3` with `seed/seeded-ode-fallback.json`; the JSON labels it a RECORDING. It is Eleven Music's own vocals, not the cloned voice (that is #35)." : "not saved (the full run did not succeed)."}`,
  ...(stoppedEarly ? ["- **Stopped early**: 3 failures in a row or too few credits left. Failures like that are a setup problem, not a reliability rate; fix it and run again."] : []),
  "",
].join("\n");
writeFileSync(outFile, `${report}\n${context}`);
console.log(`\n${report}\nwrote ${outFile.pathname}`);
console.log(`decision: ${decide(records)}`);
process.exit(records.some((record) => !record.ok) ? 1 : 0);
