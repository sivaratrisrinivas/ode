# Running the app

Real keys are not needed to see a change working. `npm run dev:fake` builds the page and serves the real API
over in-process Postgres, with the test fakes for Claude and Eleven Music (`src/testing/dev-fake.ts`).
Open http://localhost:3000 (`PORT` changes it). State is in memory and ends with the process.
`/` is the split screen every visitor lands on; the payer's page alone is `/payer`. A visitor works on the Seeded Ode (the shared ledger and Ode, once made) until they press "Make my own Ode" in the split screen's bar; then the ledger, lyrics, Ode and payments they make are theirs alone (an Own Ode, keyed by the `ode_visitor` cookie), and "Back to the Seeded Ode" forgets it. On the Seeded Ode, payments are per browser, and "Reset demo" clears only your browser's. At most 5 Own Odes start a day (UTC, from the fake clock) across all visitors; the sixth visitor is told and stays on the Seeded Ode. An Own Ode takes 1 to 3 friends, paid through the first accounts of `FRIEND_PAYPAL_ACCOUNTS` in ledger order. Under `dev:fake`, notes that mention "Goa" give two friends (Meera and Dev); any other notes give the seed's three.

- `FAKE_FLAGGED=1 npm run dev:fake`: Claude writes one lyric line with an amount no rewrite fixes, so the page shows a flagged line.
- The page flow: paste any notes, "Build the ledger", "Write the lyrics", pick a "Release date" (required, a month out by default; "Make the Ode" waits until there is one), "Make the Ode", then pay a friend. With no PayPal client ID the page shows a plain "Pay <friend>" button instead of PayPal's popup; the server runs the same create, read-back and capture against a fake PayPal.

## Driving the page

`scripts/browser.mjs` launches the headless Chromium both page drivers use. It imports `playwright-core` from `~/.cache/ode-browser/pw/node_modules/playwright-core/index.mjs` (`PLAYWRIGHT_CORE` names another `index.mjs`) and the cached Chromium under `~/.cache/ms-playwright`, and puts `~/.cache/ode-browser/libs/usr/lib/x86_64-linux-gnu` on `LD_LIBRARY_PATH` when it exists (`CHROMIUM_LIBS` names another directory). It prints the fix when either is missing.

On a machine without them: `npm i playwright-core@1.63.0` in a scratch directory, `npx playwright-core install chromium`, and set `PLAYWRIGHT_CORE`. Chromium also needs `libnspr4`, `libnss3` and `libasound2t64`: `sudo apt install` them, or `apt-get download` the three, `dpkg-deb -x` each into one directory and set `CHROMIUM_LIBS` to its `usr/lib/x86_64-linux-gnu`.

Building a ledger over an existing one asks `window.confirm`; a fresh `dev:fake` process has none. A second tab needs `browser.newContext()` then `context.newPage()`; `browser.newPage()` forbids `context.newPage()`.

`node scripts/drive-fake.mjs [shot.png]` drives a running `dev:fake` (`PORT`) through every screen; its header comment and the comments at each phase say what each phase asserts, so read the script, not a copy here. The fake Ode's audio is junk bytes, so nothing is audible: the script records each `play()` request and where it started instead. The unlock time it prints includes the payer's order and capture requests, so 300 to 2400 ms on a loaded machine (the API test measures from the end of the payment).

## The 3D cassette

The cassette on every page that plays an Ode is a 3D scene (`src/client/scene/`), loaded on demand. A device without WebGL, or with WebGL only on the processor, gets the flat cassette in the same space; so does a device the scene measures at a few frames a second. `scripts/drive-fake.mjs` runs with WebGL off (`--disable-3d-apis`) and checks the flat one, because the headless browser draws WebGL at a few frames a second and that starves the page's timers. To look at the 3D one, open the page in a real browser, or run `PORT=3000 node scripts/shot-3d.mjs <outdir>` against a `dev:fake` whose Ode is made: it sets `localStorage["ode:3d"] = "force"` and saves screenshots for a person to judge.

## What the fakes show

