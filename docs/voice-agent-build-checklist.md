# Voice Agent — Sequential Build Checklist

> 📊 **For the executive status (plan vs done vs remaining + next steps), see [`voice-agent-status.md`](./voice-agent-status.md).**
> This file is the detailed phase-by-phase build log.

Build order for the **Outbound AI Voice Campaign System** (per `Voice_Campaign_System_BRD.docx`),
extended with two added capabilities:

- **Real-time sentiment analysis _during_ the call** (not only post-call)
- **A two-way conversational AI agent on WhatsApp** (not only a one-shot follow-up message)

> Follow the phases **in order**. Each phase has a **Definition of Done (DoD)** — do not start the next
> phase until the current one is green. Compliance is built in from Phase 1, not bolted on at the end.

---

## Phase 0 — Prerequisites & Accounts (Day 0)

- [ ] Create **Vapi.ai** account; buy/register an outbound **phone number** and brand the caller ID (anti-"Spam Likely")
- [ ] Create **ElevenLabs** account (Creator plan, $22/mo); note the **voice IDs** for the A/B personas
- [ ] Confirm **Anthropic** API key works (already used by Eynis intelligence layer)
- [ ] Create **Resend** account; verify the sending domain (SPF/DKIM)
- [ ] Confirm **Twilio WhatsApp** sender is approved (already in Eynis) — needed for WhatsApp chat
- [ ] Create a **Calendly** event link (Phase 1 booking)
- [ ] Add all secrets to env: `VAPI_API_KEY`, `VAPI_PHONE_NUMBER_ID`, `VAPI_WEBHOOK_SECRET`, `RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`
- [ ] **Legal sanity-check** for target countries (TCPA / GDPR / TRAI / CASL / PDPA) before any real dialling

**DoD:** All accounts active, a test call placeable from the Vapi dashboard, all env vars loaded by the API on boot.

---

## Phase 1 — Compliance Foundation (Day 1, before any calling code) ✅ DONE

- [x] Reserve `consent` + `consentSource` + `consentAt` via the `LeadConsent` type in `@eynis/shared` (schema fields wired onto `CampaignLead` in Phase 2)
- [x] Add a **mandatory disclosure line** — `MANDATORY_DISCLOSURE` + `ensureDisclosure()` / `hasDisclosure()` in `compliance.ts`
- [x] Define the **opt-out phrase list** (`OPT_OUT_PHRASES` + `OPT_OUT_KEYWORDS`) + `detectOptOut()`; reserve the tenant-wide `RESERVED_OUTCOME_OPTED_OUT` exclusion outcome
- [x] Reserve a **GDPR erasure** path — `gdprErase()` (nulls identifiers, retains anonymised outcome)
- [x] Decide DND/TRAI scrub strategy — `requiresDndScrub()` + `dndScrub()` (flags `+91` numbers, defers live registry to Phase 2)
- [x] Consent enforcement guard `canContactLead()` + `consentFromImport()`; full unit-test coverage in `compliance.test.ts` (13 tests)

**Delivered:** `apps/api/src/core/campaigns/compliance.ts`, `compliance.test.ts`, and compliance types in `packages/shared/src/index.ts`.

**DoD:** Compliance rules are codified as pure, tested functions; the contact guard rejects non-consented and opted-out leads. Schema/route wiring lands in Phases 2, 5–8 and 11.

---

## Phase 2 — Data Model (Day 1)

- [x] Add `VoiceCampaign` model (status lifecycle, scriptTemplate, outcomeTypes JSON, followUpRules JSON, voice/persona A+B, vapiAssistantIds, retry/concurrency/spend caps, calendlyLink, defaultCountryCode)
- [x] Add `CampaignLead` model (firstName/phone/email/company/jobTitle, `rawData` JSON, abVariant, status, callAttempts, nextCallAt, **consent fields** + `optedOut`)
- [x] Add `CallRecord` model (vapiCallId unique, abVariant, status, outcome, durationSeconds, transcript, aiSummary, **sentiment**, keyPoints JSON, whatsappSent, emailSent, meetingBooked, timestamps)
- [x] Add **`SentimentEvent`** model (NEW): `callRecordId`/`conversationId`, speaker, text snippet, sentiment, score, timestamp — for live in-call sentiment timeline
- [x] Add **`WhatsappConversation`** model (NEW): leadId, campaignId, state (open/awaiting_reply/booked/closed/opted_out), lastMessageAt, threadSummary
- [x] Add **`WhatsappMessage`** model (NEW): conversationId, direction (in/out), body, sentiment, score, timestamp
- [x] Add Hotel relations for all new models (multi-tenant scope = `hotelId`)
- [x] Migration `20260603094958_add_voice_campaigns` created + applied; Prisma client regenerated

