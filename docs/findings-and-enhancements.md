# Findings & Enhancements

> Full-codebase audit of the Eynis platform — findings, bugs, placeholders, and a
> prioritized enhancement roadmap. Each finding has a stable ID (`F-NN`) so it can be
> tracked to a GitHub issue and a fixing commit.
>
> **Generated:** 2026-06-04 · **Branch:** `claude/codebase-analysis-roadmap-RjQMH`

---

## 0. Verification snapshot (what was actually run)

| Check | Result |
|---|---|
| `npm run build` (shared → api → web, incl. `next build`) | ✅ passes |
| `npm run lint` (`tsc --noEmit` on api + web) | ✅ clean |
| `npm run test -w @eynis/api` (real Postgres, no mocking) | ✅ **204 / 204 passing** |
| CI (`.github/workflows/ci.yml`) | ✅ real — Postgres service, lint → build → migrate → test |
| Prisma models | 32 models, 14 ordered migrations |
| `apps/api/src/server.ts` | **4,136 lines** — single-function `if/else` router |

---

## 1. Where we stand (executive summary)

Eynis has a **genuinely working, well-tested multi-tenant SaaS backbone** running alongside a
**demo-shell outer UI layer**. The finished parts are above typical MVP quality; the unfinished
parts are mostly "the backend exists but the UI shows mock data" and "the newest subsystems aren't
tested."

**Real & solid:** auth/RBAC (live DB checks, forge-proof tenant claims), campaigns/outreach (voice
via Vapi, WhatsApp via Twilio/Interakt, email via Resend — all real provider calls), email
suppression + Svix webhook verification, tenant branding / custom domains, the AI intelligence layer
(real Anthropic + OpenAI calls), and a real CI pipeline.

**Two big themes to close:**
1. **Mock UI over a working API** — ~13 of 37 web pages render hardcoded arrays and never call the
   API, even where a working endpoint already exists (analytics pages especially).
2. **Newest = riskiest** — the AI layer and automation engine are real and wired but have **zero
   tests** and the weakest error handling; campaigns has real double-send / spend-cap race windows.

---

## 2. Master findings list

