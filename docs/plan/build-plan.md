# Build plan: Ode

Re-baselined **Mon Nov 9** after the second grilling session; build work re-sliced vertically from spec #20. Vocabulary: `GLOSSARY.md`. Decisions: `docs/adr/`. Each row below is a GitHub issue under map #1; the issue's acceptance criteria are the source of truth.

**Budget:** ~41 h of build plus ~14 h of packaging (55 h). At ~14 h/day that's ~46 h until the submit time, so ~9 h over: expect long Wed and Thu days, and the safety check cutting #31 and #32 (5 h) if behind. Each estimate is also that ticket's time limit.

**Key times:**
- **Safety check:** Wed Nov 11, 10:00 IST.
- **Feature freeze:** Wed Nov 11, end of day.
- **Submit by:** Thu Nov 12, 18:00 IST. The hard deadline is Nov 13, 01:30 IST, and nothing can be edited after it.

**Rules:**
- Deploy first (#21). At the end of every block, the app can be demoed as it stands.
- After 30 minutes stuck on one bug, cut the feature or switch to its fallback.
- Hard-code the payer.
- Never cut: #22 (ledger), #26 and #27 (payments and line unlock), #28 and #29 (live friend view, split screen).
- Cut order if behind: (1) #31 release date, (2) #32 verse share.

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

## Mon Nov 9
| Est. | Ticket | Done when |
|---|---|---|
| 1.5 | **#21** Walking skeleton: deployed app, API test harness and fakes | The hosted URL reads a row from Postgres; one API test passes against the fakes |
| 1 | **#4** Measure one full Ode; test the capture webhook | `notes/day1-checks.md` records seconds, credits and webhook yes/no |
| 3 | **#22** Trip notes become a ledger | The seed notes give $97.50, $82.50, $77.50 with an inside joke each; edits persist |
| 2 | **#23** The ledger becomes lyrics | 3×4 lines + hook + chorus pass the length and blocklist checks |
| — | **23:00 IST: read the tests (#2)**, or Nov 10 23:00 if sent today | Results recorded in `context.md` |

## Tue Nov 10
| Est. | Ticket | Done when |
|---|---|---|
| 3 | **#24** Make the Ode and play it | An Ode plays from the hosted URL; every line has a window |
| 1.5 | **#25** Move the song pipeline into a Render Workflow | "Make the Ode" runs as a Workflow task with status steps |
| 1.5 | **Packaging start (#19):** Devpost draft, README skeleton + diagram | Draft exists; diagram in the README |
| 5 | **#26** Pay a friend and lines unlock | Paying $50 of Tharun's $97.50 unlocks exactly 2 lines; the fake money shows in his sandbox account |
| 2.5 | **#27** Payments unlock once, confirmed by webhook, with the unlock moment | Duplicates unlock nothing; an unlock is obvious after YouTube compression |

## Wed Nov 11
| Est. | Ticket | Done when |
|---|---|---|
| 3 | **#28** Friend view with live updates | A payment unlocks the line in the friend view within ~1 s; no other friend's amounts |
| 1 | **#29** Split screen | Payer left, friend view right, live |
| **10:00** | **Safety check.** Cut #31, then #32, if behind | — |
| 1 | **#30** The chorus drops on the last payment | The last full repayment drops the chorus |
| 1 | **#31** Release date, countdown and delayed | A past date shows delayed; the chorus stays locked |
| 4 | **#32** Verse share with the link-preview card | Only unlocked lines; chorus only once dropped; the card previews in a chat app |
| 2 | **#33** Seeded Ode with a copy per visitor | Two browsers get independent unpaid copies; "Reset demo" works |
| 1.5 | **#34** Judge-made Odes | The 6th new Ode of the day falls back to the Seeded Ode |
| 2 | **#16** Seed the real data; reliability runs | Failure rate and credits logged; fallback saved |
| 1 | **#35** Seeded Ode in the payer's voice | The Seeded Ode plays in the payer's voice, labeled |
| — | **FEATURE FREEZE** | — |
| 5 | **#18** Visual design pass (may run into Thu morning) | All screens look finished at desktop and phone widths |

## Thu Nov 12 (start early) — #19
| Est. | Block | Done when |
|---|---|---|
| 1.5 | Full README (install, env vars, **sandbox test-buyer login**, diagram) + screenshots | A fresh clone runs from the README alone |
| 1 | Write-up (`packaging.md`) | Every Devpost field is drafted |
| 5 | Video: 3+ takes, ≤2:30, burned-in captions, no brand names; label the Seeded Ode "in my voice" | Under 3:00; the story works with sound off |
| 3 | **Detail pass**: titles, favicon, typos, console errors, links, loading/empty states, no trademarks | Checklist clean |
| 1 | Upload the video publicly; submit | Submitted by **18:00 IST** |
| After | Post on X; confirm Render services stay up through **Dec 15** | — |

## ElevenLabs credits (Starter: 40k a month, ~37k left, resets Dec 1)
- Judge and in-app Odes are compose-only (no split or conversion), so they cost less than the old 4–5k estimate. #4 measures the real number.
- The split and conversion run once, for the Seeded Ode (plus retakes).
- **Upgrade to Creator** if #4 measures more than 5k credits per Ode, or if usage passes 20k before Wed.
- Judge mode caps new Odes at 5 a day; the Dec 1 reset refills credits as judging starts.
