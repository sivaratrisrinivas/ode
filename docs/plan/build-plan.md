# Build plan: Ode

Re-baselined **Mon Nov 9, 16:30 IST** after the second grilling session. Vocabulary: `GLOSSARY.md`. Decisions: `docs/adr/`. Each block is a GitHub issue under the `wayfinder:map` issue; the issue is the source of truth for its done-when.

**Budget:** scope is ~37 h of build plus ~14 h of packaging (51 h). At ~14 h/day that's ~46 h until the submit time, so Wed and Thu run long, or the Nov 11 safety check cuts. Each estimate is also that block's time limit.

**Key times:**
- **Safety check:** Wed Nov 11, 10:00 IST.
- **Feature freeze:** Wed Nov 11, end of day.
- **Submit by:** Thu Nov 12, 18:00 IST. The hard deadline is Nov 13, 01:30 IST, and nothing can be edited after it.

**Rules:**
- Deploy first (S1). At the end of every block, the app can be demoed as it stands.
- After 30 minutes stuck on one bug, cut the feature or switch to its fallback.
- Hard-code the payer.
- Never cut: partial payments, line unlock, the live split screen, the AI ledger.
- Cut order if behind: (1) release date (S9), (2) verse share (S7 share half).

**Stack:**
- TypeScript web service on Render (Node + Vite/React), paid Render Postgres; audio stored as `bytea`.
- One Render Workflow task in TypeScript: lyrics → compose → line windows → store.
- Claude API (`claude-opus-5-5`) for the ledger, inside jokes and lyrics.
- Eleven Music v2.5 (`POST /v1/music/detailed`, `with_timestamps`), **one chunk per verse** (ADR 0001).
- Seeded Ode only: stem separation (`two_stems_v1`) + speech-to-speech (`eleven_multilingual_sts_v2`, `mp3_44100_128`) into the payer's clone, by a one-off script (ADR 0002).
- PayPal Orders v2 sandbox with the JS SDK; payee per friend (Personal sandbox accounts).

**Already proven** (`notes/day1-checks.md`, `docs/plan/probes/`, 2026-11-08):
- PayPal: payee override works for Personal and Business payees; the capture response lacks the payee, so read the order back; receiver fee $0.52 on $1.00.
- Verse chunk (20 s): every verse word landed in its window; sounds like a real song.
- Word timestamps are returned (`words_timestamps[]`).
- Names are sung clearly.
- Split 7.9 s, voice conversion 6.8 s; the singing survives.

## Mon Nov 9 (from 16:30)
| Est. | Block | Done when |
|---|---|---|
| 1 | **S1** Public repo MIT license in About, TS skeleton, Render web service + paid Postgres | The hosted URL reads a row from Postgres |
| 1 | **S0r** One full 3-verse Ode (latency, credits via `/v1/user/subscription` before and after); `PAYMENT.CAPTURE.COMPLETED` webhook to the public URL | `notes/day1-checks.md` records seconds, credits and webhook yes/no |
| 3 | **S2** Trip notes → ledger + inside jokes; payer-covered group costs split evenly | The seed notes give 3 rows (friend, amount owed, inside joke); edits persist |
| 2 | **S3** Lyrics | 3×4 lines + hook + chorus; no amounts, no brand names, no song titles; every line passes the length and blocklist checks |
| — | **23:00 IST: read the tests** (H1/H2, H3), or Nov 10 23:00 if sent today | Results recorded in `context.md` |

## Tue Nov 10
| Est. | Block | Done when |
|---|---|---|
| 2.5 | **S4a** Composition-plan builder (one chunk per verse) → compose → store audio, verse windows, line windows | An Ode plays from the hosted URL; every line has a window (timestamp-aligned or equal-quarter fallback) |
| 1.5 | **S4c** Run S4a as a Render Workflow; poll its status | "Make the Ode" → status steps → ready |
| 1.5 | **Packaging start:** Devpost draft, README skeleton + diagram | Draft exists; diagram in the README |
| 5 | **S5** Cassette player: Web Audio, per-line lock (muffle + blur), unlock animation | A dev control locks/unlocks any line; an unlock is obvious in a YouTube-compressed screen recording |
| 4 | **S6** PayPal: payee per friend, JS SDK, capture → lines (25% steps, in order), gross amounts capped at amount owed, idempotent on capture ID, webhook confirms | Paying $50 of Tharun's $97.50 unlocks exactly 2 lines; money shows in his sandbox account |

## Wed Nov 11
| Est. | Block | Done when |
|---|---|---|
| 1 | **S10** Live split screen (SSE) | A payment on the left unlocks the line on the right within ~1 s |
| **10:00** | **Safety check.** Cut in the order above if behind | — |
| 1 | **S8** Chorus drop | The last payment drops the chorus |
| 4 | **S7** Friend view + verse share + OG card | Tharun's link shows only his amounts; a verse share holds only unlocked lines (chorus only once dropped); the card previews in a chat app |
| 1 | **S9** Release date (fixed once set) + countdown + delayed | The countdown reads correctly; a past date shows delayed and the chorus stays locked |
| 2 | **S11** Judge mode: per-visitor copy of the Seeded Ode; judge Odes with 1–3 friends; 5 new Odes a day, then the Seeded Ode | A fresh browser gets an unpaid copy; the 6th new Ode of the day falls back |
| 2 | **S12** Seed the real trip notes; 10 clip runs; 1 full run; record a labeled fallback | Failure rate and credits logged; fallback saved |
| 1 | **S4b** Seeded Ode voice script: split → clone → remix | The Seeded Ode plays in the payer's voice |
| — | **FEATURE FREEZE** | — |
| 5 | **S13** Design: cassette page first, then home, ledger, friend view, verse share card | All screens look finished at desktop and phone widths |

## Thu Nov 12 (start early)
| Est. | Block | Done when |
|---|---|---|
| 1.5 | Full README (install, env vars, **sandbox test-buyer login**, diagram) + screenshots | A fresh clone runs from the README alone |
| 1 | Write-up (`packaging.md`) | Every Devpost field is drafted |
| 5 | Video: 3+ takes, ≤2:30, burned-in captions, no brand names | Under 3:00; the story works with sound off |
| 3 | **Detail pass**: titles, favicon, typos, console errors, links, loading/empty states, no trademarks | Checklist clean |
| 1 | Upload the video publicly; submit | Submitted by **18:00 IST** |
| After | Post on X; confirm Render services stay up through **Dec 15** | — |

## ElevenLabs credits (Starter: 40k a month, ~37k left, resets Dec 1)
- Judge and in-app Odes are compose-only (no split or conversion), so they cost less than the old 4–5k estimate. S0r measures the real number.
- The split and conversion run once, for the Seeded Ode (plus retakes).
- **Upgrade to Creator** if S0r measures more than 5k credits per Ode, or if usage passes 20k before Wed.
- Judge mode caps new Odes at 5 a day; the Dec 1 reset refills credits as judging starts.
