# Improvement Plan — July 2026 (post Phases 1–4)

**Source:** in-depth project state review of 2026-07-12 (build/lint/418 API tests green at
`44f783c`). This plan sequences every improvement that review found **except C1**
(passwordless `/auth/token` + `/auth/identify` disclosure), which is consciously parked as a
separate decision.

Ordering principle: correctness with financial impact first, then production security
defaults, then customer-visible honesty/white-label polish, then data-model precision, then
structural refactors, with docs hygiene as a cheap opener. Each phase is independently
shippable and keeps the suite green.

**Status legend:** ☐ pending · ◐ in progress · ✅ done

---

## Phase 0 — Docs hygiene (quick win, ~half a day)

Cheap, zero-risk, and stops the docs from actively misleading contributors.

- ✅ **0.1** Update stale "not yet built" headers on shipped designs:
  `docs/research-studio-design.md`, `docs/email-deliverability-design.md` (suppression,
  sending domains, Resend webhook all exist), `docs/industry-agnostic-and-white-label-plan.md`.
- ✅ **0.2** Fix `CLAUDE.md` drift: `server.ts` is ~6,900 lines (not ~2,400); connector list
  is larger than six (BUSY, Tavily search, etc.).
- ✅ **0.3** Mark `docs/daily-context/` as historical (banner in `index.md`); it ends at
  day-19 (2026-05-13) and every "pending item" there has since shipped.

**Acceptance:** no doc claims a shipped feature is unbuilt; CLAUDE.md figures match reality.

---

## Phase 1 — Quote lifecycle correctness (financial impact — do first)

The costing math is solid; the state machine around it is not. These are the only known
defects that can silently corrupt money-bearing records.

- ✅ **1.1 Formal state machine.** One transition table for `draft → sent → accepted |
  rejected | expired`, enforced in `core/quotes/service.ts` and used by every route
  (`server.ts:4491–4560`) instead of each route hand-checking a subset. Specifically block:
  accept from `draft` (never sent), accept from `rejected`/`expired`, reject after `accepted`.
- ✅ **1.2 Accept guards.** Require `hasLines` (and total > 0) on accept, mirroring the
  existing send guard — today an empty quote passes the margin floor vacuously and commits
  `deal.value = 0`.
- ✅ **1.3 Deal-value integrity.** If a reject-after-accept path is ever allowed (e.g. an
  explicit "revert acceptance" action), it must revert the `deal.value` that accept
  committed. With 1.1 blocking the transition, add a regression test proving the deal value
  survives a rejected reject attempt.
- ✅ **1.4 Quote numbering.** Replace `count + 1` (`service.ts:191–194`) with
  `max(number) + 1` per tenant inside a retry-on-`P2002` loop (or a per-tenant sequence).
  Fixes delete-then-create collisions and concurrent-create races; surface a clear error
  instead of a generic 400.
- ✅ **1.5 Automated expiry.** Sweep `validUntil < now()` quotes in `sent` to `expired` from
  the automation engine tick (record-first idempotency like the other rules).
- ✅ **1.6 UI alignment.** Quotes client: remove "Accept" from drafts, add reject/expire
  actions, and add a read-only detail view for sent/accepted quotes
  (`apps/web/components/ui/quotes-client.tsx`).
- ✅ **1.7 Tests** for every guard above: accept-from-draft 409, accept-empty 422,
  reject-accepted 409, numbering collision after delete, concurrent create, expiry sweep.

**Acceptance:** no reachable transition outside the table; deal values cannot be zeroed or
orphaned by quote actions; numbering survives delete + concurrency; suite green.

---

## Phase 2 — Production-hardening defaults (security posture)

The primitives (AES-GCM secrets, HMAC webhook verification, invite-token hashing) are built
and tested — but a default production deploy can silently run without them.

- ✅ **2.1 Startup assertions in production** (mirror the existing `JWT_SECRET` assertion in
  `core/auth.ts:32`): fail startup when `NODE_ENV=production` and `SECRETS_ENC_KEY` is unset;
  loudly warn (or fail, config-gated) when webhook verification is off.
