# Run context: PayPal AI Hackathon (Devpost)

Event: https://paypalaihackathon.devpost.com/ · Rules: https://paypalaihackathon.devpost.com/rules

## Event facts (observed)
- Online. **Deadline: Nov 12, 2026 12:00 PT = Nov 13 01:30 IST.** Submit by **Nov 12, 18:00 IST**. Nothing can be edited after the deadline.
- Required: PayPal sandbox and AI, both used meaningfully.
- Submission:
  - A public YouTube video under 3 min that shows the project working end to end.
  - **No third-party trademarks or copyrighted material without permission.**
  - A public repo with an OSS license shown in About.
  - A working demo (URL or run steps), including **sandbox login details** if needed. It must stay free to use through **Dec 15**.
  - A description and the tools used.
- Judging:
  - Stage 1 is pass/fail.
  - Stage 2 has 5 equal criteria: Tech (use of PayPal + AI, non-trivial), Design (a complete product), Impact (a specific case, actually solved by what's demonstrated), Innovation, and Presentation (the video shows it working end to end). Ties are broken in that order.
  - Judges may skip testing the build. Judging may be AI-assisted. It runs Dec 1–15; winners around Dec 21.
- Judges (13): 6 from PayPal (developer advocates Jo Franchetti, Eddie Jaoude and Marco Podien; software engineer Karthik Ravi; engineering manager Himraj Singh; senior PM Nathaniel Olson), and Shifra Williams from Render; the rest come from other sponsors.
- Targets: **Most Creative** (primary), Best Overall (stretch), **Render** sponsor prize.

## Builder
Solo, about 12 h/day (10 is not a hard limit), uses AI coding agents. Skills: Go, Python, TypeScript, SQL, Docker. **ElevenLabs Starter** (40k credits a month, ~37k left, resets Dec 1 10:05 IST; 128 kbps maximum on speech-to-speech).

## Chosen idea: **Ode** (renamed from The Payback Tape on 2026-11-08)
**Core:** a promise your friends can hear, paid off in small parts. The payer makes a song about the trip with 4 lines per friend. Each line unlocks, in order, at 25% of that friend's amount owed, repaid through PayPal. A fixed release date is the promise, and only the last payment drops the chorus. Friends share their unlocked lines as "An Ode for [name]"; locked lines never leave the group. The Seeded Ode is sung in the payer's cloned voice (ADR 0002). Vocabulary: `GLOSSARY.md`.

## Evidence status
- **Pain (observed):** the builder owes ~$300 from the 2025 Florida trip. Nobody asked ("family"). The barriers are that **money is tight** and there's **no deadline**. Starling/Opinium 2023 (n=2,000): 46% too awkward to ask. PayPal AU (fieldwork Sep 2023, n=1,001): 44% don't chase, but 63% pay before being reminded.
- **Inferred:** in close friendships the debt waits on the person who owes.
- **H1 (appeal), uncertainty explicitly accepted on 2026-11-06:** a song-wrapped repayment feels warmer than a plain one.
  - Test: repay Friend A plainly, and Friend B with a verse on an unlisted YouTube video. Send Nov 8; read Nov 9 at 23:00 IST.
  - ✅ B replays it, quotes it, or replies more warmly than A. ❌ No warmer, or awkward.
  - If it fails, the pitch changes to a private thank-you track; the build stays the same.
- **H2 (sharing, from the "social acceptance" insight):** a friend shares a song made about them. Signal: B forwards or posts the test verse.
- **H3 (voice):** friends recognize the builder's cloned singing voice. Test on Nov 9: send B a 15-s clip in the cloned voice and ask "who's singing?" If not recognized, keep it but pitch it as "in a voice like mine", or fall back to the stock voice.
- Memory-only lyrics are a hypothesis, chosen to avoid making the debt public and to avoid amounts being sung unclearly.
- Consent (observed, phone call 2026-11-06): real names, trip details, photo and replies may appear in the public video.

## Technical probes (2026-11-08, `probes/`)
- Full results: `notes/day1-checks.md`; plans in `docs/plan/probes/`.
- **Line-per-chunk test (35 s, music_v2_5):**
  - Generated in 6.1 s, with `words_timestamps` returned.
  - All 4 lines landed inside their 5-s windows.
  - Scribe v2 transcribed every word, including the names.
- **Verse-chunk test (38 s):** one 20-s verse chunk; every verse word landed in its window, and it sounds like a real song (line chunks sounded "okay, not great"). Chosen: one chunk per verse (ADR 0001).
- **PayPal:** payee override works for Personal payees; the capture response lacks the payee (read the order back); receiver fee $0.52 on $1.00.
- **Voice test:**
  - Stem split (`two_stems_v1`) took 7.9 s; speech-to-speech to a stock voice took 6.8 s, with timing kept.
  - Scribe still tags the result [singing]; the builder confirmed by ear that it sounds sung.
- Eleven limits: up to 30 chunks, each 3–120 s, total ≤10 min; durations always enforced on v2/v2.5.

## Kill review (independent reviewer, 2026-11-06, on the pre-grilling version)
- Verdict: shrink.
- Worst criterion: Impact.
- Closest prior work: "Karen" (AI Tinkerers NYC), a creditor-side debt chaser; pay-to-unlock song vendors.
- Gap: no song found whose verses unlock as you repay *different people*.
- PayPal: personal-account payees unconfirmed (fallback: business sandbox accounts). Unlock from the capture response; the webhook only confirms.
- Render: Workflows run TypeScript or Python; free Postgres expires after 30 days, so use paid.

## Kill delta after the grilling session (2026-11-08, inline; no second independent review)
- **New hardest piece (updated 2026-11-09):** line windows inside a verse chunk from word timestamps. Voice conversion now runs once, on the Seeded Ode only.
- **How it fails in the demo:** the clone doesn't sound like the builder; the melody flattens on a longer song; artifacts at line edges; credits per Ode higher than estimated.
- **Fallback:** the stock voice (cut #1 at the Nov 11 check).
- **Frontier capabilities:** one, singing voice conversion (within the lenses' technical-risk limit). Line windows and timestamps are now tested.
- **New on-time assumptions:** full-Ode latency and credits (S0); the clone's quality (S0, plus H3); a seamless mini-song crossfade (S7, falling back to one continuous stretch).
- **Rules:** no brand names in lyrics or video; sandbox test-buyer login in the README.

## Decisions log
- 2026-11-06 Package:
  - The app is sandbox-only; the appeal test uses real money outside the app.
  - Polish goes mostly to the tape page.
  - Keep the AI ledger.
  - Stack: TypeScript.
- 2026-11-08 "social acceptance" insight: the share moment belongs to the friend, and the payer card was cut.
- 2026-11-08 grilling session (from first principles):
  - Core = a promise device; partial payments are core.
  - Line-by-line unlock.
  - A hook between verses, and a mini song for sharing.
  - The builder's cloned voice sings it (hard-coded voice ID).
  - One inside joke per friend.
  - Release date.
  - Live split screen and cassette design.
  - Judge mode capped at 5 a day with a seeded fallback.
  - Stay on Starter and measure credits.
  - Pitch the broad problem: any debt between people too close to ask.
  - Name: **Ode**.
  - About 12-hour days.
  - The Nov 11 10:00 cut order: voice → release date → Share my verse page.
- 2026-11-08 audit against the forge skill:
  - The demo now ends on the share moment.
  - No trademarks.
  - Sandbox login for judges.
  - The insight line is in the pitch.
  - Why-now is verified.
  - The yang answers (big company, first 10 users) are written.
  - Voice-clone misuse is limited.
  - The ideas log is updated.
- 2026-11-09 grilling session (round 2), with GLOSSARY.md and ADRs 0001–0002:
  - Re-baseline now; the Nov 11 check is the second round of cuts. Cut order: release date → verse share.
  - One chunk per verse; line windows from word timestamps, equal quarters as fallback (ADR 0001). Lines unlock in order.
  - Cloned voice only on the Seeded Ode, by a one-off script; in-app and judge Odes keep Eleven's vocals (ADR 0002).
  - Friends are Tharun, Vikram and Sahiti everywhere (Arjun/Dev/Kiran retired). The sandbox emails were invented, not personal.
  - Group costs the payer covered are split evenly into each friend's amount owed; no group netting.
  - Amount repaid counts gross, capped at amount owed. Unlocks are idempotent on the capture ID; capture or webhook, whichever arrives first.
  - Release date is fixed once set; passing it shows delayed and does not drop the chorus.
  - Friend view plays the whole Ode with only that friend's amounts. Verse share needs ≥1 unlocked line, holds only unlocked lines, and the chorus only once dropped.
  - Every visitor gets their own unpaid copy of the Seeded Ode and lands on the split screen. Judge Odes have 1–3 friends mapped to the sandbox accounts.
  - Lyrics: brands become generic words, real songs are never named or quoted; a blocklist regenerates a line once; the payer can edit.
  - Plan moved into the repo (docs/plan/); each block is a GitHub issue under the wayfinder map.
- Files: docs/plan/ (demo-script.md, build-plan.md, packaging.md, README.draft.md, probes/), notes/day1-checks.md; probe audio and the ideas log stay in ~/hackathons/.
