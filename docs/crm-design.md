# Eynis CRM — Market Research & Build Plan

> Status: **Proposal / design doc** (June 2026). No code changes yet — this is the plan we
> review before building. Read alongside `docs/product-vision.md`,
> `docs/industry-agnostic-and-white-label-plan.md`, and `CLAUDE.md` (Product Principles).

## TL;DR

Eynis already ships campaigns, leads, segments, drip sequences, templates, two-way WhatsApp
threads, sentiment, consent/DNC compliance, and a Claude/OpenAI AI layer. That is roughly
**60% of a CRM** — but it has no *spine*. Lead data is trapped per-campaign, there is no single
persistent person record, no companies, no deals/pipeline, and no unified activity timeline.

The plan: add the **connective tissue** of a CRM — a tenant-wide **Contact** hub, optional
**Company** accounts, a **Pipeline → Stage → Deal** model, and a **unified Activity timeline** —
and wire our *existing* campaigns/sequences/AI into it rather than building a parallel stack.
This turns Eynis from "an ops + outbound-messaging platform" into "an operations platform with a
native, AI-first, conversational CRM," fully industry-agnostic and white-label by default.

---

## 1. Why now

Campaigns gave us the *outbound* motion (reach a list, dial/message them, track outcomes). But a
campaign is a point-in-time blast. What customers ask for next is always the same: *"Where is this
relationship now? What did we last say to them? What's it worth? What do I do next?"* That is the
CRM job, and it is the natural complement to campaigns. Without it:

- A lead exists only inside the campaign that imported it; the same person across two campaigns is
  two unrelated rows.
- There's no place to record a manual call, a note, a follow-up task, or a deal value.
- We can't show "lifetime relationship" or pipeline/forecast — the questions buyers evaluate CRMs on.

A native CRM closes the loop: **inbound (connectors) → enrich/route → CRM record → outbound
(campaigns/sequences) → activity timeline → AI next-best-action → repeat.**

---

## 2. Market research — what "best in class" looks like

### 2.1 The four archetypes (and where Eynis should sit)

| CRM | Strength | Who it's for | Lesson for Eynis |
|---|---|---|---|
| **Salesforce** | Infinite customization, enterprise | Large orgs with admins | Don't chase this — complexity is the anti-feature for our SMB/mid-market, multi-industry base |
| **HubSpot** | Integrated sales+marketing+service, best free tier, 9-channel messaging incl. WhatsApp | SMB→mid-market all-in-one | **Closest model.** One object graph spanning marketing + service is exactly our shape |
| **Zoho** | Broadest feature coverage per dollar | Cost-sensitive all-in-one | Validates "do a lot in one suite cheaply" — but UX suffers; we win on focus + AI |
| **Pipedrive** | Best visual drag-drop pipeline, dead simple | Sales-only teams who want speed | **Steal the pipeline UX.** Simplicity is a feature; our pipeline must feel this clean |

**Positioning for Eynis:** a HubSpot-shaped object graph with Pipedrive-grade pipeline simplicity,
delivered industry-agnostic and white-label, with **conversational + agentic AI as the default**,
not a paid add-on. Our unfair advantage is that the messaging channel (WhatsApp/voice/email) and the
AI brain are already *inside* the platform — most CRMs bolt these on.

### 2.2 The universal CRM object model

Every serious CRM is built on the same handful of objects. This is the canonical shape we adopt:

- **Contact** — an individual person. The hub. Everything associates back to a Contact.
- **Company / Account** — the organization a Contact belongs to (B2B). Optional for B2C tenants.
- **Deal / Opportunity** — an active revenue motion with a value, close date, and a **pipeline stage**.
- **Pipeline → Stage** — a configurable funnel; each stage carries a **win probability** for forecasting.
- **Activity / Task / Note** — the timeline: calls, messages, meetings, notes, to-dos with due dates.
- **Ticket** — a support/service case (Eynis already has this as `ServiceRequest`).

