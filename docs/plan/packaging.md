# Packaging: Ode

Everything here is a draft. `[total]` comes from the real trip notes (the placeholder seed gives $257.50). Screenshots and footage must come from the running build. Fill in the `[brackets]` after the build and the tests. **No third-party brand names** anywhere (event rule); PayPal is fine.

## Retell line
**Ode: a song about your trip, in your voice, where each friend's lines unlock as you pay them back.**

## Insight (the pitch's contrast)
Most people think the fix is a better reminder. Actually, between close friends nobody sends one: 46% find asking too awkward and 44% never chase (observed, surveys). So the debt waits on the person who owes (inferred). And when money is tight, a small transfer feels too small to send (the builder's own case, observed n=1). Ode makes the payback itself worth sending, and makes every small payment audible progress.

## Story opening (the same in the video, write-up and X post)
Florida, 2025. My school friends covered about $[total] for me: the beach house, gas, burritos. A year later nobody has asked, and I still haven't paid. 46% of people find asking for money back too awkward ([Starling Bank / Opinium, n=2,000](https://www.starlingbank.com/news/one-third-of-uk-adults-owed-money-by-friends-and-family)).

## Video script (≤2:30; why → what → how → close; product on screen by 0:12)
Burn in captions so the story works with the sound off.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00–0:12 | Trip photo; "My friends covered ~$[total] for me. Nobody asked. I still haven't paid." → "46% find asking too awkward · Starling Bank, n=2,000" | "Florida, 2025. My school friends covered about [total] dollars for me. Nobody's asked. And I still haven't paid. Nearly half of people find asking for money back too awkward, so the debt just waits." |
| 0:12–0:16 | Ode home → **New Ode** | "So I built Ode." |
| 0:16–0:28 | Paste notes → ledger with an inside joke per friend; edit one | "I paste what I remember. Claude works out who covered what, and finds one inside joke for each friend." |
| 0:28–0:38 | Lyrics preview → release date → **Make the Ode** → status steps | "It writes our song. Memories, never money. I set a date for the full Ode to drop." |
| 0:38–0:54 | Cassette page (Seeded Ode, labeled "in my voice"); locked lines are muffled; the hook plays clear | "Every friend's lines are locked until I pay them back. And that voice? I can't sing. That's me." |
| 0:54–1:14 | **Split screen:** pay Tharun $50 → his friend view unlocks 2 lines | "I can't pay it all yet. Fifty dollars to Tharun, straight to his PayPal, and half his verse comes alive on his phone." |
| 1:14–1:26 | Vikram paid in full; Sahiti 1 of 4 lines; countdown | "Every bit I pay is a line they can hear." |
| 1:26–1:40 | Final payments → **chorus drops** | "When the last friend is paid, the chorus finally drops." *(let it play)* |
| 1:40–1:55 | Tharun taps **Share my verse** → "An Ode for Tharun · Florida '25" | "And what Tharun shares isn't a debt. It's a song his friend made about him." |
| 1:55–2:15 | Architecture diagram | "Claude builds the ledger and lyrics. Inside a Render Workflow, Eleven Music writes one chunk per verse, and word timestamps find every line. For my own Ode, the vocals were split out and converted into my voice. Every payment is a PayPal order to a different friend, and the capture unlocks their lines." |
| 2:15–2:30 | Insight line → retell line; *[optional: the real friend's reply]* | "Most people think the fix is a better reminder. Between close friends, nobody sends one. So I made paying back the thing worth sending. Ode." |

## Devpost write-up

### Inspiration
[Story opening.] [Insight paragraph.]

### What it does
- You paste what you remember from the trip. Claude rebuilds who covered what and finds one inside joke for each friend, which you confirm.
- Claude writes a song about the trip with 4 lines per friend; the lines sing memories, never amounts, brand names or song titles. Eleven Music composes it. The demo Ode is converted into **my own voice**.
- Each friend's lines are locked: muffled and blurred. Every 25% you repay that friend through PayPal unlocks the next line, so small payments count.
- You set a release date you can't move. The chorus drops only when everyone is paid; miss the date and the Ode shows as delayed.
- Each friend's private view plays the whole Ode but shows only their own amounts. They can share their unlocked lines as "An Ode for [name]". Locked lines never leave the group.

### How we built it
- **Web service:** TypeScript on Render with Postgres. The song pipeline (lyrics → compose → line windows → store) runs as a **Render Workflow** task.
- **Claude** (`claude-opus-5-5`): structured output for the ledger and jokes, then lyrics within Eleven's limits.
- **Eleven Music v2.5:** a composition plan with **one chunk per verse**. Chunk durations are always enforced, so every verse has an exact window; `with_timestamps` word timings are aligned to the lyrics to give each line its window (equal quarters as a fallback).
- **ElevenLabs stem separation + speech-to-speech:** a one-off script puts the demo Ode's vocals into my cloned voice, then ffmpeg remixes. In-app Odes keep Eleven's vocals.
- **PayPal Orders v2 (sandbox):** each order sets `purchase_units[].payee` to that friend's account. Whichever of the capture response or the verified `PAYMENT.CAPTURE.COMPLETED` webhook arrives first unlocks lines, keyed on the capture ID, and SSE pushes it live to the friend's view.

### Why now
A year ago this couldn't be built this way:
- Eleven Music v2, which enforces chunk durations, launched in June 2026.
- The stem separation endpoint was added in February 2026 ([API changelog mirror](https://skmtc.dev/elevenlabs/apis/elevenlabs-api-documentation/docs/v1/music/stem-separation/post)).

Exact verse windows and a song converted into your own voice both depend on these.

### Challenges we ran into
[Fill from the build. Likely: one chunk per line sounded flat, so verses became chunks and lines come from word timestamps; crossfade seams in the verse share; keeping the lock audible after YouTube compression; the credit budget on a Starter plan.]

### Evidence and limitations
- **Pain (observed):**
  - My own unpaid $[total].
  - Starling: 46% too awkward to ask.
  - PayPal AU: 44% don't chase ([source](https://newsroom.au.paypal-corp.com/Avoid_the_awkward_tax_this_World_Friendship_Day-_Aussies_uncomfortable_asking_friends_for_owed_money)). The same survey says 63% repay before being reminded, so Ode is for the rest.
- **Inferred:** in close friendships the debt waits on the person who owes.
- **Appeal (tested small):** [n=2: plain repayment vs one with a verse. Did the friend share it? Did they recognize my voice?] This is directional, not proof.
- **Sandbox only.** In production, Checkout charges the *receiver* merchant fees, so a launch needs a fee-free friends-and-family rail.
- **Voice conversion runs only on the demo Ode** and only with my own voice; a launch needs it per Ode plus voice verification. Only the payer can lock lines, so it can't be used to shame people.
- No sung replies (inpainting is enterprise-only). Notes are text, not receipt photos.

### Why a big company won't build it, and the first 10 users
A payments brand avoids emotional, sung, user-generated content tied to debt, and a music app has no money rails. The first 10 users: my Florida group (3), then friends of theirs who fronted trip costs. Every shared "An Ode for…" link leads back to Ode.

### What's next
- Voice conversion for every Ode, with an in-app voice recorder.
- Group Odes for roommates and family.
- "Keep it or put it toward the next trip" for friends who refuse money.
- Automatic installments.
- Sung replies.

### Built with
TypeScript, Node, React, Vite, Web Audio API, Server-Sent Events, PostgreSQL, ffmpeg, Render (web service, Postgres, Workflows), PayPal Orders v2 + JS SDK (sandbox), PayPal webhooks, Claude API, ElevenLabs Music v2.5, ElevenLabs Stem Separation, ElevenLabs Speech-to-Speech, ElevenLabs Instant Voice Cloning.

## Submission checklist (from the rules)
- [ ] Public YouTube video under 3 min, showing it working end to end, with no third-party trademarks or unlicensed music (the music is generated with ElevenLabs on a paid plan)
- [ ] Public repo with an OSS license (MIT) shown in the About section
- [ ] Working demo: the Render URL (up through Dec 15) + run steps + **a sandbox test-buyer login** in the README; every visitor gets their own unpaid copy of the Seeded Ode
- [ ] Description (the write-up above) + tools list
- [ ] PayPal sandbox + AI both used meaningfully (the ledger, jokes and lyrics, the song and voice pipeline, the per-payee orders)

## Judges to keep in mind
13 judges in total. 6 are from PayPal: 3 developer advocates (Jo Franchetti, Eddie Jaoude, Marco Podien), a software engineer, an engineering manager and a senior PM. Render is represented by Shifra Williams. Advocates will try the README and the sandbox flow, so both must work on the first try.

## X post (≤280 characters)
I owed my school friends $[total] from a Florida trip. Nobody asked. I couldn't pay it all.

So I built Ode: AI writes a song about our trip, in my own voice, and each friend's lines unlock as I pay them back on PayPal. The last payment drops the chorus. 🎵 [video link]