- ✅ **2.2 Enforce-when-configured webhooks.** Verify Twilio/Interakt signatures whenever the
  corresponding secret/config exists, regardless of `VERIFY_WEBHOOKS`; keep the flag only as
  a dev escape hatch. (This was the original H3 recommendation; the crypto is already
  functional in `core/connectors/webhook-verify.ts`.)
- ✅ **2.3 Defensive tenant scoping in workers.** Add `tenantId` to the `where` of
  by-ID lookups on worker paths (`core/research/engine.ts:53`,
  `core/campaigns/worker.ts:122/158`, `whatsapp-agent.ts:136`, `quotes/followup.ts:29–35`)
  so a stray ID from an untrusted boundary can never read cross-tenant.
- ✅ **2.4 Rate limiter honesty.** Document the single-process limitation at the deploy
  layer; add a pluggable store interface so a Redis adapter can drop in before any
  multi-instance deployment (adapter itself can wait until scaling is real).

**Acceptance:** a misconfigured prod deploy fails fast instead of running soft; signed
webhooks are enforced wherever a secret exists; worker queries are tenant-pinned.

---

## Phase 3 — Honest UI + white-label polish (pilot-facing trust)

Everything a pilot customer can see and lose trust over.

- ✅ **3.1 Kill fabricated dashboard fallbacks.** `app/dashboard/page.tsx:49–57` substitutes
  fake KPIs (`openCount ?? 4`, hardcoded chart dates) on empty/error — replace with honest
  zeroed/empty states like the analytics helpers already do.
- ✅ **3.2 Fix white-label leaks:** "Eynis Does" label on the tenant-facing automations page
  (`app/automations/page.tsx:100`), "Eynis AI Brain" wordmark (`app/ai-brain/page.tsx:63`),
  and first-paint `metadata.title: "Eynis Platform"` (`app/layout.tsx:15`) — all must resolve
  from tenant branding with the standard fallback chain.
- ✅ **3.3 Badge demo surfaces.** The non-hospitality vertical pages (`orders`, `menu`,
  `bookings`, `patients`, `appointments`, mock dashboards/analytics, customers intelligence)
  render hardcoded data with no signposting. Add the same "Preview" treatment AI Brain has,
  driven by one shared component, until each vertical is wired for real.
- ✅ **3.4 Consistent fetch degradation.** Bring the bare `res.json()` fetchers in
  `apps/web/lib/data.ts` (`fetchGuests`, `fetchAutomations`, `fetchConnectorRegistry`,
  `fetchInventory`, `fetchTeamUsers/Roles/License`, `fetchCampaigns`, `fetchSegments`,
  `fetchSequences`, `fetchTemplates`, `fetchPipelines`, `fetchDeals`, `fetchForecast`) up to
  the graceful-empty pattern (check `res.ok`, catch, return typed empty shape) so a 500
  shows an empty state, not an error boundary.
- ✅ **3.5 Server-side route gating.** Industry- and RBAC-gating is client-nav-only; add a
  server-side industry/permission check on vertical-specific routes (`night-audit`,
  `guest-database`, `revenue-intelligence`, `queue`, vertical ops pages) that redirects or
  404s instead of rendering wrong-industry content to a typed URL.
- ✅ **3.6 Neutralize public intake.** `app/request/page.tsx` is hotel-hardcoded
  (`guestName`, "room 204" placeholder, `?hotelId=`); parameterize copy/fields from
  `industry-config` terminology.

**Acceptance:** no fabricated numbers anywhere; no "Eynis" strings reachable by a branded
tenant; every mock surface is visibly a preview; wrong-industry URLs don't render.

---

## Phase 4 — Inventory precision + ledger (unblocks real material costing)

- ☐ **4.1 Paise-precision costs.** Migrate `InventoryItem.unitCostInr` (Int, whole rupees —
  `schema.prisma:86–89`) to a paise integer (`unitCostPaise`), aligning with the quote
  engine; keep a compatibility read path during migration. Fixes the sub-rupee rate gap in
  `snapshotRatePaise` (`quotes/service.ts:205`).
- ☐ **4.2 Stock-movement ledger.** Add a `StockMovement` table (tenantId, itemId, kind
  `received|used|waste|adjustment`, qty, ref, actor, timestamp); `applyMovement` writes the
  ledger row and derives `stock` — today `used` and `waste` are indistinguishable and stock
  history is unreconstructable.
