# Reliability runs, 2026-11-12

| Run | Result | Failure tag | Seconds | Credits |
|---|---|---|---|---|
| clip 1 | ok |  | 5.6 | - |
| clip 2 | ok |  | 5.2 | - |
| clip 3 | ok |  | 6.1 | - |
| clip 4 | ok |  | 5.4 | - |
| clip 5 | ok |  | 6.3 | - |
| clip 6 | ok |  | 5.5 | - |
| clip 7 | ok |  | 5.4 | - |
| clip 8 | ok |  | 4.9 | - |
| clip 9 | ok |  | 5.1 | - |
| clip 10 | ok |  | 5.7 | - |
| full Ode | ok |  | 31.9 | 1275 |

Failure rate: 0 of 11 runs (0%)
ElevenLabs credits: 13976 before, 19631 after, 5655 used (of 40000)
Claude: 2 calls, 2103 input tokens, 793 output tokens

Decision rule: failure rate high (more than 10% of runs, or the full run fails) -> use the labeled fallback in the video.
Decision: use the live Ode in the video.

## How these runs were made

- Command: `node --env-file=.env scripts/reliability.ts` (`src/ops/reliability.ts` holds the logic).
- Clip runs: 10 requested, 10 made. Each is a 35 s plan (intro 6 s, four 5 s lines of one friend, hook 9 s: the day-1 probe's shape) sent to Eleven Music v2.5 with word timestamps; it passes when Eleven answers and the audio is within 3 s of 35 s.
- Full run: the real pipeline in in-process Postgres (the hosted database is Render-internal and not reachable from here): Claude extracts the ledger from `seed/notes.txt`, writes the lyrics, then Eleven Music composes the whole Ode (intro, three verses, two hooks, chorus). It is the same code the app's Workflow task runs.
- Notes used: `seed/notes.txt`, which is **invented placeholder data**, not the real Florida notes. Costs are for those notes; the real ones are the same size, so they should cost about the same.
- Clip credits: 4380 in all for 10 clips (about 438 each). The per-run column is blank for clips because the balance lags a run by several seconds; the full run's figure is the balance change over it.
- Credits are ElevenLabs's `character_count` from `GET /v1/user/subscription`, read before the runs and again once the balance settled, so anything else using the account at the same time (here, the #35 voice work) is counted in. Claude is reported in tokens only: the app's Claude port does not price calls.
- Recorded fallback: `seed/seeded-ode-fallback.mp3` with `seed/seeded-ode-fallback.json`; the JSON labels it a RECORDING. It is Eleven Music's own vocals, not the cloned voice (that is #35).
## Result and what is left

- **0 of 11 runs failed**, so by the rule above the video can use the live Ode. The recorded fallback is saved anyway (`seed/seeded-ode-fallback.mp3`, labeled a recording) in case the live run fails on the day.
- Cost: about 438 credits per 35 s clip and about 1,275 for the full 102 s Ode (about 12.5 credits per second of song); 5,655 in all, leaving about 20,000 of the 40,000. Claude used 2 calls, 2,103 input and 793 output tokens for the ledger and the lyrics; the clips use none.
- Timing: a clip takes about 5 to 6 s; the whole Ode (ledger, lyrics, composing) took 31.9 s.
- **Not done:** these runs used the placeholder `seed/notes.txt`, because the real Florida notes were not available. Replace the file and run `npm run reliability` again (it replaces the recording), or `npm run seed:ode -- --replace --save-fallback` from the Render Shell.
- **Not done:** the Seeded Ode is not built in the hosted database. Its `DATABASE_URL` is Render's internal address, which does not resolve from outside Render. Run `node scripts/seed-ode.ts --replace` from the web service's Shell on Render once the real notes are in.
- The reliability numbers measure Eleven Music and Claude, not the Render Workflow or the hosted database.
