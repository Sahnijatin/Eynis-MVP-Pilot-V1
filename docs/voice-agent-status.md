# Multi-Channel Campaign System — Status & Regroup

_Last updated: 2026-06-04 · All work below is **merged to `main`** (PRs #13–#23) · API suite **136/136 green**_

This is the executive view: the original plan, what we built, what changed, what's
left, and the next steps. The phase-by-phase detail lives in
`voice-agent-build-checklist.md`.

> **TL;DR:** The backend is **feature-complete** — all 3 channels (voice / WhatsApp /
> email), both feedback loops (live in-call sentiment + post-call follow-ups; two-way
> WhatsApp agent), and A/B analytics. The operator can **import → build → activate →
> monitor** from the UI. What's left is **observability UI polish** and **go-live
> hardening** (GDPR erasure endpoint, real keys, demo seed).

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

## 2. What we accomplished ✅ (all merged to `main`)

**Foundation (PRs #13, #14)**
- **Phase 1 — Compliance foundation:** AI disclosure, opt-out detection, consent
  guard, GDPR erasure helper, TRAI DND strategy (`compliance.ts`).
- **Phase 2 — Data model:** campaign + lead + call + sentiment + WhatsApp tables,
  all `hotelId`-scoped.
- **Phase 3 — Connectors:** Vapi (telephony) + Resend (email) clients with the
  shared `{variable}` template system; keys-last fallbacks.
- **Phase 4 — Campaign CRUD:** full `/campaigns/*` API with RBAC + lifecycle.
- **Phase 5 — Lead import:** CSV upload, column mapping, E.164, dedupe, consent-gated.
- **Phase 5.5 — Hardening:** all 12 code-review findings fixed.

**Multi-channel engine + UI (PR #17)**
- **Phase 6.0 — Foundation:** `channels` + per-channel templates; `MessageDelivery`
  (WhatsApp/email send records); **`DoNotContact` durable suppression list**;
  channel-aware validation.
- **Phase 6.1 — Unified send engine:** channel-agnostic dispatcher + `ChannelSender`
  registry (WhatsApp approved templates, email via Resend); one shared pre-send
  guard (consent + suppression + DND); batched + spend-capped; **scale-safe (50 →
  50,000 leads)**.
- **Phase 6 — Voice dialler:** slot calc, atomic anti-double-dial lock, balanced
  A/B, stuck-call recovery, retries, spend cap, 5xx auto-pause — behind the same guard.
- **Phase 10 (core) — Frontend:** Campaigns list, multi-channel **campaign builder**
  (per-channel template editors + reusable variable panel), campaign detail
  (overview + leads), and the **lead-import wizard**. Nav + proxy routes + data layer.

**Feedback loops + analytics (PRs #18, #19, #20)**
- **Phase 7 — Call webhook + real-time sentiment:** `POST /webhooks/vapi`
  (`x-vapi-secret` verified); per-utterance sentiment timeline + SSE; mid-call
  opt-out suppression; end-of-call finalisation; no-answer retry scheduling;
  outcome-based follow-ups (reusing the sender registry).
- **Phase 8 — Configurable two-way WhatsApp agent:** operator-defined
  `whatsappAgentPrompt` drives replies; per-message sentiment; booking-intent link
  injection; opt-out; idempotent; `providerId` dedupe; editable in the UI builder.
- **Phase 9 — A/B analytics + calls:** `GET /campaigns/:id/analytics` (per-variant
  funnel, avg sentiment, two-proportion z-test, ≥50-answered winner gating);
  `GET …/calls` (paginated + CSV export); `GET …/calls/:id` (call + sentiment
  timeline + WhatsApp thread).

**Import robustness fixes (PRs #21, #22, #23)**
- Tolerates UTF-8 BOM CSVs and space-padded headers; **never rejects a valid number
  for a missing/garbage country code** (falls back to `+91`); specific rejection
  reasons.

### Health
- **API tests: 136/136 passing** · TypeScript lint clean · `next build` clean.
- 13 campaign modules + 12 test files; **6 DB migrations**.
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

## 3a. Everything that is DONE — at a glance

| Capability | Status |
|---|---|
| Import CSV (any size, BOM/whitespace-safe, consent-gated, deduped) | ✅ |
| Multi-channel campaigns + configurable per-channel templates | ✅ |
| Unified send engine: **voice + WhatsApp + email** (one guard, spend-capped, batched) | ✅ |
| Voice loop: dial → **live sentiment** → end → retries → **follow-ups** | ✅ |
| WhatsApp loop: broadcast → **configurable two-way agent** → opt-out / booking | ✅ |
| Durable tenant-wide opt-out (survives deletion) + consent + DND guard | ✅ |
| **A/B analytics** (funnel, sentiment, z-test winner gating) + calls list/detail/CSV | ✅ |
| Operator **UI**: list · multi-channel builder · detail (overview + leads) · import wizard | ✅ |
| Keys-last (runs/tests with no external keys) · **136/136 tests** | ✅ |

---

## 4. What's remaining ⏳

| Area | What | Why it matters | Depends on |
|---|---|---|---|
| **UI — observability** | Calls tab + **live sentiment meter**, **A/B comparison cards** (uses Phase 9 analytics), **WhatsApp thread view**, **live activity feed** of sends/calls (+ a small `GET /campaigns/:id/deliveries` endpoint), **Settings edit form** (PATCH already wired) | Makes everything we built visible/demoable; lets operators edit after creation | Phase 7/9 data (done) |
| **Phase 11 — Compliance hardening** | GDPR **erasure endpoint** (wire `gdprErase` + `suppressContact`); enforce `ENFORCE_DND_SCRUB` for India before go-live; verify disclosure non-removable in every script | Legal sign-off before real calls | — |
| **Phase 12 — Launch** | **Demo seed** (a populated campaign to click through with no keys); full **live validation** with real Vapi/Twilio/Resend keys; CLAUDE.md/env docs refresh | Demoable + production-ready | accounts/keys |

### Known follow-ups / tech debt
- Internal model still named `VoiceCampaign` (it is multi-channel now) — rename deferred to avoid churn.
- Messaging channels don't auto-retry failed sends (a failed `MessageDelivery` excludes the lead) — add if needed.
- WhatsApp template approval (Twilio/Meta) is an **operational** step before real sends.
- Analytics endpoint loads call rows into memory to aggregate — fine within spend caps; switch to grouped SQL if a single campaign ever exceeds ~100k calls.

---

## 5. Recommended next steps (in order)

1. **Observability UI** — Calls tab + sentiment meter, A/B cards, WhatsApp thread,
   live activity feed (+ the small deliveries endpoint), Settings edit form. This
   surfaces all the Phase 7–9 data we already produce.
2. **Demo seed** — a populated campaign so the whole flow is clickable/demoable
   without any external keys.
3. **Phase 11 hardening** — GDPR erasure endpoint + DND enforcement.
4. **Phase 12 launch** — live validation once accounts/keys are provisioned.

### Before going live (operational checklist)
- [ ] Provision Vapi (+ branded phone number), ElevenLabs, Resend, Twilio WhatsApp
- [ ] Register/approve WhatsApp templates
- [ ] Set `API_PUBLIC_URL`, all connector keys, `ENFORCE_DND_SCRUB=true` for India
- [ ] Legal review for target countries (TCPA/GDPR/TRAI/CASL/PDPA)
- [ ] Tiny test campaign (spend cap = 5, call your own number) before real lists