- The verse share: once a friend has a line unlocked their page shows "Share my verse", which makes a link `/s/<token>` (no button before). `/s/<token>` is the share's page; its HTML carries the Open Graph and Twitter tags a chat app reads (`curl` it to see them), `/s/<token>/card.png` is the 1200 x 630 preview image, `/api/shares/<token>` the data and `/api/shares/<token>/audio` the clip. `dev:fake` reads `dist/index.html` once at start, so restart it after a `vite build`.
- The release date: the Ode shows "N of 3 friends · D days to drop" on the payer's page and every friend's view, and "Delayed · N of 3 friends repaid · was due <date>" once the date has passed with a friend unpaid (the chorus stays locked). The fake clock never moves by itself; `POST /dev/clock/advance-days` with `{"days": 11}` (dev-fake only) moves it. `POST /api/ode` without a date is a 422.
- The voice label: the Seeded Ode is unlabelled until the one-off conversion runs, then every pane of it reads "in my voice"; an Own Ode never does, and making the Seeded Ode again (building its ledger over) takes the label away with the converted audio. `dev:fake` has `POST /dev/seed-voice`, the same conversion as `npm run seed:voice` with a fake ElevenLabs and ffmpeg (a second call answers 409). The label's words are in `src/server/voice.ts`; `VOICE_LABEL=like` switches them to "a voice like mine".
- `npm test` takes 2 to 7 minutes: run it in the foreground with a 10-minute timeout and wait for it to finish before you report done; a test run left in the background makes you report again when it ends. Every run writes its failures to `.vitest/last.json`.

- A git worktree has no `node_modules` and no `.env`: run `npm ci` first, and pass the main checkout's `.env` with `node --env-file=<path>` when a command needs keys.

The reliability runs (#16) use real keys and spend credits, so they are the one thing here that does not run with fakes. `npm run reliability -- --smoke` makes one 35 s clip and stops (each clip also reports whether its line windows were `aligned` from the word timestamps or fell to `equal-quarter fallback`); `npm run reliability` makes 10 clips and one full Ode from `seed/notes.txt` in in-process Postgres, and writes `notes/reliability-<date>.md` and the recorded fallback in `seed/` (see `seed/README.md`). It needs `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` in `.env` (or run `node --env-file=<path to .env> scripts/reliability.ts` from a worktree) and stops after 3 failures in a row. `npm run seed:ode` builds the Seeded Ode into `DATABASE_URL`'s database (on Render, from the web service's Shell).

Converting the Seeded Ode into the payer's voice (once, #35) spends ElevenLabs credits and runs on the payer's own machine: see `docs/agents/seed-voice.md`.

## The hosted site

The hosted service's settings cannot be read from here (the Render tools see only another workspace, and its logs are not reachable). `GET <app>/api/health` answers `config`: a yes or no for each setting (`anthropic`, `elevenlabs`, `paypalClient`, `friendAccounts`, `paypalWebhookId` set and shaped like an id, never a value). After any change to the service's environment and a redeploy, `curl` it; `elevenlabs` is false on Render by design, because only the Workflow task needs it.

`node --env-file=.env scripts/drive-live.mjs <url>` checks that health and that the page loads without console errors. Add `--spend` to also make an Own Ode from `seed/notes.txt` (about 1.3k ElevenLabs credits and one of the day's 5 Own Ode places) and pay the first friend $50 through the real PayPal sandbox popup, logging in with `PAYPAL_BUYER_EMAIL` and `PAYPAL_BUYER_PASSWORD` from `.env`; it fails unless the capture answers 200 with two lines unlocked. PayPal's delivery status for the webhook is only in its dashboard (Webhook Events, status Success): the script prints the newest capture event to look up.

The webhook is `POST /api/payments/webhook`; under `dev:fake` it trusts a request whose `paypal-transmission-sig` header is `valid`. After a payment the page shows a green unlock banner, flares the new lines and plays the first of them.

`node --env-file=.env scripts/webhook-check.ts` (a worktree has no `.env`: pass the main checkout's) checks PayPal's capture webhook against the sandbox only (#4): it lists the sandbox app's webhooks and says whether `PAYPAL_WEBHOOK_ID` is a real webhook id (not a URL), whether a webhook posts to `<app>/api/payments/webhook`, and whether it is subscribed to `PAYMENT.CAPTURE.COMPLETED`; it exits 0 when all hold, 2 when not. It is read-only and never edits `.env` or prints a secret. `--simulate` also has PayPal's simulator send one `PAYMENT.CAPTURE.COMPLETED` (PayPal answers 202; the app answers a simulated event 401 by design). The parsing is unit-tested (`test/webhook-check.test.ts`); the calls to PayPal are not.

`npm run dev:server` is the real thing and needs `DATABASE_URL`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`, plus `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `FRIEND_PAYPAL_ACCOUNTS` to pay friends (and `PAYPAL_WEBHOOK_ID` to trust the capture webhook) (see `.env.example`). They live in `.env` at the repo root (gitignored); `dev:server` and `start` load it, and variables already in the shell win. A git worktree has no `.env`.
