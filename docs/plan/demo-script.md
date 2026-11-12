# Demo script: "Ode" (video, target 2:30, hard limit under 3:00)

**Ode: pay your friends back in song.** Hosted on Render. Vocabulary: `GLOSSARY.md`.

**Setup:**
- One hard-coded payer ("me").
- The friends are **Tharun, Vikram and Sahiti**, the real Florida friends, played by Personal PayPal sandbox accounts. On 2026-11-06 they agreed by phone to their real first names, trip details, photo and replies appearing in the public video.
- **Seeded data:** `seed/notes.txt` is the final seed (change it later only if you want to). From it the ledger gives Tharun $97.50, Vikram $82.50, Sahiti $77.50 (each friend's amount minus their $7.50 share of the $30 parking I covered). Re-derive every number below if the notes change.

**Rules:**
- **Sharing:** a verse share holds only unlocked lines, and the chorus only once it has dropped. It's named after the trip and never mentions debt or amounts. The share moment belongs to the friend, who looks loved.
- **Trademarks:** the event rules forbid third-party trademarks without permission. No brand names or real song titles in the lyrics, voiceover or screens. Say "beach house", not the rental brand; "burritos", not the restaurant; "our song", not the title. PayPal is the sponsor and is fine.

**Song shape (7 Eleven Music v2.5 chunks, ~1:38; ADR 0001):**
- Intro (6 s)
- Tharun's verse (20 s) → hook (8 s)
- Vikram's verse (20 s) → hook (8 s)
- Sahiti's verse (20 s)
- Chorus (16 s)

Each verse is one chunk, so its window is exact; word timestamps give each line its window inside it (equal quarters if alignment fails). Each line unlocks at 25% of that friend's amount owed, in order. The Seeded Ode is converted into **my cloned voice** by a one-off script (ADR 0002); Odes made in the app keep Eleven's own vocals.

## Script
1. **0:00–0:12 Story opening.** A real trip photo with the text: "Florida, 2025. My friends covered ~$[total] for me. Nobody has asked for it back. I still haven't paid." A second line: "46% of people find asking for money back too awkward. Starling Bank, n=2,000."
2. **0:12–0:16** The Ode home screen, "Pay your friends back in song." Click **New Ode**.
3. **0:16–0:28** Paste the trip notes. Click **Work out what I owe**. The ledger appears with friend, amount owed and an **inside joke** for each friend; the AI suggests them and I confirm. Edit one joke on camera.
4. **0:28–0:38** The lyrics preview shows memories, no amounts. Set the release date to "Full Ode drops Dec 1". Click **Make the Ode**. The status runs "writing… composing… finding every line… (Render Workflow)". Show it **live** if it takes under 20 s; otherwise a jump cut labeled with the real time.
5. **0:38–0:54** The **cassette** page with the Seeded Ode, labeled "in my voice". Press play: the intro, then Tharun's 4 lines muffled with blurred text, then the hook clear. Voiceover: *"I can't sing. That's my voice."* **(Wow 1.)** *(Open: how the video bridges the in-app Ode from step 4 to the voice-converted Seeded Ode; see the note at the end.)*
6. **0:54–1:14** **Split screen.** On the left, **Pay Tharun $50**: the PayPal sandbox popup shows Tharun's sandbox account as payee; approve, and the server captures it. On the right, Tharun's friend view un-blurs **2 lines**, which sing, and shows him privately "$50 of $97.50 back". **(Wow 2.)**
7. **1:14–1:26** Pay Vikram $82.50, and all 4 of his lines unlock. Pay Sahiti $20: 1 of 4 lines unlocks, with "next line at $38.75". The countdown reads "1 of 3 friends · 22 days to drop".
8. **1:26–1:40** Pay Tharun's remaining $47.50 and Sahiti's $57.50. The **chorus drops**, the cassette plays to the end, and the page reads "Full Ode dropped · Florida '25".
9. **1:40–1:55** **Share moment, which ends the demo.** In Tharun's friend view, tap **Share my verse**. The verse share plays (intro → his verse → hook → chorus), and the card "An Ode for Tharun · Florida '25" appears as a chat-app link preview.
10. **1:55–2:15** **How it's built.** The architecture diagram, about 10 s: trip notes → Claude (ledger, inside jokes, lyrics) → Eleven Music v2.5 (one chunk per verse, word timestamps find each line), all inside a Render Workflow → Postgres. Each payment is a PayPal Orders v2 order with a **different payee per friend**, and the capture unlocks that friend's lines.
11. **2:15–2:30 Close.** *"Most people think the fix is a better reminder. Between close friends nobody sends one. So I made paying back the thing worth sending."* Then the retell line. *Optional, with consent:* the real friend's reply.

**Open (raised after the grilling):** ADR 0002 means an Ode made in the app isn't in my voice, but steps 4→5 imply it is. Leading option: label step 5 on screen "Seeded Ode, converted to my voice" so nothing implies the app did it live.

## Scope (this is the entire build, in hours)

| # | Feature | Est. |
|---|---|---|
| S1 | Skeleton: TypeScript web service + paid Postgres on Render, public MIT repo, deployed first | 1 |
| S0r | Rest of the day-1 checks: one full 3-verse Ode (latency + credits); the webhook on the public URL | 1 |
| S2 | Trip notes → ledger with Claude structured output + one inside joke per friend, confirmed and editable; payer-covered group costs split evenly | 3 |
| S3 | Lyrics: 4 lines per friend from their inside joke, hook, chorus; no amounts, brand names or song titles (blocklist, one regeneration); ≤200 chars per line | 2 |
| S4a | Composition-plan builder (one chunk per verse) → compose → store audio, verse windows, line windows | 2.5 |
| S4c | Run S4a as a Render Workflow task and poll its status | 1.5 |
| S5 | Cassette player: Web Audio; muffle and blur each locked line; an unlock animation per line | 5 |
| S6 | PayPal: Orders v2 with a payee per friend, JS SDK, server-side capture, gross amounts capped at amount owed, lines unlock in order, idempotent on capture ID, verified webhook | 4 |
| S10 | Live split screen: friend view updates over SSE; two-pane layout (also the judges' landing page) | 1 |
| S8 | Chorus drop on the last payment | 1 |
| S7 | Friend view (whole Ode, own amounts only) + **verse share** (intro → unlocked lines → hook (+ chorus once dropped)) + OG card | 4 |
| S9 | Release date (fixed once set) + countdown + delayed (chorus stays locked) | 1 |
| S11 | Judge mode: per-visitor copy of the Seeded Ode; judge Odes with 1–3 friends mapped to the sandbox accounts; 5 new Odes a day, then the Seeded Ode | 2 |
| S12 | Seed the real data; 10 reliability runs on 35-s clips + 1 full run; a recorded fallback, labeled | 2 |
| S4b | Seeded Ode voice script: split → speech-to-speech into my clone → ffmpeg remix | 1 |
| S13 | Visual design: the cassette page first, then home, ledger, friend view, verse share card | 5 |
| | **Build total** | **37** |
| P | Packaging: video (5), README + diagram + screenshots (3), write-up and Devpost (2), detail pass (3), submit (1) | 14 |
| | **Total** | **51** |

## NOT BUILDING (what's next / the answer to "what's missing?")

- Voice conversion for Odes made in the app; an in-app voice recorder (the clone is made once on elevenlabs.io).
- Sung or text replies from friends. Sung replies need inpainting, which is enterprise-only.
- "Keep it or put it toward the next trip", for friends who'd refuse money.
- Reading receipt photos and OCR; netting debts across the group (only the payer's covered costs are split evenly); vaulted automatic installments.
- Moving the release date after it's set.
- More than 3 friends in judge Odes.
- Live money. Production needs a fee-free friends-and-family rail, because Checkout charges the receiver fees.
- Sign-up and auth, multiple trips, editing or regenerating an Ode; sharing straight into WhatsApp; a native app.
- Odes started by a friend. Only the payer can lock lines, which prevents misuse for shaming.
- Cloning anyone's voice except my own. Production needs voice verification.
