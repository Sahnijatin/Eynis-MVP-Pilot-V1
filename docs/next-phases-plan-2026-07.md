# Next Phases — Build Sequence (July 2026)

**Source:** continuation of `docs/improvement-plan-2026-07.md`, whose engineering phases
(0–5) are all ✅ complete at this writing (433/433 API tests green; `server.ts` decomposed
into domain routers; authz matrix enforced). What remains is the product-depth work that
was deliberately decision-gated (old Phase 6), plus two parked items (C1, Redis limiter).
This document sequences them as build phases 6–10.

Ordering principle: pilot-revenue value first (the quote loop a customer actually touches),
then demo/sales impact (a real vertical), then launch compliance, then feedback-gated and
scale-gated items last. Each phase is independently shippable and keeps the suite green.

**Status legend:** ☐ pending · ◐ in progress · ✅ done

---

## Phase 6 — Customer self-serve quote link (~2–3 days)

Closes the quote loop: today the "customer link" is a linked Contact record and staff mark
acceptance manually. A customer should be able to open their quote and accept/decline it.

- ✅ **6.1 Signed public quote token.** On send, mint a random token; store only its SHA-256
  (reuse `hashToken` from `core/crypto/secrets.ts` — same pattern as invites). Token binds to
  one quote; regenerated on re-send; unusable after the quote is decided or expired.
- ✅ **6.2 Public view endpoint.** `GET /public/quotes/:token` → the customer-safe
  representation ONLY (reuse `quotePdfBlocks`' allocation: piece + spec + selling amount +
  GST — never cost/overhead/margin). Tenant-branded via the existing report-brand loader.
  Rate-limited per IP; 404 for unknown/expired tokens with no tenant enumeration.
- ✅ **6.3 Public decision endpoint.** `POST /public/quotes/:token/accept|decline` →
  drives the SAME `canTransition` state machine (sent → accepted/rejected) and the same
  deal-value commit; writes an AuditLog row with actor "customer". Idempotent (a second
  accept returns the decided state, no double deal update).
- ✅ **6.4 Web page.** `apps/web/app/q/[token]` — public, pre-auth, host-brand themed
  (like `/request`): quote view + Accept / Decline buttons + confirmation state.
- ✅ **6.5 Delivery.** Include the link in the quote-sent follow-up (WhatsApp/email
  sequence variables) and show a copy-link button on the quotes list for sent quotes.
- ✅ **6.6 Tests.** Token lifecycle (hash-only at rest, invalidated on decide/expire),
  no-cost-leak assertion on the public payload, decision idempotency, rate limit,
  cross-tenant/guessing 404s.

**Acceptance:** a customer with the link — and nobody without it — can view and decide a
sent quote; internal costing never appears in any public payload; every decision lands in
the audit log and the deal value exactly as staff-driven decisions do.

---

## Phase 7 — Manufacturing vertical wired for real (~1 week)

The biggest sales/demo gap: mfg tenants have real Quotes/Materials/CRM but a "Sample"-badged
Command Centre, Live Orders, and Client Intelligence. Make manufacturing the first fully
real non-hospitality vertical (its ops loop is already 70% built via quotes + inventory).

- ✅ **7.1 Order model.** `Order` created from an ACCEPTED quote (orderNumber, quoteId,
  contactId/companyId, valuePaise frozen from the quote, stage: `new → production → qc →
  dispatch → delivered`, promisedDate, notes) + `OrderTransition` history mirroring
  ServiceRequest's pattern. Accepting a quote auto-creates the order (idempotent).
- ✅ **7.2 Live Orders page for real.** Replace the hardcoded `/orders` arrays with the
  order pipeline: stage columns with counts/values from real aggregates, stage-move actions
  (PATCH with transition history), and the detail panel fed by the real quote/contact.
  Remove its Preview banner.
- ✅ **7.3 Command Centre for real.** Manufacturing dashboard KPIs from live aggregates:
  open orders by stage, order value in production, quotes awaiting decision (sent), material
  reorder alerts (inventory status), waste ratio (yield endpoint). Remove its Preview banner.
- ✅ **7.4 Client Intelligence for real.** `/customers` for mfg tenants from real CRM data:
  per-company/contact totals (accepted-quote value, open orders, last order date, days since
  last order) with the existing at-risk framing driven by real recency. Remove its badge.
- ✅ **7.5 Material consumption hook.** Moving an order into `production` logs planned
  material usage (from the quote's inventory-linked lines' computedQty) as ledger `used`
  movements — closing the loop the yield page reports on. Config-gated
  (`autoDeductMaterials` tenant setting, default off) so shops that track manually keep
  control.