Severity: 🔴 HIGH · 🟠 MED · 🟡 LOW. Status updated as fixes land.
GitHub issue number = finding number + 47 (F-1 → #48 … F-35 → #82).

| ID | Sev | Area | Finding | Status |
|---|---|---|---|---|
| F-1 | 🔴 | Security | SSE broadcast not tenant-scoped — cross-tenant data leak | ✅ fixed (#48) |
| F-2 | 🔴 | Security | `/connectors/pms/webhook` unauthenticated + trusts body `tenantId` | ✅ fixed (#49) |
| F-3 | 🔴 | Campaigns | Messaging dispatch has no atomic per-lead lock → double-send | ✅ fixed (#50) |
| F-4 | 🔴 | Campaigns | Spend cap racy / double-counted across two workers | ✅ fixed (#51) |
| F-5 | 🔴 | Campaigns | Email-only leads silently never send (guard hard-requires phone) | ✅ fixed (#52) |
| F-6 | 🔴 | Tests | Zero tests for `intelligence.ts` and `engine.ts` | ✅ fixed (#53) |
| F-7 | 🔴 | Correctness | `GET /service-requests/:id/transitions` is dead code (route shadowing) | ✅ fixed (#54) |
| F-8 | 🟠 | Frontend | 4 analytics pages render mock data; real API + fetchers already exist | ✅ fixed (#55) |
| F-9 | 🟠 | Security | Webhook signature verification defaults off & is omission-bypassable | ✅ fixed (#56) |
| F-10 | 🟠 | Security | Resend webhook: no replay/timestamp check; unauth when secret unset | ✅ fixed (#57) |
| F-11 | 🟠 | AI | `extractJson()` fragile + results blindly cast (no runtime validation) | ✅ fixed (#58) |
| F-12 | 🟠 | AI | AI routes have no try/catch → generic 500, cause swallowed | ✅ fixed (#59) |
| F-13 | 🟠 | Automation | Idempotency check-then-act race + overlapping `setInterval` | ✅ fixed (#60) |
| F-14 | 🟠 | Campaigns | `followup.ts` skips template gate + suppression, non-idempotent, untested | ✅ fixed (#61) |
| F-15 | 🟠 | Campaigns | Sequence runner ignores send-windows / quiet-hours | ✅ fixed (#62) |
| F-16 | 🟠 | Campaigns | Per-tenant Vapi webhook secret never used for verification | ✅ fixed (#63) |
| F-17 | 🟠 | Backend | Analytics endpoints fabricate data (`Math.random`, hardcoded constants) | ◐ sentiment+upsell real; revenue/staff = sample (no PMS) (#64) |
| F-18 | 🟠 | Compliance | TRAI DND scrub is a stub AND enforcement defaults off | ◐ documented (default OFF by decision; registry = follow-up) |
| F-19 | 🟠 | Frontend | Vertical pages (inventory/orders/patients/…) are pure frontend mock | ◐ inventory built for real (#66); others still mock |
| F-20 | 🟡 | White-label | Hardcoded "Riviera"/INR/hotel branding in AI prompts + automation Rule 3 | ☐ open |
| F-21 | 🟡 | White-label | `eynis.com` hardcoded in billing alert (customer-facing) | ☐ open |
| F-22 | 🟡 | Security | `JWT_SECRET` defaults to dev string; no startup assertion in prod | ✅ fixed (#69) |
| F-23 | 🟡 | Security | Unknown legacy role silently grants `viewer` read access (default-allow) | ✅ fixed (#70) |
| F-24 | 🟡 | Security | `GET /auth/identify` is an unauthenticated email-enumeration oracle | ✅ fixed (#71) |
| F-25 | 🟡 | AI | Model `claude-opus-4-7` lags the `opus-4-8` runtime | ☐ open |
| F-26 | 🟡 | Correctness | Guest search case-sensitive & unindexed (`contains`, no `mode`) | ✅ fixed (#73) |
| F-27 | 🟡 | Correctness | `hasMore` pagination computed inconsistently across routes | ☐ open |
| F-28 | 🟡 | Campaigns | Retry budget off-by-one (`> maxRetries` → `maxRetries+1` attempts) | ✖ not a bug (verified) |
| F-29 | 🟡 | Campaigns | Twilio outbound drops message SID → `providerId: null` | ☐ open |
| F-30 | 🟡 | Campaigns | Provider 5xx auto-pause only covers voice, not messaging | ☐ open |
| F-31 | 🟡 | Architecture | `request-context.ts` header-trust stub (delete before it's wired) | ✅ fixed (#78) |
| F-32 | 🟡 | Architecture | `server.ts` is a 4,136-line single function; route ordering load-bearing | ☐ open |
| F-33 | 🟡 | Quality | Duplicated `safeArray`/`safeObject` + send-context block across 5 files | ☐ open |
| F-34 | 🟡 | Security | Body parsing has no size limit (memory-exhaustion DoS) | ✅ fixed (#81) |
| F-35 | 🟡 | Correctness | `assignedToUserId` auto-assign keys off deprecated legacy role | ✅ fixed (#82) |

---

## 3. Detailed findings

### 3.1 Security & tenant isolation

**F-1 🔴 SSE broadcast is not tenant-scoped.** `apps/api/src/sse/clients.ts` holds a flat `Map` of
clients with no `tenantId`. `broadcastSSEEvent()` fans out *every* event — `sr_updated`
(`server.ts:1481`), `checkin_event` (`:2874`, payload includes `guestName`, `roomNumber`) — to all
connected clients across all tenants. **Real cross-tenant data leak.** Fix: tag each SSE client with
its `tenantId` at connect and filter broadcasts by tenant.

**F-2 🔴 `/connectors/pms/webhook` is unauthenticated and trusts client-supplied `tenantId`.**
`server.ts:2881` — no signature, no auth; `tenantId` is read from the body (`:2888`) and only gated
by an existence check (`ensureTenantAccess`). Anyone who knows/guesses a tenant id can inject
check-in/checkout events, create `Contact`/`Stay` rows, and bump `visitCount`. The `permissionMap`
entry for it (`:415`) is never enforced — misleading dead config. `/connectors/pms/simulate`
(`:2853`) is a demo endpoint that writes real data in prod.

**F-9 🟠 Webhook signature verification defaults off & is omission-bypassable.** `VERIFY_WEBHOOKS`
defaults `false`. On the WhatsApp webhook (`server.ts:1001`) the Twilio/Interakt signature is only
checked *if the header is present* — omit it and verification is skipped. `webhook-verify.ts:56`
returns `{ ok: true }` when no secret is configured. Twilio's verifier is also called with
`params: {}` (`:1017`) so it can't validate real form-encoded Twilio webhooks. Fix: fail closed in
prod; verify regardless of header presence.

**F-10 🟠 Resend webhook replay + unauth-when-unset.** `resend-webhook.ts:85` verifies the Svix HMAC
correctly but never checks `svix-timestamp` freshness → captured payloads replay forever. The route
(`server.ts:984`) accepts all when `RESEND_WEBHOOK_SECRET` is unset → forged bounce/complaint events
can suppress arbitrary recipients.

**F-22 🟡** `JWT_SECRET` defaults to `"dev-only-secret-change-me"` (`auth.ts:17`) with no startup
assertion — if unset in prod, all tokens are forgeable. **F-23 🟡** unknown/unmapped legacy role
falls back to `viewer` (`rbac.ts:36`) — default-allow read access. **F-24 🟡** `GET /auth/identify`
(`server.ts:567`) is an unauthenticated, unthrottled email→tenant enumeration oracle. **F-34 🟡**
`parseRawBody` (`server.ts:46`) buffers unbounded request bodies → DoS on any public endpoint.

### 3.2 Correctness bugs

**F-7 🔴 `GET /service-requests/:id/transitions` is dead code.** The broad list handler at
`server.ts:1287` (`startsWith("/service-requests") && GET`) returns before the dedicated transitions
handler at `:2101` is reached — callers get a (mis-parsed) request list instead. It also lacks a
`canAccess` check, so it's a latent authz hole once reachable. Fix: reorder (specific before broad)
and add the permission check.

**F-26 🟡** Guest search uses `{ contains: search }` without `mode: "insensitive"` (`server.ts:2293`)
— case-sensitive on Postgres, full-scan. **F-27 🟡** `hasMore` is computed as `offset+limit<total`
in some routes and `offset+items.length<total` in others — inconsistent. **F-35 🟡**
`assignedToUserId` auto-assignment keys off the deprecated legacy `role === "front_desk"`
(`server.ts:1249`) instead of `roleKey` → fires inconsistently under the new RBAC model.

### 3.3 Campaigns / outreach

**F-3 🔴 No atomic per-lead lock in messaging dispatch.** The voice worker locks each lead via
`updateMany(pending → calling)` + `lock.count === 1` (`worker.ts:156`). The messaging dispatcher has
no equivalent (`dispatch.ts:91`) and writes the `MessageDelivery` row only *after* the provider send
(`:183`). Overlapping ticks (or a provider call slower than the 30s tick) can select & send the same
lead twice. No DB uniqueness backs it. Fix: add a `@@unique` on `(campaignId, leadId, channel)` and
an atomic claim.

**F-4 🔴 Spend cap racy.** Voice (`worker.ts:79`) and messaging (`dispatch.ts:60`) workers each
independently read `callRecord.count + messageDelivery.count` vs `spendCapCalls` on separate timers
with no atomic reservation → both can see budget and overshoot.

**F-5 🔴 Email-only leads never send.** The shared guard `canContactLead` hard-requires a phone
(`compliance.ts:105` → `missing_phone`); dispatch email (`dispatch.ts:169`) and sequence runner
(`sequence-runner.ts:92`) route email through it, so any lead with an email but no phone is recorded
`skipped` and never emailed. Entire Resend backend is unreachable for the common email-only case.

**F-14 🟠 `followup.ts` diverged from dispatch.** It sends WhatsApp via `campaign.whatsappContentSid`
directly with **no approval-template gate** (`followup.ts:45`), **ignores `DoNotContact` /
`EmailSuppression`** (only checks `lead.optedOut`), and is non-idempotent on re-delivered webhooks.
It is also **untested** — the module with the most correctness gaps has zero coverage.

**F-15 🟠** Sequence runner has no `schedule-gate` call → drip steps fire 24/7, bypassing
quiet-hours that the other two workers enforce. **F-16 🟠** Vapi assistants are provisioned with a
per-tenant `webhookSecret` (`vapi.ts:81`) but the inbound route verifies only the global
`process.env.VAPI_WEBHOOK_SECRET` (`server.ts:739`) → tenant-configured secrets break verification.
**F-28 🟡** retry skip uses `> maxRetries` → allows `maxRetries+1` attempts (`dispatch.ts:116`).
**F-29 🟡** Twilio outbound returns no `id` (`whatsapp-outbound.ts:49`) → `providerId: null` breaks
delivery correlation. **F-30 🟡** 5xx auto-pause only on voice (`worker.ts:193`), not messaging.

**F-18 🟠 TRAI DND.** `compliance.ts:176` `dndScrub()` is a Phase-1 stub (never clears `+91`), and
enforcement is gated by `ENFORCE_DND_SCRUB` which **defaults off** (`guard.ts:43`) → Indian numbers
dial with no scrub in default config. Compliance risk before India go-live.

### 3.4 AI & automation

**F-6 🔴** `intelligence.ts` and `engine.ts` have **no test files** — the two highest-risk
subsystems are completely unvalidated.

**F-11 🟠 `extractJson()` fragile.** `intelligence.ts:47` uses a greedy `/\{[\s\S]*\}/` regex then
`JSON.parse`, throws on prose containing stray braces, and the result is **blindly cast** to typed
shapes with zero runtime validation → malformed AI output reaches the DB/client (and is persisted in
night audit regardless, `server.ts:2810`).

**F-12 🟠** The 4 AI route handlers + night audit call AI functions with no local try/catch → any
failure (timeout, rate-limit, parse throw) bubbles to the generic `500` at `server.ts:4110`, cause
swallowed, no retry/degradation. Only the ingest classifier has a real fallback.

**F-13 🟠 Automation idempotency race.** `hasExecution` (`engine.ts:4`) is check-then-act with no
transaction; `setInterval(() => void runCycle())` (`:254`) doesn't await the prior cycle, so a slow
cycle overlaps and two evaluations can both pass the check and both act (double escalate / welcome /
offer). Needs a DB unique constraint + awaited loop.

**F-25 🟡** `CLAUDE_MODEL = "claude-opus-4-7"` lags the `opus-4-8` runtime.

### 3.5 Frontend — mock data / placeholders

**F-8 🟠 4 analytics pages are mock over a working API.** `revenue-intelligence`,
`staff-performance`, `sentiment-trends`, `upsell-campaigns` render hardcoded constants and make
**zero fetch calls** — even though `lib/data.ts` already defines `fetchRevenueAnalytics`,
`fetchStaffPerformance`, `fetchSentiment`, `fetchUpsellCampaigns` (`data.ts:316-398`) and the API
routes exist. `analytics/page.tsx` is self-labeled "6-month sample data." **Lowest-effort visible
win.** (Note: backend F-17 must be addressed too, or the wired pages show fabricated numbers.)

**F-17 🟠 Backend analytics fabricate data.** `/analytics/sentiment` returns `Math.random()`
sentiment/NPS/30-point timeseries (`server.ts:2452`); morning briefing & revenue insights pass
hardcoded `occupancyPct:72, adrInr:8500, todayRevenue:284000` into the AI.

**F-19 🟠 Vertical pages are pure frontend mock.** `inventory, materials, menu, orders, patients,
appointments, bookings, quotes, customers, ai-brain` hold data in module-level `const` arrays /
`useState`; edits and imports persist nothing. `ai-brain` fakes AI with `MOCK_ANSWERS` + a 1.2s
`setTimeout` and a static "● Live" badge.

### 3.6 White-label principle violations (vs CLAUDE.md)

**F-20 🟡** AI system prompt hardcodes "hotels in India / INR" (`intelligence.ts:35`); automation
Rule 3 hardcodes `"Welcome to The Riviera"` / `"Your Concierge Team"` for every tenant
(`engine.ts:155`). **F-21 🟡** billing alert hardcodes `sales@eynis.com` (`billing-client.tsx:198`).

### 3.7 Architecture & code quality

**F-31 🟡** `core/request-context.ts` trusts `x-hotel-id`/`x-user-role` headers with no verification
— a tenant-isolation footgun; delete before it's ever wired. **F-32 🟡** `server.ts` is one
4,136-line function; route ordering is load-bearing (root cause of F-7); the
auth→permission→tenant preamble is copy-pasted ~50× with inconsistent ordering. **F-33 🟡**
`safeArray`/`safeObject` redeclared in 5 files; the build-context→send→write-delivery block is
duplicated between `dispatch.ts` and `followup.ts` and has drifted (root cause of F-14).

---

## 4. What's incomplete / left to build

- Wire the analytics pages to real endpoints (F-8) + replace fabricated backend numbers (F-17).
- Real persistence behind the vertical pages, or mark them honestly as "preview" (F-19).
- TRAI DND Phase 2 + enable enforcement before India go-live (F-18).
- GDPR erasure endpoint (`gdprErase` / `suppressContact` exist but aren't wired).
- Demo seed for a populated campaign (clickable flow with no API keys).
- Billing / Razorpay (currently an `alert()`).
- Tests for AI, automations, `followup.ts`, ingest (F-6).
- Rename internal `VoiceCampaign` model (it's multi-channel now).

---

## 5. Enhancement roadmap (recommended order)

**Sprint 1 — Make it honest & safe.** F-1, F-2 (security HIGH, contained) · F-3 + F-4 (double-send /
spend-cap via DB unique constraint + atomic claim) · F-5 (email-only leads) · F-7 (route shadowing) ·
F-8 (wire analytics pages — biggest visible win).

**Sprint 2 — De-risk the AI/automation core.** F-11 + F-12 (harden parsing + error handling) · F-6
(tests for AI + automation + followup) · F-13 (automation idempotency) · F-17 (real analytics
aggregates) · F-14/F-15/F-16 (campaign follow-up + sequence + Vapi secret fixes).

**Sprint 3 — Vertical story + launch hardening.** Decide vertical persistence vs "preview" (F-19) ·
F-18 (DND) · GDPR erasure · demo seed · white-label cleanup (F-20, F-21) · refactor `server.ts` into
a route table (F-32) · remaining 🟡 items.

---

## 6. Progress log

Fixes are recorded here as they land (newest first).

- **F-31 (#78) — deleted the header-trust stub.** Removed the unused
  `core/request-context.ts` (derived identity from unverified `x-hotel-id`/`x-user-role` headers —
  a tenant-isolation bypass if ever wired in) and the only file importing it,
  `events/audit-log.ts` (also unused). The wired `event-bus.ts` was left in place.
- **LOW security/correctness sweep (decision: "just security/correctness LOWs") — fixed.**
  - **F-22 (#69)** — `assertJwtSecretConfigured()` fails server boot in production when `JWT_SECRET`
    is unset or equals the dev default.
  - **F-23 (#70)** — `getPermissionsForLegacyRole` now default-**denies** an unrecognised role
    (returns `[]`) instead of silently granting `viewer` read access; still maps legacy roles and
    valid new role keys.
  - **F-24 (#71)** — `GET /auth/identify` is throttled per client IP (20/min, new
    `core/rate-limit.ts`), closing the email-enumeration oracle. +3 tests.
  - **F-26 (#73)** — guest search uses `mode: "insensitive"` (case-insensitive `LIKE`).
  - **F-28 (#75)** — **not a bug.** Verified against the existing test: `maxRetries` means
    *retries beyond the first attempt*, so `> maxRetries` correctly caps total attempts at
    `maxRetries + 1`. Reverted the speculative change.
  - **F-34 (#81)** — `parseRawBody` caps request bodies at `MAX_BODY_BYTES` (1 MiB default) and the
    top-level handler returns `413`, preventing memory-exhaustion on public endpoints.
  - **F-35 (#82)** — SR auto-assignment keys off the canonical `roleKey` ("manager") with a legacy
    fallback, not the deprecated `role` union.
  - Suite: 254 → 257 green.
- **F-19 (#66) — inventory vertical built for real (decision: "build one vertical").** New
  `InventoryItem` model (migration), `core/inventory/service.ts` (tenant-scoped list / stock
  movement upsert / update / delete with derived ok/warning/critical status), and real
  `GET/POST/PUT/DELETE /inventory/items` routes gated by a new `manage_inventory` permission
  (reads via `view_reports`). The `/inventory` page is now a server component fetching live data
  with a client that persists movements, CSV import, and deletes through proxy routes — no more
  module-level mock. Added service unit tests + an RBAC integration test (9 tests). The other
  vertical pages remain mock (this is the template to extend). API 249→254 green; web build green.
- **F-18 (#65) — TRAI DND — documented (decision: leave default OFF).** Enforcement stays gated
  by `ENFORCE_DND_SCRUB` (default off); the live registry integration needs an external provider
  and remains a tracked follow-up. `compliance.ts` already documents the Phase-1 stub.
- **F-8 (#55) — analytics pages wired to real data (decision: "wire real, label the rest").**
  `sentiment-trends` and `upsell-campaigns` are now server components that fetch the live
  endpoints (new `sentiment-trends-client.tsx` / `upsell-campaigns-client.tsx`), rendering real
  breakdown/drivers/series and offer performance with honest empty-states. `revenue-intelligence`
  and `staff-performance` carry a clear amber **"Sample data"** badge (no PMS/ratings source
  yet), and `analytics` keeps its existing sample label — nothing fabricated is shown as real.
  Web build green.
- **F-17 (#64) — fabricated analytics — sentiment done (partial).** The `/analytics/sentiment`
  endpoint no longer uses `Math.random()`/hard-coded drivers — extracted
  `core/analytics/sentiment.ts` which computes real breakdown, net score, by-source counts, a
  30-day daily-average series, and frequency-based drivers from `SentimentEvent` (voice) +
  `ConnectorEvent.aiSentiment` (inbound); empty data yields genuine zeros, not guesses. Added 2
  unit tests. _Remaining:_ revenue-intelligence/morning-briefing/night-audit still pass
  hard-coded occupancy/ADR to the AI because there is **no PMS data source** for those — needs a
  product decision (see open question), so left as-is for now.
- **F-9 / F-10 (#56, #57) — webhook hardening — fixed.** WhatsApp webhook: the shared-secret
  check now uses `verifySharedWebhookSecret` (constant-time, fails closed in prod), and when
  `VERIFY_WEBHOOKS=true` a request with no provider signature header is rejected (closing the
  omission bypass). Resend webhook: fails closed in prod when `RESEND_WEBHOOK_SECRET` is unset,
  and rejects stale/missing `svix-timestamp` (>5m) to stop signature replay. Declared both
  secrets in `render.yaml`. Added 2 integration tests. Suite: 243 → 245 green.
- **F-15 (#62) — sequence runner ignored quiet-hours — fixed.** The drip runner had no
  schedule gate, so steps could fire overnight. Sequences carry no schedule of their own, so
  each step now gates on its lead's originating campaign send-window via `campaignMaySendNow`;
  outside the window the enrollment is **deferred** (nextRunAt pushed `SEQUENCE_DEFER_MIN`,
  default 30m) rather than sent or stopped. Added a deferral regression test. Suite: 242 → 243.
- **F-14 / F-16 (#61, #63) — post-call follow-up + Vapi webhook secret — fixed.** `followup.ts`
  now mirrors the dispatcher: it enforces the approved-WhatsApp-template gate, honours the
  durable `DoNotContact` + `EmailSuppression` lists, and is idempotent (per-channel
  `whatsappSent`/`emailSent` flags make a re-delivered end-of-call webhook a no-op). Added
  `followup.test.ts` (6 tests). For F-16, the Vapi webhook now resolves the expected secret
  **per-tenant** (mapping the call → tenant, since assistants are provisioned with that
  tenant's `webhookSecret`) and falls back to the global env secret. Suite: 236 → 242 green.
- **F-13 (#60) — automation idempotency race — fixed.** Wrapped the cycle in `singleFlight`
  (`runAutomationCycle`) so a 60s cycle can't overlap the next, and added a DB
  `@@unique([ruleId, triggerEntityId])` on `AutomationExecution` (migration dedupes any
  pre-existing rows first) as the backstop; `recordExecution` now swallows the P2002
  unique-violation as "already handled." Moved `singleFlight` to `core/single-flight.ts` (now
  shared by both workers). Added a concurrent-cycle regression test. Suite: 235 → 236 green.
- **F-11 / F-12 (#58, #59) — AI parsing + route error handling — fixed.** `extractJson` now
  returns `null` instead of throwing on no-match/parse-failure; a new `parseStructured<T>`
  validates the response is a plain object with the required keys, throwing a typed
  `AiResponseError` otherwise — so structurally-invalid AI output is rejected rather than
  cast through to the DB/client. All five AI routes are wrapped in try/catch via an `aiError`
  helper that logs the cause and returns a clean `502` (night audit no longer persists a
  malformed report). Added 4 parse tests. Suite: 232 → 235 green.
- **F-6 (#53) — no tests for AI + automation — fixed.** Added `engine.test.ts` (5 integration
  tests: each of the 4 rules acts correctly + is idempotent, plus multi-tenant scoping),
  `intelligence.test.ts` (`extractJson` success/embedded/nested/failure), and `ingest.test.ts`
  (keyword classifier routing, priority/SLA, summary truncation). Exported the four rule
  evaluators, `extractJson`, and `keywordClassify` as test seams. Suite: 217 → 232 green.
- **F-3 / F-4 (#50, #51) — messaging double-send + spend-cap overshoot — fixed.** Root cause
  was `setInterval(() => void tick())` being fire-and-forget: a tick that overran the 30s
  interval overlapped the next, so two passes re-selected the same fresh leads (double-send)
  and each spent the full remaining budget (the per-tick cap already bounds `batchSize` to the
  remaining budget, so the only overshoot was from overlap). Extracted a `singleFlight` helper
  and wrapped both `runDispatchTick` and `runDialerTick` so a pass can't overlap itself. The
  voice worker's per-lead `pending→calling` lock already prevented double-dialling. Added
  `single-flight.test.ts` (3 tests). _Residual:_ the voice and messaging workers are separate
  30s timers, so a hard cross-worker cap would need a shared atomic reservation — the cap is a
  soft ceiling by design; overshoot is now bounded to at most one concurrent worker pass rather
  than unbounded overlap. Suite: 217/217 green.
- **F-5 (#52) — email-only leads never send — fixed.** `canContactLead` is now
  channel-aware: the email channel requires a deliverable address (`isLikelyEmail`),
  voice/WhatsApp require a phone (default). Threaded `email`+`channel` through `guard.ts`,
  and fixed both dispatch and sequence-runner where email-only leads were additionally
  force-suppressed for lacking a phone (email suppression is checked against the email
  list instead). Added 3 regression tests. Suite: 214/214 green.
- **F-7 (#54) — transitions route dead code — fixed.** The broad `GET /service-requests`
  list handler matched `startsWith("/service-requests")`, swallowing
  `/service-requests/:id/transitions` so it never ran. Narrowed the list match to the
  collection path only (`=== "/service-requests"` or `?…`), unshadowing the transitions
  route, and added the missing `view_requests` permission check to it. Strengthened the
  existing test to assert a real transition (`toStatus: "accepted"`) — it previously passed
  against the wrong handler. Suite: 211/211 green.
- **F-2 (#49) — PMS webhook unauthenticated — fixed.** Added `verifySharedWebhookSecret`
  (constant-time, **fails closed in production** when `PMS_WEBHOOK_SECRET` is unset) and gated
  `POST /connectors/pms/webhook` behind it before any data write. `/connectors/pms/simulate`
  (demo writes) is now disabled in production unless `ENABLE_PMS_SIMULATE=true`. Added
  `webhook-verify.test.ts` (5 tests). Suite: 211/211 green.
- **F-1 (#48) — SSE cross-tenant leak — fixed.** `sse/clients.ts` now binds each client
  to its authenticated `tenantId` and `broadcastSSEEvent(tenantId, payload)` only delivers
  to clients of that tenant. All 14 call sites (server.ts, ingest, campaigns) updated to pass
  the owning tenant. Added `sse/clients.test.ts` (2 regression tests). Full suite: 206/206 green.
