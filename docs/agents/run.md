# Running the app

Real keys are not needed to see a change working. `npm run dev:fake` builds the page and serves the real API
over in-process Postgres, with the test fakes for Claude and Eleven Music (`src/testing/dev-fake.ts`).
Open http://localhost:3000 (`PORT` changes it). State is in memory and ends with the process.
`/` is the split screen every visitor lands on; the payer's page alone is `/payer`. The ledger and Ode are shared (the Seeded Ode, once made); payments are per browser, keyed by the `ode_visitor` cookie, and the split screen's "Reset demo" button clears only your browser's.

- `FAKE_FLAGGED=1 npm run dev:fake`: Claude writes one lyric line with an amount no rewrite fixes, so the page shows a flagged line.
- The page flow: paste any notes, "Build the ledger", "Write the lyrics", "Make the Ode", then pay a friend. With no PayPal client ID the page shows a plain "Pay <friend>" button instead of PayPal's popup; the server runs the same create, read-back and capture against a fake PayPal.
- To drive it headless, import `playwright-core` from the bun cache (it is not in `node_modules`) and launch the cached Chromium:
  ```js
  import { chromium } from "/home/srinivas/.bun/install/cache/playwright-core@1.63.0@@@1/index.mjs";
  const browser = await chromium.launch({
    executablePath: `${process.env.HOME}/.cache/ms-playwright/chromium-1243/chrome-linux64/chrome`,
    args: ["--autoplay-policy=no-user-gesture-required"],
  });
  ```
  On a machine without that cache, `npm i playwright-core@1.63.0` in a scratch directory, `npx playwright-core install chromium`, and point `PLAYWRIGHT_CORE=<that dir>/node_modules/playwright-core/index.mjs` at it when running `drive-fake.mjs`. Chromium also needs `libnspr4`, `libnss3` and `libasound2t64`: `sudo apt install` them, or `apt-get download` the three, `dpkg-deb -x` each into a directory and set `LD_LIBRARY_PATH` to its `usr/lib/x86_64-linux-gnu`.
  Building a ledger over an existing one asks `window.confirm`; a fresh `dev:fake` process has none. A second tab needs `browser.newContext()` then `context.newPage()`; `browser.newPage()` forbids `context.newPage()`.
- `node scripts/drive-fake.mjs [shot.png]` runs that whole flow against a running `dev:fake` (`PORT`), opens Tharun's friend link in a second tab (`/f/<token>`, shown under his name on the payer's page) and pays Tharun $50, printing how long his open tab took to show the unlock (that includes the payer's order and capture requests, so 300 to 2400 ms on a loaded machine; the API test measures from the end of the payment), then rebuilds the ledger and checks his tab says the link no longer works. It ends on `/split` (the payer's page in the left iframe as `/?quiet`, a friend picker and that friend's `/f/<token>` view in the right one): it makes a new Ode, pays Tharun $50 on the left, asserts the right pane unlocked and played while the left stayed quiet, clicks through Vikram, Sahiti and Tharun, and checks the panes sit side by side wide and stack at 390 px (screenshot `split-<shot.png>`). It then opens `/` in a second browser context (its own cookie) and checks that browser's copy is unpaid while the first still has Tharun's $50, that paying in one leaves the other alone and a reload keeps each, that "Reset demo" clears only its own browser's copy, and that clearing the cookie gives a fresh copy. The fake Ode's audio is junk bytes, so nothing is audible; the script records each `play()` request and where it started instead.
- Stop it with `kill $(lsof -ti :$PORT)`. A hook blocks `pkill -f` and `pgrep -f`, which match the shell running them.
- `npm test` takes 2 to 7 minutes: run it in the background. Every run writes its failures to `.vitest/last.json`.

The webhook is `POST /api/payments/webhook`; under `dev:fake` it trusts a request whose `paypal-transmission-sig` header is `valid`. After a payment the page shows a green unlock banner, flares the new lines and plays the first of them.

`npm run dev:server` is the real thing and needs `DATABASE_URL`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`, plus `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `FRIEND_PAYPAL_ACCOUNTS` to pay friends (and `PAYPAL_WEBHOOK_ID` to trust the capture webhook) (see `.env.example`).