- ☐ **4.3 Real yield analytics.** Make "Material Yield" earn its name: material consumed per
  accepted quote (join ledger → quote lines), waste ratio, reorder forecasting. Until then
  the page is a relabeled inventory table.
- ☐ **4.4 DRY the GST formula** (same computation in `quotes/service.ts:150`, `:637`, and
  `connectors/busy.ts:111`) into one helper; add the missing test asserting BUSY XML
  `GSTAmount`/`GrandTotal`, and emit a computed GST column in the BUSY CSV.

**Acceptance:** sub-rupee rates representable end-to-end; every stock change has a ledger
row; yield page shows computed consumption, not a renamed list.

---

## Phase 5 — Structural refactor + coverage (maintainability ceiling)

Largest effort, no user-visible change — schedule after the pilot-facing phases.

- ☐ **5.1 Extract per-domain routers** out of the 6,900-line `server.ts` if/else chain
  (quotes, crm, research, reports, campaigns, connectors, auth/tenant, admin), keeping the
  no-framework `node:http` approach but with a small shared route-table dispatcher.
  Incremental: one domain per PR, `buildServer()` contract and tests unchanged.
- ☐ **5.2 Make `permissionMap` authoritative.** Fold the ~30 reports/research handlers that
  authorize inline (`server.ts:3335–3907`) into the map, and remove the redundant double
  `authorize()`+`hasPermission` checks left from the partial migration — one table should
  answer "what permission does this route need" for the entire surface.
- ☐ **5.3 Authorization-matrix test.** A generated test that walks `permissionMap` and
  asserts each route rejects unauthenticated and under-permissioned callers — turns the map
  into an enforced contract and closes the route-level coverage gap cheaply.
- ☐ **5.4 Shrink the `as any` boundary** (~104 casts, mostly at `parseBody`): introduce a
  tiny validation helper for request bodies on the money-bearing routes first (quotes, CRM).
- ☐ **5.5 Redis rate-limit adapter** (interface from 2.4) — required before any
  multi-instance deploy; also stop trusting first-hop `x-forwarded-for` outside the known
  proxy.

**Acceptance:** `server.ts` reduced to bootstrap + dispatch; one authz source of truth with
a matrix test proving it; suite green after every extraction PR.

---

## Phase 6 — Product depth (decision-gated, not defects)

Items that need a product call before engineering effort:

- ☐ **6.1 Customer self-serve quote link.** Today "customer link" = linked Contact; there is
  no public view/accept URL — staff mark acceptance manually. If built: signed single-quote
  token URL, view + accept/decline only, rate-limited, no tenant enumeration; reuse the
  hashed-token pattern from invites.
- ☐ **6.2 Wire one non-hospitality vertical for real** — manufacturing is the natural pick
  (it already has real quotes/materials/CRM; its mock surfaces are the dashboard, live
  orders, and client intelligence). This converts the industry-agnostic story from skin-deep
  to demonstrable.
- ☐ **6.3 Quote versioning** (revision history instead of re-quote-as-new) — only if pilot
  feedback asks for it.
- ☐ **6.4 Campaigns launch-hardening** already tracked in `voice-agent-status.md`: GDPR
  erasure endpoint + DND enforcement (Phase 11), demo seed + live-key validation (Phase 12).

---

## Suggested execution order

| Order | Phase | Why now | Rough size |
|---|---|---|---|
| 1 | Phase 0 | Zero risk, stops doc drift compounding | 0.5 day |
| 2 | Phase 1 | Only known money-corrupting defects | 1–2 days |
| 3 | Phase 2 | Makes shipped hardening actually apply in prod | 1 day |
| 4 | Phase 3 | Pilot-customer trust; all shallow changes | 2–3 days |
| 5 | Phase 4 | Unblocks real material costing accuracy | 2 days |
| 6 | Phase 5 | Structural; safest after pilot-facing work lands | 1–2 weeks, incremental |
| 7 | Phase 6 | Needs product decisions first | per decision |

Parked deliberately: **C1** (auth factor on `/auth/token`, `/auth/identify` disclosure) —
tracked in `docs/project-review-2026-07.md`; revisit before any non-pilot exposure.
