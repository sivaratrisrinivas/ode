import { readFileSync } from "node:fs";
import pg from "pg";
import { writeFallbackRecording } from "../src/ops/fallback-recording.ts";
import { buildSeededOde } from "../src/ops/seed-ode.ts";
import { createAnthropicClaude } from "../src/server/claude.ts";
import { createElevenMusic } from "../src/server/eleven-music.ts";
import { createPostgresSql } from "../src/server/postgres.ts";
import { migrate } from "../src/server/schema.ts";

/**
 * The operator's one-off: build the Seeded Ode for real from `seed/notes.txt` in the database the app serves (#16).
 *
 *   node --env-file=.env scripts/seed-ode.ts [--replace] [--release YYYY-MM-DD] [--save-fallback]
 *
 * Needs DATABASE_URL (where the app's database is reachable: on Render, run it from the web service's Shell; the internal URL
 * does not resolve from a laptop), ANTHROPIC_API_KEY and ELEVENLABS_API_KEY. Spends one ledger call, one lyrics call and one
 * whole-Ode Eleven Music song. `--replace` builds over an existing Seeded Ode (its friends' links and every visitor's paid copy
 * go with it); without it an existing one is left alone. `--save-fallback` also writes the audio to `seed/` as the labeled
 * recorded fallback. The release date defaults to 21 days from now.
 */
const args = process.argv.slice(2);
const replace = args.includes("--replace");
const saveFallback = args.includes("--save-fallback");
const releaseFlag = args.indexOf("--release");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set`);
  return value;
}

const now = new Date();
const releaseDate = releaseFlag === -1 ? new Date(now.getTime() + 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10) : (args[releaseFlag + 1] ?? "");

const pool = new pg.Pool({ connectionString: requireEnv("DATABASE_URL") });
const sql = createPostgresSql(pool);
try {
  await migrate(sql);
  const built = await buildSeededOde({
    sql,
    claude: createAnthropicClaude(requireEnv("ANTHROPIC_API_KEY")),
    music: createElevenMusic({ apiKey: requireEnv("ELEVENLABS_API_KEY") }),
    notes: readFileSync(new URL("../seed/notes.txt", import.meta.url), "utf8"),
    now,
    releaseDate,
    replace,
  });
  if (built._tag === "err") {
    console.error(built.error.message);
    process.exitCode = 1;
  } else {
    const { ledger, ode } = built.value;
    console.log(`Seeded Ode built: ${ledger.trip}, ${ledger.rows.length} friends, ${ode.durationMs / 1000} s, releases ${releaseDate}.`);
    for (const row of ledger.rows) console.log(`  ${row.friend}: ${row.amountOwedCents ?? "no amount"} cents owed (${row.amountStatus})`);
    for (const warning of ledger.warnings) console.log(`  warning: ${warning}`);
    if (saveFallback) {
      writeFallbackRecording(new URL("../seed/", import.meta.url).pathname, built.value, { madeAt: now, source: "seed/notes.txt" });
      console.log("Saved the recorded fallback to seed/seeded-ode-fallback.mp3 and .json.");
    }
  }
} finally {
  await pool.end();
}