Three *stage* concepts are routinely conflated; we keep them distinct (HubSpot's model):

| Concept | Lives on | Example values | Purpose |
|---|---|---|---|
| **Lifecycle stage** | Contact | Subscriber → Lead → MQL → SQL → Opportunity → Customer | Overall relationship maturity |
| **Lead status** | Contact/Lead | New → Attempting → Connected → Qualified → Disqualified | Working state of an unconverted lead |
| **Deal stage** | Deal | (per-pipeline, e.g. Discovery → Proposal → Won/Lost) | One specific opportunity's progress |

### 2.3 What modern (2026) CRMs differentiate on — AI

The market has moved from "CRM with an AI feature" to **agentic AI as the core**: 80%+ of companies
are expected to use AI-powered CRMs in 2026. The differentiators buyers now look for:

- **Lead/contact scoring** on *fit + intent* signals, auto-updated.
- **Next-best-action** recommendations and auto-drafted outreach.
- **Auto-enrichment** of records from interactions.
- **Conversational CRM** — chat/WhatsApp/voice/email threads feed one shared context and land
  directly on the contact timeline, regardless of channel.

This is precisely where Eynis already has assets: `classifyInboundEvent`, `generateGuestIntelligence`
(a lead-scoring primitive — returns a `vipScore`), live WhatsApp threads with per-message sentiment,
and a dual-provider (Claude + OpenAI) abstraction. We should make AILead scoring + next-best-action
a *default*, not a tier.

> Sources: Salesflare CRM comparison; HubSpot CRM developer docs (objects/associations/pipelines);
> HubSpot knowledge base (lifecycle vs lead status vs deal stage); monday.com & Pipeline CRM
> 2026 buyer guides; AIMultiple / Hal Simplify / CX Today on 2026 agentic-CRM trends.

---

## 3. Where Eynis stands today (inventory)

**Already built (reuse, don't rebuild):**

| Capability | Model(s) | Notes |
|---|---|---|
| Rich lead records | `CampaignLead` | firstName/lastName/email/phone/company/jobTitle/tags/status/consent — but **campaign-scoped** |
| Multi-channel campaigns | `VoiceCampaign` | voice (Vapi) / WhatsApp (Twilio/Interakt) / email (Resend), send windows, A/B |
| Saved audiences | `LeadSegment` | rule DSL (status, tags, company, jobTitle, consent, search) |
| Drip automation | `Sequence`, `SequenceStep`, `SequenceEnrollment`, `SequenceEvent` | multi-step delayed sends |
| Template library | `MessageTemplate` | WhatsApp Meta-approval lifecycle + email |
| Two-way conversations | `WhatsappConversation`, `WhatsappMessage` | state machine + per-message sentiment |
| Call outcomes | `CallRecord`, `SentimentEvent` | transcript, AI summary, sentiment, key points |
| Compliance | `DoNotContact`, `EmailSuppression`, `AuditLog` | tenant-wide, durable |
| Service cases ("tickets") | `ServiceRequest` (+ transitions, SLA) | the support side of CRM already exists |
| Minimal person record | `Contact` (table `Guest`) | only fullName/phoneE164/visitCount + stays; hospitality-shaped |
| AI layer | `core/ai/intelligence.ts` | `classifyInboundEvent`, `generateGuestIntelligence` (scoring), revenue/briefing |

**Missing (the CRM spine we need to add):**

1. **No persistent, tenant-wide Contact hub** linked to leads — `Contact` (Guest) and `CampaignLead`
   are two disconnected worlds.
2. **No Company / Account** object.
3. **No Deal / Opportunity / Pipeline / Stage** — no forecasting, no "where is this going."
4. **No unified Activity / Task / Note timeline** — no place for manual calls, notes, to-dos.
5. **No lifecycle stage / owner / stored lead score** on the person record.
6. **No custom fields** (only an untyped `rawData` JSON blob on leads).
7. **No contact-level segments** (segments are campaign/lead-scoped only).

---

## 4. Design principles (non-negotiable)

Per `CLAUDE.md`:

- **Industry-agnostic.** Neutral domain language everywhere: *Contact, Company, Deal, Pipeline,
  Activity* — never *guest/hotel/booking* in new CRM code/copy. Keep DB tables mapped via Prisma
  `@@map`/`@map` where we extend existing ones (e.g. `Contact` → `Guest`) so there's no data migration.
- **White-label by default.** Pipeline names, stages, lifecycle labels, custom fields are all
  **per-tenant configurable**. No "Eynis" branding leaks into CRM output.
- **Multi-tenant isolation.** Every new model carries `tenantId`; every query scoped to the JWT's
  `tenantId`; new routes registered in `policyMap` with a `manage_crm`-style permission.
- **Build on, not parallel to.** Reuse Segments, Sequences, Templates, the AI layer, DNC/suppression,
  and the existing `node:http` route/`authorize`/`json` conventions in `server.ts`.

---

## 5. Proposed data model

The big architectural decision: **promote a tenant-wide `Contact` to the hub**, and make
`CampaignLead` *roll up* to it (many campaign touches → one durable person). This matches HubSpot's
model and unifies our two-worlds problem.

```
Company (optional, B2B)
  └─ Contact[]  ← THE HUB (extends existing Contact/Guest, industry-neutral)
       ├─ Deal[]            (pipeline opportunities)
       ├─ Activity[]        (unified timeline: call/email/whatsapp/note/task/meeting/system)
       ├─ CampaignLead[]    (existing — link each lead to its Contact)
       ├─ ServiceRequest[]  (existing — already a "ticket")
       └─ Stay[]            (existing hospitality relation, untouched)

Pipeline ─< Stage ─< Deal   (per-tenant configurable funnels with win probability)
```

### 5.1 Extend `Contact` (the hub) — additive columns on the `Guest` table

```prisma
model Contact {
  // ...existing: id, tenantId(@map hotelId), fullName, phoneE164, visitCount, stays, serviceRequests
  email          String?
  companyId      String?
  ownerId        String?          // assigned User
  lifecycleStage String   @default("lead")   // lead|mql|sql|opportunity|customer|...(tenant-configurable)
  leadStatus     String?                       // new|attempting|connected|qualified|disqualified
  leadScore      Int?                          // AI/rules-derived
  source         String?                       // where they came from (connector, campaign, manual, import)
  tags           String[]                      @default([])
  customFields   Json?                          // tenant-defined typed fields (see 5.5)
  lastActivityAt DateTime?
  company        Company?  @relation(...)
  owner          User?     @relation(...)
  deals          Deal[]
  activities     Activity[]
  campaignLeads  CampaignLead[]                 // backlink; add contactId to CampaignLead
}
```

### 5.2 `Company` (account) — new, B2B-optional

```prisma
model Company {
  id, tenantId, name, domain?, industry?, size?, ownerId?, tags[], customFields Json?
  contacts Contact[]
  deals    Deal[]
}
```

### 5.3 `Pipeline` + `Stage` — per-tenant configurable

```prisma
model Pipeline { id, tenantId, name, isDefault, archived, stages Stage[] }
model Stage    { id, tenantId, pipelineId, name, order, probability Int /*0-100*/, isWon, isLost }
```

Seed a sensible default pipeline per tenant (Lead In → Qualified → Proposal → Negotiation →
Won/Lost) but let tenants rename/reorder. White-label requirement.

### 5.4 `Deal` + `Activity` — the value + the timeline

```prisma
model Deal {
  id, tenantId, contactId?, companyId?, ownerId?, pipelineId, stageId
  title, value Decimal?, currency, expectedCloseAt?, status open|won|lost, closedAt?, lostReason?
  source?, createdAt, updatedAt
  activities Activity[]
}

model Activity {
  id, tenantId, contactId?, dealId?, companyId?, userId? (actor)
  type   call|email|whatsapp|sms|voice|note|task|meeting|stage_change|system
  title, body?, direction inbound|outbound|null
  dueAt?, completedAt?, status (for tasks: open|done)
  meta Json?   // links to CallRecord / WhatsappMessage / MessageDelivery / campaign, sentiment, etc.
  createdAt
}
```

`Activity` is the heart of "conversational CRM": every existing event (a `CallRecord`, a
`WhatsappMessage`, a campaign `MessageDelivery`, a `ConnectorEvent`) can **project into** an
`Activity` row on the contact's timeline — so the rep sees one chronological story across channels.

### 5.5 Custom fields & contact segments

- **Custom fields:** start with a `customFields Json` column governed by a per-tenant
  `CustomFieldDefinition` table (key, label, type: text/number/date/select, options, objectType).
  Avoids schema churn; gives white-label flexibility. (Typed columns can come later if needed.)
- **Contact segments:** generalize the existing `LeadSegment` rule DSL to also target `Contact`
  (add `objectType` to the segment, extend the rule compiler in `core/campaigns/segments.ts`).

---

## 6. Key architecture decisions (recommend + alternatives)

| # | Decision | Recommendation | Alternative / trade-off |
|---|---|---|---|
| D1 | Where does the canonical person live? | **Extend `Contact` (Guest table) as the hub**; link `CampaignLead.contactId` to it | Make `CampaignLead` the hub — rejected: it's campaign-scoped and would entrench that limitation |
| D2 | How do leads relate to contacts? | On lead import, **upsert a Contact by (tenantId, phone/email)** and link; dedupe across campaigns | Keep them separate — rejected: that's the core gap we're fixing |
| D3 | Custom fields storage | **JSON + definition table** first | Typed columns / EAV — more rigid / more complex; defer |
| D4 | Activity timeline | **One polymorphic `Activity` table**, project existing events into it | Separate tables per type — harder to render a unified timeline |
| D5 | Pipelines | **Configurable per tenant**, seed a default | Hard-coded stages — violates white-label principle |
| D6 | AI scoring | **Reuse/extend `generateGuestIntelligence`** into a neutral `scoreContact()` returning 0–100 + reasons | New bespoke model — wasteful; we already have the primitive |
| D7 | Permissions | New `manage_crm` (+ maybe `view_crm`) permission keys in `policyMap`/`Role` | Reuse `manage_campaigns` — too coarse |

---

## 7. AI differentiation (our moat)

Make these *default*, powered by the existing dual-provider layer:

1. **Contact/lead scoring** — `scoreContact(history)` → 0–100 + top reasons, recomputed on new
   activity. Generalize `generateGuestIntelligence` (already returns a `vipScore`) to neutral output.
2. **Next-best-action** — per contact/deal, suggest the action + draft the message (reusing
   `MessageTemplate` + `classifyInboundEvent` semantics). Surface on the record and the dashboard.
3. **Conversational capture** — inbound WhatsApp/voice/connector events auto-create/enrich a Contact
   and drop an `Activity` on the timeline (extends `core/connectors/ingest.ts`, which already upserts
   a Contact and creates a `ServiceRequest`).
4. **Auto-summary** — roll a contact's timeline into a one-paragraph "relationship brief" on open.

---

## 8. Phased roadmap

Each phase is independently shippable and demoable. Follows the build → test → self-review → validate
→ push principle (`docs/engineering-principles.md`).

### Phase 0 — Foundation: unify the Contact (1 spine, no new surface)
- Migration: additive columns on `Contact` (email, owner, lifecycle, score, tags, customFields, …);
  add `Company`; add `CampaignLead.contactId`.
- Backfill: upsert Contacts from existing `CampaignLead`s by phone/email; link them.
- Update lead import to upsert+link Contacts.
- **Outcome:** one durable person record; leads roll up. No UI change required yet.

### Phase 1 — Contacts & Companies UI (the hub people can see)
- API: `GET/POST/PATCH /contacts`, `/contacts/:id` (with timeline), `/companies`.
- Generalize segments to `Contact`.
- Web: a `/contacts` (industry-neutral) list + detail page with timeline; `/companies`.
  Slot into `industry-config.ts` nav (reuse the existing `Users`/`Database` icons).
- **Outcome:** "single customer view" — the #1 thing buyers expect.

### Phase 2 — Pipelines & Deals (the revenue story)
- API + models: `Pipeline`, `Stage`, `Deal`; routes for CRUD + stage moves; seed default pipeline.
- Web: Pipedrive-style **drag-drop board** (`/deals` or `/pipeline`) + deal detail; forecast roll-up.
- **Outcome:** forecasting + "where is this going" — the headline CRM feature.

### Phase 3 — Activities, Tasks & unified timeline
- `Activity` model; project `CallRecord` / `WhatsappMessage` / `MessageDelivery` / `ConnectorEvent`
  into it. Manual notes + tasks with due dates and reminders (reuse the automation engine for nudges).
- Web: timeline component on Contact/Deal; a "My tasks" view.
- **Outcome:** the daily-driver surface reps live in; nothing falls through the cracks.

### Phase 4 — AI layer & automation polish
- `scoreContact`, next-best-action, relationship auto-summary surfaced in UI.
- CRM-aware automations (stage-change → task/sequence; score threshold → owner alert) on the existing
  `core/automations/engine.ts`.
- Reporting: pipeline velocity, win rate, source attribution.
- **Outcome:** the agentic-CRM differentiator that wins 2026 deals.

---

## 9. UI / navigation plan

Add CRM entries to each industry's `navItems` in `apps/web/lib/industry-config.ts`, using neutral
labels and existing lucide icons:

```
Contacts   (Users / UserCheck)
Companies  (Building2)         ← show only for tenants that enable B2B/accounts
Deals      (TrendingUp / BarChart3)
Tasks      (ClipboardList)
```

Gate visibility with the new `view_crm` permission via the existing `getAllowedNavItems()` /
`canAccessRoute()` flow. Keep pages as server components with `force-dynamic`, fetching through
`apps/web/lib/data.ts` (no direct DB access), consistent with the rest of the web app.

---

## 10. Risks & open questions (for the team)

1. **B2B vs B2C default.** Do we expose `Company` to everyone, or only when a tenant enables
   "accounts"? (Recommendation: ship it, hide nav unless enabled.)
2. **Contact dedupe key.** Phone is reliable (E.164) and present everywhere; email is optional. Merge
   strategy when both partially match? (Recommendation: phone primary, email secondary, manual-merge UI later.)
3. **Naming the canonical record.** We've been using `Contact` (neutral) ↔ `Guest` table. Confirm we
   keep that mapping and don't introduce a separate "Lead" object — leads become Contacts with
   `lifecycleStage=lead`.
4. **Scope of v1.** Is the goal a *sales* CRM (deals/pipeline-first) or a *relationship/ops* CRM
   (contacts/timeline-first)? This reorders Phase 1 vs Phase 2.
5. **Migration safety.** All Phase 0 changes are additive; backfill must be idempotent and tenant-scoped.

---

## 11. Recommendation

Build the CRM as the **spine that connects what we already have**. Lead with a HubSpot-shaped object
graph, deliver a Pipedrive-clean pipeline, and make AI scoring + next-best-action the default. Keep
every label, stage, and field per-tenant configurable so it stays industry-agnostic and white-label —
consistent with Eynis's core principles.

> **Decision (finalized, June 2026):** a pilot customer is asking for **pipeline + forecasting now**,
> so the open question in §10.4 is resolved in favor of a **deals/pipeline-first** sequence. The
> default ops-first ordering in §8 is therefore superseded by the **finalized build plan in §12**.
> Deals attach to the *existing* `Contact` (Guest) record optionally and can stand alone, so we ship
> pipeline/forecasting first and do the full Contact/Company unification in the next increment.

---

## 12. Finalized build plan (pipeline-first)

Goal: ship **Deals + Pipeline + Forecasting** to the requesting pilot fast, on a foundation that the
rest of the CRM (contacts hub, activities, AI) cleanly extends — no throwaway work, no refactor debt.

### 12.1 Sequencing (three increments, each a separate PR)

| Inc | Title | Ships | Depends on |
|---|---|---|---|
| **A** | **Pipeline + Deals + Forecasting** (the pilot ask) | Pipeline/Stage/Deal models, default-pipeline seed, CRUD + stage-move APIs, drag-drop board, forecast summary | — |
| **B** | **Contacts hub + Companies** | Extend `Contact`, add `Company`, link `Deal`/`CampaignLead` → Contact, backfill, contact detail + deal roll-up | Inc A |
| **C** | **Activities timeline + AI** | `Activity` projection, lead/deal scoring, next-best-action, velocity/win-rate reporting | Inc B |

Increment A is the deliverable for the pilot. B and C follow without reworking A.

### 12.2 Data model — Increment A (final)

New tables (these are *new*, so use a real `tenantId` column — the `@map("hotelId")` shim is only for
legacy tables). All carry `tenantId` and are scoped on every query.

```prisma
model Pipeline {
  id        String   @id @default(cuid())
  tenantId  String
  name      String
  isDefault Boolean  @default(false)
  archived  Boolean  @default(false)
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
  tenant    Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  stages    Stage[]
  deals     Deal[]
  @@index([tenantId])
}

model Stage {
  id          String  @id @default(cuid())
  tenantId    String
  pipelineId  String
  name        String
  order       Int
  probability Int     @default(0)   // 0–100, drives weighted forecast
  isWon       Boolean @default(false)
  isLost      Boolean @default(false)
  pipeline    Pipeline @relation(fields: [pipelineId], references: [id], onDelete: Cascade)
  deals       Deal[]
  @@index([tenantId]) @@index([pipelineId])
}

model Deal {
  id              String    @id @default(cuid())
  tenantId        String
  title           String
  value           Decimal?  @db.Decimal(14, 2)
  currency        String    @default("USD")    // tenant default; white-label configurable later
  pipelineId      String
  stageId         String
  contactId       String?                       // optional link to existing Contact (Guest table)
  ownerId         String?                       // assigned User
  status          String    @default("open")    // open | won | lost
  expectedCloseAt DateTime?
  closedAt        DateTime?
  lostReason      String?
  source          String?                       // manual | campaign | connector | import
  createdAt       DateTime  @default(now())
  updatedAt       DateTime  @updatedAt
  tenant          Tenant    @relation(fields: [tenantId], references: [id], onDelete: Cascade)
  pipeline        Pipeline  @relation(fields: [pipelineId], references: [id])
  stage           Stage     @relation(fields: [stageId], references: [id])
  contact         Contact?  @relation(fields: [contactId], references: [id], onDelete: SetNull)
  owner           User?     @relation(fields: [ownerId], references: [id], onDelete: SetNull)
  transitions     DealTransition[]
  @@index([tenantId]) @@index([pipelineId]) @@index([stageId]) @@index([contactId])
}

// Stage history — powers forecast accuracy + velocity reporting in Inc C. Cheap to add now.
model DealTransition {
  id          String   @id @default(cuid())
  tenantId    String
  dealId      String
  fromStageId String?
  toStageId   String
  changedById String?
  createdAt   DateTime @default(now())
  deal        Deal     @relation(fields: [dealId], references: [id], onDelete: Cascade)
  @@index([tenantId]) @@index([dealId])
}
```

Add the back-relations to `Tenant`, `Contact`, and `User` (`deals Deal[]`, etc.).

### 12.3 Migrations & seeding

1. `npm run db:migrate -w @eynis/api` — new tables only, fully additive (no change to existing data).
2. **Default-pipeline seed** — every tenant needs one default pipeline or the board is broken:
   - In the seed (`db:seed`) and in tenant-creation, create a default pipeline with stages:
     **Lead In (10%) → Qualified (30%) → Proposal (60%) → Negotiation (80%) → Won (100%, isWon) →
     Lost (0%, isLost)**. These are *defaults* — tenants rename/reorder/reprobability later (white-label).
   - Idempotent backfill for existing tenants (the Riviera demo): create the default pipeline if none exists.
3. **Demo deals** — seed a handful of open deals on the demo tenant across stages so the board and
   forecast are non-empty in sales demos.

### 12.4 API routes (Increment A)

Follow the `server.ts` convention: parse path → `authorize(req, res, <perm>)` → validate → prisma
(scoped to `tenantId`) → `json(res, status, { ok, ... })`. Register each in `policyMap`. Mirror the
structure of `core/campaigns/service.ts` + `analytics.ts` in a new `core/crm/`.

| Route | Permission | Notes |
|---|---|---|
| `GET /pipelines` | `view_crm` | list pipelines + stages |
| `POST /pipelines`, `PATCH /pipelines/:id`, `POST /pipelines/:id/stages` … | `manage_crm` | configure funnel (Inc A: minimal; can defer custom stages to a settings screen) |
| `GET /deals` | `view_crm` | paginated, filter by `pipelineId`/`stageId`/`ownerId`/`status` |
| `GET /deals/:id` | `view_crm` | detail incl. transitions |
| `POST /deals` | `manage_crm` | create; optional `contactId` |
| `PATCH /deals/:id` | `manage_crm` | edit value/title/owner/close date |
| `POST /deals/:id/move` | `manage_crm` | change stage → writes `DealTransition`, auto-sets `status`/`closedAt` if stage `isWon`/`isLost` |
| `DELETE /deals/:id` | `manage_crm` | guard per team policy |
| `GET /deals/forecast` | `view_crm` | the forecast payload (see §12.5) |

**Permissions:** add `view_crm` and `manage_crm` to the permission catalog and to `Role` seed sets
(admin/manager/supervisor → `manage_crm`; agent → `manage_crm` or `view_crm` per team; viewer →
`view_crm`). Add the routes to `policyMap`.

### 12.5 Forecasting logic (`core/crm/forecast.ts`)

All computed over **open** deals scoped to `tenantId` (optionally filtered by pipeline/owner/period):

- **Open pipeline value** = Σ `deal.value` for open deals.
- **Weighted forecast** = Σ `deal.value × (stage.probability / 100)` — the headline number.
- **Forecast by period** = weighted value bucketed by `expectedCloseAt` (this month / this quarter).
- **Value by stage** = Σ value grouped by stage (the board column totals).
- **Win rate** = `won / (won + lost)` over a date range.
- **Committed vs best-case** = Σ value of deals in `isWon`-adjacent high-probability stages vs all open.

Return one JSON blob the board header + a small forecast card render from. Keep it a pure function over
prisma reads, like `core/campaigns/analytics.ts`.

### 12.6 Web UI (Increment A)

- **Nav:** add `Deals` (icon `TrendingUp`/`BarChart3`) to each industry's `navItems` in
  `apps/web/lib/industry-config.ts`; gate with `view_crm` via `getAllowedNavItems()`/`canAccessRoute()`.
- **`/deals` page** (server component, `force-dynamic`): a **kanban board** — one column per stage,
  deal cards (title, value, owner, close date) draggable between columns. A drag calls `POST
  /deals/:id/move`. Add a **forecast strip** (open value, weighted forecast, this-month/quarter) above
  the board. Provide a list/table view toggle for long pipelines.
- **Components** (`apps/web/components/ui/`): `deals-board-client.tsx` (DnD + optimistic move),
  `deal-card.tsx`, `deal-detail-panel.tsx` (create/edit, pick existing Contact via search),
  `forecast-summary.tsx`. Mirror patterns from `campaigns-client.tsx`/`segments-client.tsx`.
- **Data:** fetch via `apps/web/lib/data.ts` using the `lib/api.ts` token — no direct DB access.

### 12.7 Cross-cutting checklist (every PR)

- **Tenant isolation:** every query filtered by JWT `tenantId`; verify a deal/pipeline can't be read
  or moved cross-tenant. Add an API test asserting 404/403 on foreign-tenant IDs (tests hit real Postgres).
- **White-label:** no hard-coded currency symbol, stage names, or "Eynis" copy; stage labels and
  probabilities come from the tenant's pipeline.
- **Industry-agnostic:** neutral terms only — *Deal/Pipeline/Stage/Forecast*, never *booking/folio/guest*.
- **Failure handling:** `POST /deals/:id/move` validates the target stage belongs to the deal's pipeline
  and the tenant; reject otherwise.
- **Tests:** add `*.test.ts` under `apps/api/src` for CRUD, stage-move side-effects (won/lost →
  status/closedAt), and forecast math.

### 12.8 Acceptance criteria — Increment A (pilot-ready)

1. A user with `manage_crm` can create a deal, assign value/owner/close date, optionally link an
   existing contact, and drag it across stages on the board.
2. Moving a deal into a `isWon`/`isLost` stage sets `status` + `closedAt` and records a `DealTransition`.
3. The forecast strip shows open pipeline value, **weighted forecast**, and this-month/this-quarter
   numbers that recompute as deals move.
4. Every tenant has a working default pipeline out of the box; the demo tenant shows seeded deals.
5. All deal/pipeline access is tenant-scoped (verified by tests); `viewer` role is read-only.
6. `npm run build`, `npm run lint`, and `npm run test` pass.

### 12.9 Rough sizing

- **Inc A:** schema + migration + seed (S) · CRM core + APIs (M) · forecast (S) · board UI (M) ·
  tests (S) → the bulk of the effort, ~1 focused build cycle.
- **Inc B / C:** smaller, additive, on the foundation A establishes.
