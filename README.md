# Ode

A song about a shared trip, sung for the friends who covered the payer's costs, where each friend's lines unlock as the payer pays that friend back.

Vocabulary: [`GLOSSARY.md`](GLOSSARY.md). Decisions: [`docs/adr/`](docs/adr/). Plan: [`docs/plan/`](docs/plan/).

## Develop

Needs Node 24+ and a Postgres database.

```sh
npm install
cp .env.example .env        # fill in DATABASE_URL
npm run build               # builds the React client into dist/
node --env-file=.env src/server/main.ts
```

`npm run dev:client` runs Vite with `/api` proxied to the server.

## How the Ode is made

"Make the Ode" runs the song pipeline (lyrics, compose, line windows, store) as one task, `make-ode`, of a [Render Workflow](https://render.com/docs/workflows). The web service records the run in Postgres, starts the task with the Render SDK, and polls it. The task writes each step (writing, composing, finding lines) to Postgres as it goes, and that is what the status steps show; Render's own run status only tells the web service whether the run is still alive, so a run that dies shows as failed with a retry instead of spinning forever.

- Web service: `src/server/` (`ode-service.ts` starts and polls, `render-workflow.ts` talks to Render).
- Workflow task: `src/workflow/` (`index.ts` registers the task and is the Workflow's start command). It reads `DATABASE_URL`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY` from its own environment when a run starts, never when the file loads.
- Render runs the task once and never retries it, because a retry would compose, and pay for, the song again. The payer's "Try again" is the retry.

Both services are in `render.yaml`. Two things are not in the file and are set by hand:

- `RENDER_API_KEY` on the web service: an API key from Render account settings.
- The `sync: false` secrets (`ANTHROPIC_API_KEY` on both services, `ELEVENLABS_API_KEY` on the workflow): Render asks for them when the Blueprint is created or synced; if it does not, set them in the dashboard.

Without `RENDER_API_KEY` and `ODE_WORKFLOW_SLUG`, and off Render, the web service runs the same job inside its own process so that local development needs no Render account (it then also needs `ELEVENLABS_API_KEY`). On Render, or with only one of the two set, startup stops with a message naming the missing variable, never a quiet fallback to the web service process. A deploy that cannot start the Workflow therefore fails, and Render keeps serving the previous deploy, so set `RENDER_API_KEY` before merging.

## Test

```sh
npm test            # API tests: in-process Postgres, fakes for Claude, Eleven Music, PayPal, the clock and the Workflow
npm run check       # tsc, and every type assertion has a SAFETY comment
```

Tests drive the HTTP API only (`test/harness.ts`). The fake Workflow runs the task's job in the test process with its own database stores, as a separate process would. `test/render-workflow.test.ts` and `test/workflow-config.test.ts` cover the two pieces that only touch Render's SDK and the environment.

## License

[MIT](LICENSE)