- ◐ **7.6 Tests + seed.** _(order lifecycle/consumption/intel tests done; demo-order seed deferred — the pipeline fills organically from accepted quotes)_ Order lifecycle (accept → order, stage transitions, idempotency),
  dashboard aggregates, consumption hook; extend `seed-tempus.ts` so the demo tenant shows
  a living pipeline.

**Acceptance:** a manufacturing tenant sees zero Preview badges on dashboard/orders/
customers; every number on those pages traces to a DB row; accepting a quote flows into
production tracking and (optionally) material consumption.

---

## Phase 8 — Campaigns launch-hardening (~2–3 days)

The voice/multi-channel campaign engine is feature-complete but pre-launch compliance items
are open (tracked in `docs/voice-agent-status.md` Phases 11–12).

- ✅ **8.1 GDPR/DPDP erasure endpoint.** `DELETE /campaigns/leads/:id/erasure` (and a
  by-phone variant): hard-delete or crypto-shred the lead's PII across CampaignLead,
  CallRecord transcripts, WhatsApp messages, MessageDelivery bodies; keep aggregate counters.
  Audit-logged, admin-permission gated.
- ✅ **8.2 DND enforcement completion.** _(verified already enforced in dispatch: DoNotContact for phone channels, EmailSuppression for email, skip reasons recorded on MessageDelivery and covered by dispatch tests)_ TRAI DND scrub is fail-closed for +91 voice; finish
  the enforcement path for WhatsApp/email channels (suppression checks at dispatch) and
  surface skip reasons in the campaign UI.
- ✅ **8.3 Live-key validation.** "Test connection" actions for Vapi/Twilio/Interakt/Resend
  connector configs (cheap authenticated ping per provider) so a tenant knows a key works
  before launching a campaign.
- ✅ **8.4 Campaign demo seed.** Deterministic seed for a demo campaign (leads, calls,
  outcomes, sentiment, A/B arms) so the analytics surfaces demo well without live keys.

**Acceptance:** a lead can be verifiably erased end-to-end; no channel can contact a
suppressed/DND number; a misconfigured key is caught before launch, not during it.

---

## Phase 9 — Auth factor for token issuance (C1 — unpark before wider exposure)

Parked by explicit decision, listed here so it has a home in the sequence. The web tier
already authenticates users with Clerk; the API's `/auth/token` should stop accepting
bare email+role.

- ✅ **9.1 Service-secret binding.** Require `EYNIS_TOKEN_EXCHANGE_SECRET` (shared web↔API
  secret header) on `POST /auth/token` in production — only the web tier, which has already
  verified the user via Clerk, can mint tenant JWTs. Startup-asserted like the other prod
  secrets; dev unchanged.
- ✅ **9.2 Trim `/auth/identify`.** Return only what the web tier needs post-Clerk-auth;
  move it behind the same service secret so it stops being a public tenantId/roleKey oracle.
- ✅ **9.3 Matrix coverage.** _(dedicated token-exchange test: 401 without/with-wrong secret, 200 with it, dev-open, prod startup assertion)_ Extend the authz-matrix test to prove both endpoints reject
  callers without the service secret in production mode.

**Acceptance:** possessing an email address no longer yields a tenant JWT from the public
internet; only the Clerk-authenticated web tier can exchange identities for tokens.

---

## Phase 10 — Feedback- and scale-gated (build when the trigger fires)

- ☐ **10.1 Quote versioning** _(trigger: pilot asks to revise sent quotes)_ — revision
  chain (`supersedesQuoteId`, vN numbering), re-quote action from a decided quote, history
  in the read-only view.
- ☐ **10.2 Redis rate-limit adapter** _(trigger: second API instance)_ — implement
  `RateLimitStore` against Redis; one `setRateLimitStore()` call at startup; no call-site
  changes (interface shipped in Phase 2/5).
- ☐ **10.3 Remaining server.ts slimming** _(opportunistic)_ — auth/tenant/team, AI,
  night-audit, and connector handlers can follow the established router recipe whenever
  they're next touched; no urgency, the authz matrix covers them either way.

---

## Suggested execution order

| Order | Phase | Why now | Rough size |
|---|---|---|---|
| 1 | Phase 6 — self-serve quote link | Highest pilot value; closes the revenue loop Phases 1/4 built | 2–3 days |
| 2 | Phase 7 — real manufacturing vertical | Biggest demo/sales impact; converts industry-agnostic from config-deep to demonstrable | ~1 week |
| 3 | Phase 8 — campaigns launch-hardening | Compliance debt to clear before real outbound volume | 2–3 days |
| 4 | Phase 9 — C1 auth factor | Must land before exposure beyond a controlled pilot | 1–2 days |
| 5 | Phase 10 — versioning / Redis / slimming | Each waits for its trigger | per item |
