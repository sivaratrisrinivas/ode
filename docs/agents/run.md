# Running the app

Real keys are not needed to see a change working. `npm run dev:fake` builds the page and serves the real API
over in-process Postgres, with the test fakes for Claude and Eleven Music (`src/testing/dev-fake.ts`).
Open http://localhost:3000 (`PORT` changes it). State is in memory and ends with the process.

- `FAKE_FLAGGED=1 npm run dev:fake`: Claude writes one lyric line with an amount no rewrite fixes, so the page shows a flagged line.
- The page flow: paste any notes, "Build the ledger", "Write the lyrics", "Make the Ode".
- To drive it headless, use `playwright-core` with the Chromium in `~/.cache/ms-playwright`.

`npm run dev:server` is the real thing and needs `DATABASE_URL`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` (see `.env.example`).
