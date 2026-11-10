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
| `PAYMENT.CAPTURE.COMPLETED` webhook | ⏳ not tested; needs a public URL (after the Render deploy) |

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
