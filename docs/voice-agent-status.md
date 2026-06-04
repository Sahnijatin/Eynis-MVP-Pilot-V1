# Multi-Channel Campaign System — Status & Regroup

_Last updated: 2026-06-04 · All work below is **merged to `main`** (PRs #13–#23) · API suite **178/178 green**_

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
- **API tests: 178/178 passing** · TypeScript lint clean · `next build` clean.
- 18 campaign modules + 28 test files; **11 DB migrations**.
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
| Operator **UI**: list · multi-channel builder · detail · import wizard | ✅ |
| **Observability UI**: Calls tab + live sentiment meter · A/B comparison cards · WhatsApp thread view · live activity feed (`GET /campaigns/:id/deliveries`) · Settings edit form | ✅ |
| **Segmentation**: lead tags + custom attributes · saved segments (`/segments`) · target a campaign at a segment (dispatcher + dialler honour it) | ✅ |
| **Scheduling**: scheduled start · daily send window / quiet-hours (per-tz, overnight-aware) · allowed weekdays — enforced by dispatcher + dialler | ✅ |
| **Drip automation**: multi-step sequences (delay → channel action) · enroll by segment · runner advances enrollments · exit on reply/opt-out/booking (`/sequences`) | ✅ |
| **Template library**: reusable WhatsApp/email templates with approval-status lifecycle (draft → submitted → approved/rejected) + recorded Content SID (`/templates`) | ✅ |
| **WhatsApp approval enforcement**: campaigns/sequences reference a library template; only **approved** templates can activate + send (Meta rule); picker in builder + settings | ✅ |
| Keys-last (runs/tests with no external keys) · **178/178 tests** | ✅ |

---

## 4. What's remaining ⏳

| Area | What | Why it matters | Depends on |
|---|---|---|---|
| **Phase 11 — Compliance hardening** | GDPR **erasure endpoint** (wire `gdprErase` + `suppressContact`); enforce `ENFORCE_DND_SCRUB` for India before go-live; verify disclosure non-removable in every script | Legal sign-off before real calls | — |
| **Phase 12 — Launch** | **Demo seed** (a populated campaign to click through with no keys); full **live validation** with real Vapi/Twilio/Resend keys; CLAUDE.md/env docs refresh | Demoable + production-ready | accounts/keys |

### Known follow-ups / tech debt
- Internal model still named `VoiceCampaign` (it is multi-channel now) — rename deferred to avoid churn.
- ~~Messaging channels don't auto-retry failed sends~~ — ✅ done: a failed `MessageDelivery` is now re-attempted up to the campaign's `maxRetries`, gated by `retryDelayHours` backoff; `skipped` (compliance) rows are never retried.
- WhatsApp template approval (Twilio/Meta) is an **operational** step before real sends.
- Analytics endpoint loads call rows into memory to aggregate — fine within spend caps; switch to grouped SQL if a single campaign ever exceeds ~100k calls.

---

## 5. Recommended next steps (in order)

1. ~~**Observability UI**~~ — ✅ done: Calls tab + live sentiment meter, A/B
   comparison cards, WhatsApp thread view, live activity feed (+ the
   `GET /campaigns/:id/deliveries` endpoint), Settings edit form.
2. **Demo seed** — a populated campaign so the whole flow is clickable/demoable
   without any external keys.
3. **Phase 11 hardening** — GDPR erasure endpoint + DND enforcement.
4. **Phase 12 launch** — live validation once accounts/keys are provisioned.

> Deploy note: `render.yaml` now pins the API's build/start commands and required
> env-var keys so a stale build cache or missing var can't silently ship old code.

### Before going live (operational checklist)
- [ ] Provision Vapi (+ branded phone number), ElevenLabs, Resend, Twilio WhatsApp
- [ ] Register/approve WhatsApp templates
- [ ] Set `API_PUBLIC_URL`, all connector keys, `ENFORCE_DND_SCRUB=true` for India
- [ ] Legal review for target countries (TCPA/GDPR/TRAI/CASL/PDPA)
- [ ] Tiny test campaign (spend cap = 5, call your own number) before real lists

---

## 6. Competitive roadmap (vs WATI / Brevo)

Our edge they lack: outbound **AI voice + live sentiment**, and all three channels
under one **compliance guard**. Their edge we're closing:

| Gap | Status |
|---|---|
| **Segmentation** (tags, saved audiences, targeted sends) | ✅ done |
| Auto-retry failed sends | ✅ done |
| **Scheduling / quiet-hours / send windows** | ✅ done |
| **Drip automation** (multi-step sequences, delays, exit conditions) | ✅ done |
| In-app WhatsApp **template library + approval status** | ✅ done |
| Delivery **read/click tracking** + deeper analytics | ⏳ Tier 2 (needs provider webhooks) |
| **Shared inbox + human handoff** | ⏳ Tier 3 |
| Forms / opt-in capture · bounce-suppression hygiene | ⏳ Tier 3 |
