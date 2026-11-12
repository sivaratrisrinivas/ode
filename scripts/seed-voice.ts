// One-off: convert the Seeded Ode's stored audio into the payer's cloned voice and replace it (ADR 0002, #35).
// Needs DATABASE_URL, ELEVENLABS_API_KEY and ELEVENLABS_VOICE_ID, and ffmpeg on the PATH (or FFMPEG_PATH).
// Run it once, with `npm run seed:voice`; see docs/agents/run.md. Nothing is printed of the keys.
import pg from "pg";
import { createElevenVoice } from "../src/server/eleven-voice.ts";
import { createFfmpegAudio } from "../src/server/ffmpeg-audio.ts";
import { createPostgresSql } from "../src/server/postgres.ts";
import { migrate } from "../src/server/schema.ts";
import { convertSeededVoice } from "../src/server/voice-conversion.ts";

/** A variable the command cannot run without; the process ends naming it when it is missing. */
function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`${name} is not set.`);
    process.exit(1);
  }
  return value;
}

const databaseUrl = required("DATABASE_URL");
const apiKey = required("ELEVENLABS_API_KEY");
const voiceId = required("ELEVENLABS_VOICE_ID");

// Add ?sslmode=require to the URL for Render's external connection string.
const pool = new pg.Pool({ connectionString: databaseUrl });
try {
  console.log(`Converting the Seeded Ode in the database at ${new URL(databaseUrl).host} ...`);
  const sql = createPostgresSql(pool);
  // The stored Ode needs the voice column, which the web service adds on boot; the command must not depend on it having booted.
  await migrate(sql);

  const converted = await convertSeededVoice({
    sql,
    voice: createElevenVoice({ apiKey, voiceId }),
    audio: createFfmpegAudio(process.env["FFMPEG_PATH"] ? { ffmpeg: process.env["FFMPEG_PATH"] } : {}),
  });
  if (converted._tag === "err") {
    console.error(`${converted.error.message}${converted.error.cause === undefined ? "" : ` (${String(converted.error.cause)})`}`);
    process.exitCode = 1;
  } else {
    const { originalMs, convertedMs } = converted.value;
    console.log(`Done. The Seeded Ode's audio is now in the payer's voice: ${originalMs} ms before, ${convertedMs} ms after (${convertedMs - originalMs} ms apart).`);
    console.log("Check the line windows by ear: open the page, click each line, and listen that it starts on its words.");
  }
} finally {
  await pool.end();
}
