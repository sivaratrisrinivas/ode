# Seed data

`notes.txt` is **invented placeholder data** (2026-11-08), written to resemble messy trip notes. The real Florida 2025 notes were not available for the reliability runs (#16), so those ran on this file. **The real notes are swapped in later by replacing `notes.txt` and re-running** the build (below); nothing else in the code reads them by name. After the swap, re-derive the amounts in `docs/plan/demo-script.md` from the new ledger.

It includes deliberate ambiguity for the ledger step to handle:
- Approximate amounts ("$90ish", "~105", "maybe $25").
- An unattributed credit ("I paid parking $30, subtract from someone??").
- A total that needs splitting ($420 Airbnb, 4 ways).

Friend names match the PayPal sandbox payees in `notes/day1-checks.md`: Tharun, Vikram, Sahiti.

## Building the Seeded Ode

`npm run seed:ode -- [--replace] [--release YYYY-MM-DD] [--save-fallback]` reads `notes.txt`, builds the ledger and lyrics with Claude and the whole Ode with Eleven Music, and saves them as the Seeded Ode in the database `DATABASE_URL` points at (`scripts/seed-ode.ts`). `--replace` builds over an existing Seeded Ode, which discards its friends' links and every visitor's paid copy; without it an existing one is left alone.

The hosted database's `DATABASE_URL` is Render-internal, so this cannot run from a laptop. On Render, open the web service's **Shell** and run the same command there (the service has `DATABASE_URL`, `ANTHROPIC_API_KEY` and `ELEVENLABS_API_KEY`): `node scripts/seed-ode.ts --replace`. Pass `--save-fallback` to also write the recording below, then copy the two files out and commit them. The script costs one whole-Ode Eleven Music song (about 1,300 credits), so run it once per set of notes.

## The recorded fallback

`seeded-ode-fallback.mp3` and `seeded-ode-fallback.json` are a **recording** of a Seeded Ode build: Eleven Music's own vocals, not the cloned voice (that is #35's conversion), made from the placeholder notes above (its `label` and `source` fields say so). They exist so the demo video can use a recording when live runs are unreliable (the decision rule is in `notes/reliability-2026-11-12.md`). Wherever the video shows it, label it a recording. The reliability script writes both files when its full run succeeds, and rebuilds them each time it runs; running it again with the real notes in place replaces the placeholder recording.
