# Running the app

Real keys are not needed to see a change working. `npm run dev:fake` builds the page and serves the real API
over in-process Postgres, with the test fakes for Claude and Eleven Music (`src/testing/dev-fake.ts`).
Open http://localhost:3000 (`PORT` changes it). State is in memory and ends with the process.

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
  Building a ledger over an existing one asks `window.confirm`; a fresh `dev:fake` process has none.
- Stop it with `kill $(lsof -ti :$PORT)`. `pkill -f dev-fake` also matches the shell running it and kills that.

The webhook is `POST /api/payments/webhook`; under `dev:fake` it trusts a request whose `paypal-transmission-sig` header is `valid`. After a payment the page shows a green unlock banner, flares the new lines and plays the first of them.

`npm run dev:server` is the real thing and needs `DATABASE_URL`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`, plus `PAYPAL_CLIENT_ID`, `PAYPAL_CLIENT_SECRET` and `FRIEND_PAYPAL_ACCOUNTS` to pay friends (and `PAYPAL_WEBHOOK_ID` to trust the capture webhook) (see `.env.example`).
