# Packaging: Ode

Final copy for Devpost, the video and the X post. Sections under "Devpost write-up" are written to be pasted as they are. Screenshots are in `docs/screenshots/` (files with `FAKE` in the name are from `npm run dev:fake`; say so if you use one). **No third-party brand names** in the story, video or write-up (event rule); PayPal, Claude and ElevenLabs are the tools used and are fine. The total is $257.50 (Tharun $97.50, Vikram $82.50, Sahiti $77.50), from `seed/notes.txt`; re-derive it if the notes change.

Still to do by the payer before pasting: run `npm run seed:voice` on the live Seeded Ode (the live site reports no voice label yet, so it is still sung in the music model's vocals; if you skip it, drop the "in my voice" lines here and in the video); the sandbox test-buyer email and password (Devpost testing instructions only, never the repo), the video link, and the live-run numbers if you want any in the write-up.

## Retell line
**Ode: a song about your trip, where each friend's lines unlock as you pay them back.**

(The seeded demo Ode is sung in the payer's own voice, and the write-up says so. The retell line stays true for every Ode.)

## Insight (the pitch's contrast)
Most people think the fix is a better reminder. Between close friends nobody sends one: in a 2023 UK survey of 2,000 adults, 46% found asking for money back too awkward, and in a PayPal survey of Australians 44% don't chase. So the debt waits on the person who owes. And when money is tight, a small transfer feels too small to send (the builder's own case, n=1). Ode makes the payback itself worth sending, and makes every small payment audible progress.

## Story opening (the same in the video, write-up and X post)
Florida, 2025. My school friends covered about $257.50 for me: the beach house, gas, burritos. A year later nobody has asked, and I still haven't paid. In a 2023 UK survey of 2,000 adults, 46% found asking for money back too awkward.

## Video script (at most 2:30; why, what, how, close; product on screen by 0:12)
Burn in captions so the story works with the sound off. Label the voice-converted Seeded Ode on screen ("Seeded Ode, converted to my voice with a one-off script") so the video does not imply the app converts voices.

| Time | On screen | Voiceover |
|---|---|---|
| 0:00-0:12 | Trip photo; "My friends covered ~$257.50 for me. Nobody asked. I still haven't paid." then "46% find asking too awkward · 2023 UK survey, 2,000 adults" | "Florida, 2025. My school friends covered about two hundred and fifty-seven dollars for me. Nobody's asked. And I still haven't paid. Nearly half of people find asking for money back too awkward, so the debt just waits." |
| 0:12-0:16 | Ode landing page, then **More**, **Make my own Ode** | "So I built Ode." |
| 0:16-0:28 | Paste notes, ledger with an inside joke per friend; edit one | "I paste what I remember. Claude works out who covered what, and finds one inside joke for each friend." |
| 0:28-0:38 | Lyrics preview, release date, **Make the Ode**, status steps | "It writes our song. Memories, never money. I set a date for the full Ode to drop." |
| 0:38-0:54 | Cassette page (Seeded Ode, labeled "in my voice"); locked lines are blurred; the hook plays clear | "Every friend's lines are locked until I pay them back. And that voice? I can't sing. That's me." |
| 0:54-1:14 | **Split screen:** pay Tharun $50 in the PayPal popup, his friend view unlocks 2 lines | "I can't pay it all yet. Fifty dollars to Tharun, straight to his PayPal, and half his verse comes alive on his phone." |
| 1:14-1:26 | Vikram paid in full; Sahiti 1 of 4 lines; countdown | "Every bit I pay is a line they can hear." |
| 1:26-1:40 | Final payments, **chorus drops** | "When the last friend is paid, the chorus finally drops." *(let it play)* |
| 1:40-1:55 | Tharun taps **Share my verse**, "An Ode for Tharun · Florida '25" | "And what Tharun shares isn't a debt. It's a song his friend made about him." |
| 1:55-2:15 | Architecture diagram (from the README) | "Claude builds the ledger and lyrics. Inside a Render Workflow, ElevenLabs Music writes one chunk per verse, and word timestamps find every line. For my own Ode, the vocals were split out and converted into my voice. Every payment is a PayPal order to a different friend, and the capture unlocks their lines." |
| 2:15-2:30 | Insight line, then retell line | "Most people think the fix is a better reminder. Between close friends, nobody sends one. So I made paying back the thing worth sending. Ode." |

## Devpost write-up

### Elevator pitch (under 200 characters)
A song about your trip. Each friend's lines unlock as you pay them back through PayPal; the last payment drops the chorus.

### Inspiration
Florida, 2025. My school friends covered about $257.50 for me: the beach house, gas, burritos. A year later nobody has asked, and I still haven't paid. In a 2023 UK survey of 2,000 adults, 46% found asking for money back too awkward. Between close friends nobody sends a reminder, and when money is tight a small transfer feels too small to send. Ode makes the payback itself worth sending, and makes every small payment audible progress.

### What it does
- You paste what you remember from the trip. Claude rebuilds who covered what and finds one inside joke for each friend, which you confirm or edit.
- Claude writes a song about the trip with four lines per friend. The lines sing memories, never amounts or brand names. ElevenLabs Music composes it. The Seeded Ode (the demo's pre-made one) is converted into **my own voice**; Odes you make keep the music model's vocals.
- Each friend's lines are locked: blurred on the page and muffled in the audio. Every 25% you repay that friend through PayPal unlocks their next line, so small payments count.
- You set a release date you cannot move. The chorus drops only when everyone is paid; miss the date and the Ode shows as delayed.
- Each friend's private link plays the whole Ode but shows only their own amounts, and updates live when a payment lands. They can share their unlocked lines as "An Ode for <name>"; locked lines never leave the group.

### How we built it
- **Web service:** TypeScript and Hono on Render with Postgres, and a React client with a 3D cassette (a flat one on devices without WebGL). The song pipeline (lyrics, compose, line windows, store) runs as a **Render Workflow** task that writes its steps to Postgres, which the page shows as status steps.
- **Claude** (`claude-opus-5-5`): structured output for the ledger and the inside jokes, then lyrics within the music model's limits.
- **ElevenLabs Music v2.5:** a composition plan with **one chunk per verse**, so every verse has an exact window; word timestamps from `with_timestamps` are aligned to the lyrics to give each line its window (equal quarters as a fallback).
- **ElevenLabs stem separation, speech-to-speech and instant voice cloning:** a one-off command puts the Seeded Ode's vocals into my cloned voice, then ffmpeg remixes it. The command refuses a remix whose length drifts more than 250 ms, so the line windows stay valid.
- **PayPal Orders v2 (sandbox):** each order sets `purchase_units[].payee` to that friend's account and is approved in the PayPal JS SDK popup. Whichever of the capture response or the verified `PAYMENT.CAPTURE.COMPLETED` webhook arrives first unlocks lines, keyed on the capture ID, and a server-sent event stream pushes the unlock to the friend's open view.

### Challenges we ran into
- One chunk per line sounded flat, so verses became the chunks and lines get their windows from word timestamps (ADR 0001).
- A run that dies in the Workflow must not spin forever and must not be retried automatically, because a retry would pay for the song again; progress goes through Postgres and "Try again" is the payer's choice (ADR 0003).
- Open friend views must unlock within a second whichever process takes the payment, so each stream reads the view every 250 ms instead of relying on an in-process signal (ADR 0004).
- Keeping the cloned voice honest: only the Seeded Ode is converted, and the page labels it once converted (ADR 0002).
- The credit budget: Own Odes are capped at 5 a day across all visitors.

### Evidence and limitations
- **Pain (observed):**
  - My own unpaid $257.50.
  - A 2023 UK survey of 2,000 adults: 46% found asking too awkward.
  - A PayPal survey of Australians: 44% don't chase ([source](https://newsroom.au.paypal-corp.com/Avoid_the_awkward_tax_this_World_Friendship_Day-_Aussies_uncomfortable_asking_friends_for_owed_money)). The same survey says 63% repay before being reminded, so Ode is for the rest.
- **Inferred:** in close friendships the debt waits on the person who owes.
- **Appeal (tested small):** I ran a small test with friends and report it here as the payer: Friend B recognised the cloned voice. It is a handful of friends and my own report, directional and not proof.
- **Sandbox only.** In production, PayPal charges the *receiver* fees on a payment like this (a $1 sandbox payment is charged $0.52), so a launch needs a fee-free friends-and-family rail.
- **Voice conversion runs only on the Seeded Ode** and only with my own voice; a launch would need it per Ode plus voice verification.
- No sung replies (inpainting is enterprise-only). Notes are text, not receipt photos.
- Own Odes take one to three friends and are capped at 5 a day.

### Why a big company won't build it, and the first 10 users
A payments company avoids emotional, sung, user-generated content tied to debt, and a music app has no money rails. The first 10 users: my Florida group (3), then friends of theirs who fronted trip costs. Every shared "An Ode for..." link leads back to Ode.

### What's next
- Voice conversion for every Ode, with an in-app voice recorder.
- Group Odes for roommates and family.
- "Keep it or put it toward the next trip" for friends who refuse money.
- Automatic installments.
- Sung replies.

### Testing instructions (paste into Devpost's testing field)
Live demo: https://ode-nluc.onrender.com. No account is needed: you get your own unpaid copy of the Seeded Ode "Florida '25", with the payer's page on the left and a friend's view on the right. To pay a friend, press the PayPal button and log in to the PayPal sandbox with the test buyer: email `<buyer email>`, password `<buyer password>` (fake money; nothing real is charged). Pay Tharun $25 to unlock his first line and watch it clear on the right. **More** holds **Make my own Ode** (up to 5 new Odes a day across all visitors) and **Reset demo**. Run steps and keys are in the README.

### Built with
TypeScript, Node, Hono, React, Vite, three.js, Server-Sent Events, PostgreSQL, ffmpeg, Render (web service, Postgres, Workflows), PayPal Orders v2 and JS SDK (sandbox), PayPal webhooks, Claude API, ElevenLabs Music v2.5, ElevenLabs stem separation, ElevenLabs speech-to-speech, ElevenLabs instant voice cloning.

## Submission checklist (from the rules)
- [ ] Public video under 3 minutes, showing it working end to end, with no third-party trademarks or unlicensed music (the music is generated with ElevenLabs on a paid plan)
- [ ] Public repo with an OSS license (MIT) shown in the About section
- [ ] Working demo: the Render URL (up through Dec 15) plus run steps and **a sandbox test-buyer login** in the testing instructions; every visitor gets their own unpaid copy of the Seeded Ode
- [ ] Description (the write-up above) plus tools list
- [ ] PayPal sandbox and AI both used meaningfully (the ledger, jokes and lyrics, the song and voice pipeline, the per-payee orders)

## X post (at most 280 characters)
I owed my school friends $257.50 from a Florida trip. Nobody asked. I couldn't pay it all.

So I built Ode: AI writes a song about our trip, and each friend's lines unlock as I pay them back on PayPal. The last payment drops the chorus. 🎵 [video link]