**Notes:** `tenantId` is `hotelId` in Eynis (matches existing models). `phone` is nullable to support GDPR erasure; deduped per-campaign via `@@unique([campaignId, phone])`. JSON fields stored as `String` per existing convention.

**DoD:** ✅ Migration applies cleanly; ✅ Prisma client regenerated; ✅ every model carries `hotelId`. Verified by a full relation round-trip (campaign→lead→call→sentiment, conversation→message), unique-constraint enforcement, and cascade delete. Existing suite: 26/26 pass; full lint exits clean.

---

## Phase 3 — Connectors & External Services (Day 1–2) ✅ DONE

- [x] Register `voice_vapi` connector in `server.ts` registry (`CONNECTOR_VOICE_VAPI_ENABLED` + per-tenant `ConnectorConfig`)
- [x] Register `email_resend` connector (apiKey/fromAddress/fromName; `apiKey` masked by existing `maskConnectorConfig`)
- [~] `busboy` + `csv-parse` deferred to **Phase 5** (where they're used); `resend` SDK **not needed** — implemented over the Resend REST API via `fetch`, matching the Twilio/Interakt connector pattern (no new dependency)
- [x] `apps/api/src/core/campaigns/vapi.ts` — `createAssistant()`, `initiateCall()`, `verifyWebhook()` + pure `buildAssistantPayload()`/`buildCallPayload()`, full TS types; disclosure auto-injected via Phase 1 `ensureDisclosure()`
- [x] `apps/api/src/core/email/resend.ts` — `renderTemplate()` + `buildTemplateVars()` ({variable} namespace incl. `lead.custom.*`) + `sendFollowUpEmail()`
- [x] Webhook verification reuses `webhook-verify.ts` — added `verifyVapiSecret()` (constant-time `x-vapi-secret` check) with the same `enforce`/`VERIFY_WEBHOOKS` semantics
- [x] New env vars documented in `apps/api/.env.example`

**Keys-last:** with no `VAPI_API_KEY` / `RESEND_API_KEY`, network calls return structured `{ ok:false / sent:false, error }` results (mirrors `whatsapp-outbound.ts`); all pure logic is unit-tested without credentials.

**DoD:** ✅ Vapi assistant + call payloads build correctly and the email renders end-to-end in unit tests (16/16); ✅ both connectors registered and secret-masked. Live provisioning/send awaits real keys (Phase 0). Full API suite 42/42; lint clean.

---

## Phase 4 — Campaign CRUD (Day 2) ✅ DONE

- [x] Add `permissionMap` entries for all `/campaigns/*` routes (gated by existing `manage_campaigns` permission — see note)
- [x] `POST /campaigns` (create draft; `validateCampaignCreate` enforces required fields + JSON shape)
- [x] `GET /campaigns` (paginated list with per-campaign lead/call counts)
- [x] `GET /campaigns/:id` (single + lead/call counts + outcome & lead-status breakdowns)
- [x] `PATCH /campaigns/:id` (allow-listed fields only via `buildCampaignUpdate`; status & assistantIds excluded)
- [x] `DELETE /campaigns/:id` (409 when CallRecords exist)
- [x] `POST /campaigns/:id/activate` (resolves Vapi creds → provisions both A/B assistants → status=active; 400 if connector unconfigured, idempotent re-provision)
- [x] `POST /campaigns/:id/pause` (active→paused) and `POST /campaigns/:id/complete` (with state guards)

**RBAC note:** the codebase is permission-based (not role-based), so routes use the existing `manage_campaigns` permission rather than a hard owner-only check. This grants admin/manager/supervisor roles (owner maps to admin). If strict owner-only is required, add a dedicated `manage_voice_campaigns` permission granted only to admin.

**DoD:** ✅ Full lifecycle drivable via API; ✅ RBAC + tenant isolation verified; ✅ activation provisioning tested via dependency-injected fake (live provisioning awaits real keys, Phase 0). Service unit tests 16/16, route integration tests 6/6, full API suite 64/64, lint clean.

---

## Phase 5 — Lead Import & Management (Day 3) ✅ DONE

- [x] `npm install busboy csv-parse @types/busboy -w @eynis/api`
- [x] `apps/api/src/core/campaigns/csv-import.ts` — `parseMultipart()` (busboy), `parseLeadsFromCsv()` (csv-parse, pure), `bulkInsertLeads()`, `normalizeToE164()`
- [x] `POST /campaigns/:id/leads/import` — multipart upload, column mapping, E.164 normalisation, dedupe by phone (in-batch + in-campaign), **reject non-consented rows** (via Phase 1 `consentFromImport`), skip tenant-wide opt-outs, return `{imported, skipped, errors}`
- [x] All original CSV columns preserved in `rawData` for `{lead.custom.*}` injection
- [x] `GET /campaigns/:id/leads` (paginated; filter by `status`, `abVariant`)
- [x] `DELETE /campaigns/:id/leads/:leadId` (status=pending only, else 409)

**Consent at import:** a row is imported only if it carries consent — either a CSV column mapped to `consent`, or a file-level `defaultConsent=true` + `consentSource` attestation (for pre-opted-in list exports). Tenant-wide opted-out phones are excluded automatically.

**DoD:** ✅ Real CSV imports with correct mapping, normalised phones, deduped, consent-gated, with a per-row error report. Unit tests 5/5 (normalisation, mapping, consent, custom-field preservation, validation), integration 4/4 (import+list+dedupe, consent rejection, delete guard, tenant opt-out skip). Full API suite 74/74, lint clean.

---

## Phase 5.5 — Code-review hardening (post Phases 1–5)

Findings from the `/code-review` pass. **Fixed in this commit:**
- [x] **#1** Vapi variable injection — `toVapiTemplate()` converts `{x.y}`→`{{x.y}}`; `nestVariableValues()` nests dotted keys for LiquidJS
- [x] **#11** Real `agentName` field on `VoiceCampaign` (migration), used in the greeting; falls back to the hotel name (never the persona label)
- [x] **#2** Oversized/truncated CSV upload now rejected (busboy `limit` event handled)
- [x] **#5** Non-object `columnMap` returns 400, not 500
- [x] **#6** Blank consent cell falls back to the file-level `defaultConsent` attestation
- [x] **#7** Removed `"cancel"` from standalone opt-out keywords
- [x] **#9** Documented nullable-phone dedupe behaviour in schema (active leads always non-null; only erased leads are null/inert)
- [x] **#12** Sequential A/B provisioning with orphan cleanup (`deleteAssistant` on variant-B failure)
- [x] **#10** (security) Webhook host derived only from `API_PUBLIC_URL` (`webhookHostFromPublicUrl`); the request Host header is never trusted. Activation 500s with a clear message if `API_PUBLIC_URL` is unset.
- [x] **#8** `maxConcurrent: 0` now preserved (dropped the `|| 5` coercion) — provision-but-don't-dial is honoured.

**Scheduled into Phase 6:** **#3** (durable opt-out) and **#4** (E.164 `+0…`) — done in Phase 6.0 below.

---

## 🔀 Direction change — Multi-channel campaigns (decided post-Phase 5)

Campaigns are no longer voice-only. A campaign now declares **channels** (`voice`, `whatsapp`, `email`, in any combination) and carries a **configurable template per channel**. The original "voice with follow-ups" model becomes "pick the channel(s), configure templates, launch." Decisions: **multi-channel per campaign**, **all three channels in parallel**, **pre-approved WhatsApp templates**.

### Phase 6.0 — Multi-channel foundation ✅ DONE
- [x] Generalised `VoiceCampaign`: `channels` (JSON), nullable voice fields, WhatsApp (`whatsappContentSid` / `whatsappTemplateBody` / `whatsappVariables`) + email (`emailSubjectTemplate` / `emailBodyTemplate`) template fields (migration `multichannel_campaigns`)
- [x] `MessageDelivery` model — per-lead outbound record for WhatsApp/email (non-voice analogue of `CallRecord`)
- [x] **#3** Durable `DoNotContact` suppression model + `suppressContact()` / `isSuppressed()`; checked at import (survives campaign/lead deletion)
- [x] **#4** `normalizeToE164` rejects `+0…` (country code can't start with 0)
- [x] Channel-aware validation (`validateChannels`, per-channel required fields), update builder, and serializer; activation only provisions Vapi for the `voice` channel
- [x] Tests: channel validation, per-channel requirements, #3 durable-suppression-across-deletion, #4 — full API suite 89/89, lint clean

### Phase 6.1 — Unified send engine ✅ DONE
- [x] `apps/api/src/core/campaigns/dispatch.ts` — 30s worker; per active campaign × messaging channel, batched (`CAMPAIGN_DISPATCH_BATCH`, default 200) so 50 or 50,000 leads are handled flat; idempotent per channel (a delivery row excludes the lead)
- [x] Shared **pre-send guard** `guard.ts` (`evaluateContact`): consent + durable suppression + channel-aware DND (voice-only, env-gated `ENFORCE_DND_SCRUB`)
- [x] **Channel sender registry** `senders.ts` — `ChannelSender` interface + `getSender()`; add a channel by registering a sender (reusable/dynamic)
- [x] WhatsApp sender: approved-template send via Twilio Content API (`sendWhatsAppTemplate`), ordered `ContentVariables` rendered from the `{variable}` system
- [x] Email sender: subject/body templates via Resend
- [x] Per-channel **spend cap** bounds the batch + auto-pauses (`campaign_paused` SSE); `campaign_message_sent` SSE per send
- [x] Records every send/skip/failure on `MessageDelivery`
- [x] CSV import made scale-safe: chunked lookups + inserts (`DB_CHUNK=1000`), configurable `CSV_MAX_UPLOAD_MB` (default 25)
- [x] Wired `startCampaignDispatchWorker()` into server startup
- [x] Tests: guard, senders (render/registry), dispatch (send + idempotency + guard-skip + spend-cap pause), E.164/import scale — full API suite 100/100, lint clean

---

## Phase 6 — Voice Dialler Worker — voice channel of the unified engine ✅ DONE

- [x] `apps/api/src/core/campaigns/worker.ts` — `startCampaignWorker()`, `runDialerTick()`, `processVoiceCampaign()` (30s interval, separate from the 60s automation engine)
- [x] Slot calc: `maxConcurrent − in-flight`
- [x] **Atomic `calling` lock** (`updateMany where status=pending`) before `initiateCall()` — prevents double-dial race
- [x] Balanced A/B assignment (lighter arm); variant reused on retry
- [x] Stuck-call recovery (in-flight > 15 min → call `failed` + lead reset to pending)
- [x] **Spend cap** (dials + sent messages ≥ spendCapCalls → auto-pause + SSE)
- [x] Auto-pause on Vapi 5xx; failed initiation returns the lead to the queue (no silent failure)
- [x] Pre-dial shared guard (`evaluateContact`): consent + durable suppression + DND; suppressed/opted-out → `opted_out`, no-consent → `failed`
- [x] Vapi calls dependency-injected → fully tested without keys; added `CallRecord.error` (migration)
- [x] Wired `startCampaignWorker()` into server startup (beside dispatch + automation workers)
- [x] Picks due retries via `nextCallAt` (the no_answer → nextCallAt scheduling itself lands in Phase 7's webhook)

_#3 (durable opt-out) and #4 (E.164 `+0…`) completed in Phase 6.0 above._

**DoD:** ✅ Worker dials due pending leads, respects caps/concurrency, never double-dials, recovers stuck calls, and never dials a non-consented or suppressed number. Dialler tests 7/7; full API suite 107/107, lint clean.

---

## Phase 7 — Webhook, Post-Call & **Real-Time In-Call Sentiment** ✅ DONE

- [x] `POST /webhooks/vapi` — public, verified by `x-vapi-secret` (`verifyWebhook`, env-gated `VERIFY_WEBHOOKS`); finds `CallRecord` by `vapiCallId`
- [x] `normalizeVapiMessage()` maps Vapi message types → internal events (status-update/transcript/end-of-call-report); ignores partials + unknowns
- [x] `call-started` → `in_progress` + `startedAt`
- [x] **Real-time sentiment:** `sentiment.ts` keyword classifier (word-boundary, keys-last) → `SentimentEvent` per final customer utterance + `campaign_sentiment_update` SSE
- [x] **Sentiment-driven safety:** opt-out phrase mid-call → `suppressContact` (durable) + outcome `opted_out`
- [x] `end-of-call-report` → transcript, outcome, keyPoints, duration, endedAt; final sentiment aggregated from the live timeline; `campaign_call_ended` SSE
- [x] Lead lifecycle + **no-answer retry scheduling** (attempts < maxRetries → `pending` + `nextCallAt`; else `called`)
- [x] `followup.ts` — fires `followUpRules[outcome]` channels by **reusing the sender registry** (no duplicate send logic); records `MessageDelivery`; sets `whatsappSent`/`emailSent`; `campaign_followup_sent` SSE; **never fires for opted-out leads**

**DoD:** ✅ A simulated Vapi stream builds a live sentiment timeline; mid-call opt-out suppresses tenant-wide; end-of-call finalises the record, schedules no-answer retries, and fires outcome-based follow-ups. Tests: sentiment 3 + webhook 6; full API suite 116/116, lint clean.

---

## Phase 8 — **Conversational WhatsApp Agent** (Day 5–6)

> Extends Eynis's existing inbound WhatsApp ingestion into a stateful, two-way AI conversation tied to a campaign lead.

- [ ] Add `whatsapp_agent` mode to the connector/ingest path (reuse existing Twilio/Interakt inbound)
- [ ] On inbound WhatsApp, resolve/create a `WhatsappConversation` for the matching `CampaignLead`
- [ ] Write `apps/api/src/core/campaigns/whatsapp-agent.ts` — builds context (campaign script, persona, lead vars, prior thread), calls Claude to generate the next reply, sends via the WhatsApp connector
- [ ] **Per-message sentiment:** classify each inbound WhatsApp message → store on `WhatsappMessage` + roll into conversation sentiment
- [ ] **Booking intent:** when the model detects intent, inject `{booking.calendlyLink}` into the reply
- [ ] **Opt-out detection** over WhatsApp → mark conversation + lead `opted_out` tenant-wide, stop all messaging
- [ ] Conversation state machine (open → awaiting_reply → booked / closed / opted_out); idempotency so a duplicate inbound webhook doesn't double-reply
- [ ] Broadcast `whatsapp_message` SSE events for the live feed

**DoD:** A real WhatsApp reply triggers a contextual AI response within seconds, sentiment is recorded per message, "stop" opts the lead out, and booking intent surfaces the Calendly link.

---

## Phase 9 — Analytics & A/B (Day 5–6)

- [ ] `GET /campaigns/:id/calls` (paginated, join lead firstName + company)
- [ ] `GET /campaigns/:id/calls/:callId` (full transcript + sentiment timeline + WhatsApp thread)
- [ ] `GET /campaigns/:id/analytics` — per-variant funnel, answer/interest/booking rates, avg duration, **avg sentiment per variant**, two-proportion z-test for leading variant
- [ ] Enforce ≥50 answered per arm before declaring a winner ("insufficient sample" otherwise)
- [ ] CSV export: `GET /campaigns/:id/calls?format=csv` (Content-Disposition header)

**DoD:** Analytics endpoint returns correct funnel + per-variant stats + sentiment, with winner gating.

---

## Phase 10 — Frontend (multi-channel) — core flow ✅ DONE

- [x] Campaign fetch functions in `lib/data.ts`; Next.js proxy routes under `app/api/campaigns/` (create, PATCH/DELETE, lifecycle action, multipart import forwarder)
- [x] **Campaigns** nav item (Mic icon) added to every industry config + web route permission
- [x] `/campaigns` — list with channel chips, status chips, per-campaign stats, inline Activate/Pause, New Campaign CTA, empty state
- [x] `/campaigns/new` — multi-channel **CampaignBuilder**: channel toggles (voice/WhatsApp/email) revealing per-channel template editors; reusable **variable-reference panel** (click-to-insert) shared across all channels; A/B voice pickers; delivery controls (concurrency, spend cap, country)
- [x] `/campaigns/[id]` — Overview (stats + lead-status + outcome breakdown) and Leads tabs; Activate/Pause + Import in header
- [x] `/campaigns/[id]/leads/import` — **LeadImportWizard**: upload → auto column-mapping → 5-row preview → import, with consent attestation; parses only the first 64KB client-side so very large CSVs stay responsive (full file uploaded for server-side chunked import)

**Verification:** web `tsc` + `next build` clean; all 8 campaign routes compile; full API suite 100/100.

**Deferred to a follow-up UI pass (need Phase 7/9 endpoints):**
- [ ] Calls tab: SSE live log + transcript + **sentiment meter** + **WhatsApp thread view** (needs Phase 7 call/sentiment data + a deliveries/activity endpoint)
- [ ] A/B comparison cards + leading-variant (needs Phase 9 analytics)
- [ ] Settings tab edit form (PATCH wired; form UI pending)
- [ ] Live activity feed of `campaign_message_sent` deliveries

---

## Phase 11 — Compliance Hardening (Day 9)

- [ ] Verify mandatory AI disclosure is present and non-removable in every script
- [ ] Verify opt-out (voice + WhatsApp) permanently excludes the lead tenant-wide and suppresses all follow-up
- [ ] Implement GDPR **erasure endpoint** (nulls phone/email, retains anonymised outcome)
- [ ] Implement consent enforcement at import and pre-dial
- [ ] (If India) wire DND/TRAI pre-flight scrub
- [ ] Daily spend alert + failure-rate alert (>5%)

**DoD:** Every compliance control from Phase 1 is live and tested; nothing can dial/message a non-consented or opted-out lead.

---

## Phase 12 — Testing, Validation & Launch (Day 10)

- [ ] API tests: webhook → CallRecord update; no_answer retry; spend-cap auto-pause; real-time sentiment write; WhatsApp agent reply + opt-out
- [ ] `npm run lint` and `npm run test` green across packages
- [ ] Empty states (no campaigns / no leads / no calls) with contextual CTAs
- [ ] Full end-to-end: create → import → activate → observe live call + sentiment → end-of-call follow-up → WhatsApp back-and-forth → analytics
- [ ] Update `CLAUDE.md`: new env vars, new routes, campaign + sentiment + WhatsApp-agent workers, new connectors
- [ ] Update seed script: demo VoiceCampaign for "The Riviera" with sample leads
- [ ] Build → test → self-review → user validation → push (per engineering principles)

**DoD:** Feature passes a full live run with sentiment + WhatsApp chat working, all tests pass, docs and seed updated.

---

## Capability Cross-Reference

| Added capability | Phases that deliver it |
|---|---|
| Real-time in-call sentiment | Phase 2 (`SentimentEvent`), Phase 7 (stream + classify + SSE + safety), Phase 9 (per-variant avg), Phase 10 (sentiment meter) |
| Two-way WhatsApp chat agent | Phase 2 (`WhatsappConversation`/`WhatsappMessage`), Phase 8 (agent + state + per-message sentiment + opt-out), Phase 10 (thread view) |
| Compliance overcoming the flags | Phase 1 (foundation) + Phase 11 (hardening), enforced in Phases 5–8 |
| Cost control | Phase 6 (spend cap, concurrency, retry limits, auto-pause) |
| Latency control | Phase 3/7 (Haiku model, voice-carries-quality, latency monitoring) |
