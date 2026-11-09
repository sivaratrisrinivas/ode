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

## Test

```sh
npm test            # API tests: in-process Postgres, fakes for Claude, Eleven Music, PayPal and the clock
npm run typecheck
```

Tests drive the HTTP API only (`test/harness.ts`).

## License

[MIT](LICENSE)
