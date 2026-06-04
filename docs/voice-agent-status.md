# Multi-Channel Campaign System — Status & Regroup

_Last updated: 2026-06-04 · Branch: `claude/multichannel-campaigns` (PR #17, open)_

This is the executive view: the original plan, what we built, what changed, what's
left, and the next steps. The phase-by-phase detail lives in
`voice-agent-build-checklist.md`.

---

## 1. What we set out to build (original plan)

From `Voice_Campaign_System_BRD.docx`: an **Outbound AI Voice Campaign System** —
import leads, run AI voice calls, A/B test voice personas, and fire follow-ups
(WhatsApp/email/Calendly). We extended it with **real-time in-call sentiment** and
a **two-way WhatsApp agent**, and built compliance in from day one.

**Mid-project direction change (agreed):** campaigns became **multi-channel**.
Instead of "voice with follow-ups," a campaign now picks any of **voice / WhatsApp /
email** and sends via **configurable templates**. Email + WhatsApp are first-class,
not afterthoughts. Decisions on record: multi-channel per campaign · all three
channels in parallel · pre-approved WhatsApp templates · `manage_campaigns` RBAC.

---

## 2. What we accomplished ✅

### Merged to `main` (PRs #13, #14)
- **Phase 1 — Compliance foundation:** AI disclosure, opt-out detection, consent
  guard, GDPR erasure, TRAI DND strategy (`compliance.ts`).
- **Phase 2 — Data model:** 6 tables (campaign, lead, call, sentiment, WhatsApp
  conversation/message), all `hotelId`-scoped.
- **Phase 3 — Connectors:** Vapi (telephony) + Resend (email) clients with the
  shared `{variable}` template system; keys-last fallbacks.
- **Phase 4 — Campaign CRUD:** full `/campaigns/*` API with RBAC + lifecycle.
- **Phase 5 — Lead import:** CSV upload, column mapping, E.164, dedupe, consent-gated.
- **Phase 5.5 — Hardening:** all 12 code-review findings fixed.

### In PR #17 (open, not yet merged)
- **Phase 6.0 — Multi-channel foundation:** `channels` + per-channel templates on
  the campaign; `MessageDelivery` (WhatsApp/email send records); **`DoNotContact`
  durable suppression list (#3)**; E.164 `+0…` fix (#4); channel-aware validation.
- **Phase 6.1 — Unified send engine:** channel-agnostic dispatcher + `ChannelSender`
  registry (WhatsApp via approved templates, email via Resend); one shared pre-send
  guard; batched + spend-capped; **scale-safe (50 → 50,000 leads)**.
- **Phase 6 — Voice dialler:** slot calc, atomic anti-double-dial lock, balanced
  A/B, stuck-call recovery, retries, spend cap, 5xx auto-pause — behind the same guard.
- **Phase 10 (core) — Frontend:** Campaigns list, multi-channel **campaign builder**
  (per-channel template editors + reusable variable panel), campaign detail
  (overview + leads), and the **lead-import wizard** (upload → auto-map → preview →
  import). Nav + proxy routes + data layer.

### Health
- **API tests: 107/107 passing** · TypeScript lint clean · `next build` clean.
- 10 API test files for the campaign module; 5 DB migrations.
- Everything **keys-last**: runs and is fully testable with no Vapi/Twilio/Resend keys.

---

## 3. The end-to-end flow that works today

```
Import CSV (any size) ─▶ Build campaign: pick channel(s) + configure templates ─▶ Activate
                                                   │
              ┌────────────────────────────────────┼───────────────────────────────┐
              ▼                                     ▼                                ▼
         Voice dialler                      WhatsApp sender                    Email sender
       (A/B, anti-double-dial)            (approved templates)               (Resend templates)
              └───────────────── one shared guard: consent + suppression + DND ──────┘
                                                   │
                                       spend caps · batched · live SSE
```

---

## 4. What's remaining ⏳

| Phase | What | Why it matters | Depends on |
|---|---|---|---|
| **7** | Vapi end-of-call **webhook** + **real-time sentiment** + follow-up firing + no-answer retry scheduling | Calls currently *start* but nothing records how they *ended* — closes the voice loop | Vapi keys for live; logic testable now |
| **8** | Conversational **WhatsApp agent** (two-way replies, per-message sentiment, booking intent, opt-out) | Turns WhatsApp from one-shot into a conversation | Phase 2 tables exist |
| **9** | **A/B analytics** endpoint (per-variant funnel, sentiment, significance) + calls list/export | The "which voice wins" answer | Phase 7 data |
| **10+** | UI follow-ups: live activity feed, Calls tab w/ sentiment meter, A/B cards, Settings edit form, deliveries endpoint | Observability + editing in the UI | Phases 7/9 |
| **11** | Compliance hardening: GDPR erasure endpoint (wire `gdprErase`+`suppressContact`), enforce DND before go-live | Legal sign-off before real calls | — |
| **12** | Launch: demo seed, full live validation with real keys, docs | Demoable + production-ready | accounts/keys |

### Known follow-ups / tech debt
- Model is still named `VoiceCampaign` internally (now multi-channel) — rename deferred to avoid churn.
- Messaging channels don't auto-retry failed sends (a failed `MessageDelivery` excludes the lead); add if needed.
- WhatsApp template approval (Twilio/Meta) is an **operational** step before real sends.

---

## 5. Recommended next steps (in order)

1. **Phase 7 — call webhook + real-time sentiment.** Closes the voice loop and
   unlocks the live sentiment UI. Highest value next.
2. **Live activity feed + small `GET /campaigns/:id/deliveries` endpoint** so the UI
   shows sends/calls streaming in (quick win, makes the product feel alive).
3. **Phase 8 — WhatsApp agent**, then **Phase 9 — analytics**.
4. **Phase 11 hardening + Phase 12 launch** once accounts/keys are provisioned.

### Before going live (operational checklist)
- [ ] Provision Vapi (+ branded phone number), ElevenLabs, Resend, Twilio WhatsApp
- [ ] Register/approve WhatsApp templates
- [ ] Set `API_PUBLIC_URL`, all connector keys, `ENFORCE_DND_SCRUB=true` for India
- [ ] Legal review for target countries (TCPA/GDPR/TRAI/CASL/PDPA)
- [ ] Tiny test campaign (spend cap = 5, call your own number) before real lists
