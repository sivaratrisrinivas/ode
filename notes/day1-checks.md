# Day-1 checks (S0)

Run 2026-11-08. Each item: result, then the decision it drives.

## PayPal Orders v2 (sandbox)

| Check | Result |
|---|---|
| OAuth client-credentials token | ✅ app `APP-70R8832671223001C` |
| Order with `purchase_units[].payee.email_address` = **Personal** account | ✅ created, approved, captured: order `25W09167YU126631W`, $1.00 |
| Same with a **Business** account payee | ✅ order `60417193E8254300H`, $1.00 |
| Money lands on the overridden payee | ✅ confirmed with `GET /v2/checkout/orders/{id}`: `payee` matches |
| Capture response includes payee | ❌ not present; read the order back to confirm the payee |
| Receiver fee | $0.52 on $1.00 for both account types |
| `PAYMENT.CAPTURE.COMPLETED` webhook | ⚠️ tested 2026-11-12 (see "S0r" below): subscription fixed and a simulated event accepted by PayPal; arrival at the app not confirmed; re-run the read-only part any time with `scripts/webhook-check.ts` (`docs/agents/run.md`) |

**Decisions**
- Friends stay **Personal** sandbox accounts; the Business fallback isn't needed.
- Unlock from whichever of the capture response (`status: COMPLETED`) and the verified webhook arrives first, keyed on the capture ID (#27).
- Receiver fees are real even for Personal payees, which stays in README Limitations.

**Sandbox accounts:** payer `askubusku18@gmail.com`; friends `sahitishastrula1402@gmail.com`, `vikram_vickey10@outlook.com`, `tharunbandaru18@gmail.com` (Personal); `sb-7gyt253787974@business.example.com` (Business, spare).

## Eleven Music v2.5

Probe: `docs/plan/probes/line-chunk-plan.json`. Intro 6 s, 4 verse lines × 5 s, hook 9 s, so 35 s were planned.

| Check | Result |
|---|---|
| Chunk durations hold | ✅ total length 35.04 s vs 35.00 s planned |
| Per-chunk boundaries land where planned | ✅ sounds right by ear; not measured |
| `with_timestamps` returns word timings | ✅ via `POST /v1/music/detailed` (multipart: JSON + MP3), `words_timestamps[]` with `start_ms`/`end_ms` |
| Names sung clearly ("Arjun") | ✅ clear, by ear |
| Voice-changer pass on isolated vocals | Probed (`voice-changed-*.mp3`, 35.13 s); used only for the Seeded Ode (ADR 0002) |

| Musical quality | ⚠️ "okay, not great": doesn't sound like a song you'd play daily (composition and lyrics) |

### Probe 2: verse-level chunks (`docs/plan/probes/verse-chunk-plan.json`)
Intro 6 s, one 20 s verse chunk, 12 s chorus; indie-folk stomp-clap styles; same lyrics. Generated in 5.6 s, 38.03 s long.

| Check | Result |
|---|---|
| Verse words inside the 6–26 s window | ✅ 36 words, 7.30–25.64 s |
| Chorus words inside the 26–38 s window | ✅ 15 words, 26.94–35.04 s |
| `waveform_visual` | returned `null`; draw the waveform client-side |
| Musical quality vs probe 1 | ✅ "now it sounds like a real song" (by ear) |

**Decision:** one chunk per verse (~20 s), ADR 0001. Verse windows come from chunk durations, and `words_timestamps` confirms them (and can drive karaoke-style lyric un-blurring).

## S0r: one full Ode and the capture webhook (#4)

Run 2026-11-12. Ticket wording: "Compose one full 3-verse Ode (intro, 3 verse chunks, 2 hooks, chorus) and record latency and credits." No new run was made: `notes/reliability-2026-11-12.md` (#16) already ran exactly that through the real pipeline, so another run would spend credits for the same number.

### 1. Latency and credits of one full Ode

| Check | Result |
|---|---|
| Shape | intro, 3 verses, 2 hooks, chorus (about 102 s of song), real pipeline on `seed/notes.txt` |
| Seconds | **31.9 s** end to end (ledger extraction, lyrics, Eleven Music compose) |
| ElevenLabs credits | **1,275** per Ode: balance delta of `GET /v1/user/subscription` (a delta, so it can include other use of the account and lags a run by several seconds) |
| Claude | 2 calls, 2,103 input and 793 output tokens (not priced: the app's Claude port reports tokens only) |

**Decision:** 1,275 credits per Ode is well under the 5,000-credit threshold in `docs/plan/build-plan.md`, so **no Creator upgrade is needed for cost**. At that price the 40,000-credit plan covers about 31 Odes; the other trigger in the build plan (usage passing 20,000 before Wed) is a separate watch, not decided here. Latency of 31.9 s is for the pipeline only: the Render Workflow and hosted database add a cold task start that was not measured here.

### 2. Webhook on the public URL (sandbox only)

Hosted app: `https://ode-nluc.onrender.com` (`/api/health` answers 200). It is not in the Render account the Render tools can see (that account lists only other services), so the hosted logs and env vars could not be read from here.

| Check | Result |
|---|---|
| Sandbox webhook existed | Yes: one webhook, event `PAYMENT.CAPTURE.COMPLETED`, but its URL was `https://ode-nluc.onrender.com/api/paypal/webhook`, which is **404** on the app (the route is `/api/payments/webhook`) |
| Fixed | Reused it: `PATCH /v1/notifications/webhooks/{id}` replaced the URL with `https://ode-nluc.onrender.com/api/payments/webhook` (event type unchanged). No new webhook was created |
| App route reachable | Yes: an unsigned `POST /api/payments/webhook` answers **401** (signature not verified), the old path 404 |
| Delivery | Simulator `POST /v1/notifications/simulate-event` for `PAYMENT.CAPTURE.COMPLETED` returned **202** (event `WH-7Y7254563A4550640-11V2185806837105M`, 2026-11-12 12:50 UTC). Simulated events do not appear in `GET /v1/notifications/webhooks-events` (count 0) and carry a signature that real webhook-id verification rejects, so the app would answer 401 even on a successful delivery. Render logs of the hosted app were not readable, so **arrival was not observed** |
| `PAYPAL_WEBHOOK_ID` in the local `.env` | **Wrong**: it holds a URL, not the webhook's 17-character ID. The hosted value could not be read. If it is the same, the app rejects every real webhook (the verify call is malformed) |
| Real capture (non-simulated) | Not driven: an order needs the payer's approval in a PayPal sandbox login |

**Result: webhook delivery YES (verified 2026-11-12, 14:12 UTC).**

| Check | Result |
|---|---|
| `PAYPAL_WEBHOOK_ID` | Fixed on Render and in the local `.env`: it is now the webhook's ID (`node --env-file=.env scripts/webhook-check.ts` says "Ready") |
| `FRIEND_PAYPAL_ACCOUNTS` | Was unset on Render, so paying a friend answered 422 "No PayPal account is set up to pay Tharun"; set to the three sandbox friend accounts, then the payment worked |
| Real capture | On the hosted page, an Own Ode made from `seed/notes.txt`; paid Tharun $50 with the payer's sandbox login: capture 200, $50.00 of $97.50 repaid, 2 lines unlocked |
| Delivery | PayPal dashboard, Webhook Events: `PAYMENT.CAPTURE.COMPLETED`, event `WH-8G890814VH818520Y-6WK4613398668244R`, "Payment completed for $ 50.0 USD", resource `3B231164JJ520190P`, status **Success** (a 200 from `/api/payments/webhook`) |

**Decision:** the webhook arrives and passes verification on the hosted app, so the unlock can be confirmed by either the capture response or the webhook (#27). No limitation to note. The hosted Render logs were not read (the service is not in the account the Render tools can see); the dashboard's Success status is the evidence.

