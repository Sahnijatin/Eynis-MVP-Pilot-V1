# Eynis vs. ServiceNow — Architecture & Function, How Each Actually Works

> Status: **analysis / strategy doc** (June 2026). This does **not** change the
> business plan or product idea — it keeps Eynis's vision intact (see
> `docs/product-vision.md`, `docs/industry-agnostic-and-white-label-plan.md`,
> `docs/crm-design.md`, `docs/enhancements-roadmap.md`) and sets it next to
> ServiceNow to learn from how a mature platform is built.
>
> **Honest framing up front.** Eynis is an **MVP / pilot-stage** product — one
> small monorepo, a single demo tenant, a handful of connectors, an AI layer
> that's days old. ServiceNow is a **~20-year-old, ~$11B-revenue enterprise
> platform** running tens of thousands of customer instances. This is not a
> peer-to-peer comparison and it isn't meant to be. The point is to understand
> *how each one works mechanically*, where Eynis is deliberately lean, where the
> two genuinely rhyme (both are "a platform above your other tools"), and what
> ServiceNow's design teaches us about the road from MVP to platform.

---

## 0. TL;DR

| | **Eynis** | **ServiceNow** |
|---|---|---|
| **One-line identity** | AI-first, white-label **operations + CRM** platform that sits above the tools a business already uses | The enterprise **workflow platform** — "everything is a workflow on the Now Platform" |
| **Stage** | MVP / pilot (single repo, one demo tenant) | Mature mega-cap platform (Fortune 500 standard for ITSM) |
| **Core metaphor** | *Connect → unify events → AI reasons → automate* | *Model everything as records in tables → workflows act on records* |
| **Tenancy** | **Multi-tenant, one shared Postgres**, isolated by `tenantId` on every row/query | **Single-tenant "instance"** — a dedicated app node + dedicated database **per customer** |
| **Runtime** | Stateless `node:http` API, Prisma → Postgres; 60s automation loop; in-memory SSE | Java/Tomcat "Glide" app servers executing server-side JavaScript (GlideRecord) against a relational DB |
| **Customization** | Code (TypeScript) + per-tenant config/branding | **Low-code on a metadata-driven core**: tables, Business Rules, Flow Designer, scoped apps |
| **AI** | Built-in from day one — dual-provider (Claude + OpenAI), classification + insights | Bolted on over time — Now Assist / Virtual Agent / Predictive Intelligence / AI Agents |
| **Buyer** | SMB / mid-market, multi-industry, self-serve | Large enterprise IT, sold with system integrators |
| **Implementation** | Connect a few systems in minutes | Months, certified partners, dedicated admins/devs |

The strategic read: **Eynis is betting on the exact axes where ServiceNow is
weakest — time-to-value, price, native AI, and white-label simplicity — while
ServiceNow's strength (a universal, infinitely-extensible workflow/data core)
is the thing Eynis should learn from architecturally without inheriting its
weight.**

---

## 1. How ServiceNow actually works (proper context)

ServiceNow is easy to mis-summarize as "IT ticketing." Mechanically it's a
**single, metadata-driven application platform** ("the Now Platform") on which
all its products — ITSM, CSM, HRSD, SecOps, etc. — are just *applications built
out of the same primitives*. Understanding the mechanics matters more than the
product list.

### 1.1 The instance model (the defining architectural choice)

When a customer buys ServiceNow, they get one or more **instances**. An instance
is **not** a row in a shared multi-tenant database — it is a **dedicated set of
application nodes plus its own dedicated database**, running on **bare metal**
(not a shared VM pool) "for enhanced performance." This "**multi-instance**"
(logically single-tenant) model is the single most important fact about
ServiceNow's architecture:

- Each customer's data lives in **its own database** — "their own database,
  sometimes many databases." No noisy-neighbor data mixing; isolation is
  **physical**, not row-level. An instance is typically backed by **a pair of
  application nodes** for redundancy, and scales **horizontally** by adding more
  app nodes as load grows.
- Customers get multiple instances per subscription: a **production** instance
  plus **sub-production** instances (dev, test, QA). Code/config moves between
  them via **Update Sets** (see §1.6).
- **High availability (Advanced High Availability / AHA):** ServiceNow runs **~8
  data-center pairs** worldwide. Each instance's data lives in **two
  geographically paired sites kept in sync by continuous *asynchronous*
  replication**. Crucially, **both sites are always live** and each is sized to
  carry full production load — the active/standby designation is *per-instance*
  and can flip. On a site outage, the standby DB is promoted, DNS + instance
  config are repointed by automation. **Stated targets: RTO ≈ 2 hours, RPO ≈ 1
  hour; ~99.996% availability.** (Distinct from **Instance Data Replication / IDR**,
  a customer-facing feature for replicating *records* between a customer's own
  instances.)
- Because each instance is dedicated, customers can be on **different platform
  versions** ("families" — Tokyo, Utah, Vancouver, Washington, Xanadu, Yokohama…)
  and upgrade on their own schedule.
- **The DB engine is mid-migration.** Historically **MySQL → MariaDB** (InnoDB);
  ServiceNow is now moving to **RaptorDB**, its own engine — a **PostgreSQL fork
  derived from Swarm64** (a Berlin OLAP-Postgres company it acquired in 2021),
  unveiled at **Knowledge 24 (May 2024)** with migration targeted to complete by
  end of 2025. (Ironically, ServiceNow is converging on a Postgres lineage — the
  same family Eynis already runs.)

**Contrast with Eynis:** Eynis is **multi-tenant on a single shared Postgres**.
Every table carries a `tenantId` (in code) and every query is scoped to the JWT's
`tenantId`; isolation is a *software invariant*, not separate databases. This is
the standard lean-SaaS choice: far cheaper to run, instant provisioning, one
codebase/one DB to operate — at the cost of the hard physical isolation and
per-tenant version pinning that big regulated enterprises sometimes demand. (Eynis
*emulates* the good UX of the instance model — provider-managed provisioning,
per-tenant branding/domain — without the per-tenant infrastructure; see E-8/E-9/E-10
in `docs/enhancements-roadmap.md`, which explicitly cite "the ServiceNow instance
model" as the inspiration for provider-managed provisioning.)

### 1.2 The Glide stack (the runtime)

The application tier is a **Java** application (the "**Glide**" stack) running on
**Apache Tomcat**, talking to the per-instance relational database. The defining
characteristic: **almost everything an application does is expressed as server-side
JavaScript executed inside Java**, via an embedded JS engine (historically Mozilla
**Rhino**).

The core server API is **`GlideRecord`** — an object-relational abstraction over
the database. A developer doesn't write SQL; they write:

```javascript
var gr = new GlideRecord('incident');
gr.addQuery('priority', 1);
gr.query();
while (gr.next()) {
  gr.setValue('assigned_to', someUserSysId);
  gr.update();   // ← runs Business Rules, audit, workflow triggers
}
```

`GlideRecord.update()`/`insert()` doesn't just write a row — it fires the whole
**metadata-driven side-effect machine**: Business Rules, workflow/Flow triggers,
audit history, notifications. That's the heart of how ServiceNow "works": **data
operations are the event bus.**

### 1.3 Everything is a table (the metadata-driven data model)

ServiceNow's data model is radically uniform: **every entity is a table**, and the
platform's own configuration is *also* tables. Tables, fields, forms, roles,
business rules, workflows — all stored in **`sys_*` system tables**. The platform
is, literally, an application that reads its own definition out of its database at
runtime. Consequences:

- **Table inheritance — default is Table-Per-Hierarchy (TPH).** `task` is a base
  table; `incident`, `problem`, `change_request`, `sc_req_item` all *extend* it
  and inherit its fields (number, state, assignment, SLA hooks). Under TPH the
  child records **physically live in the parent (`task`) table**, with a
  **`sys_class_name`** column discriminating the concrete class (ServiceNow also
  supports Table-Per-Class and Table-Per-Partition strategies). New record types
  extend a parent and get behavior for free. Table definitions themselves live in
  `sys_db_object`; all metadata descends from `sys_metadata`.
- **The CMDB (Configuration Management Database).** A giant graph rooted at the
  base CI table **`cmdb_ci`**; every CI class (`cmdb_ci_server`,
  `cmdb_ci_application`, …) extends it via the same inheritance. Structured by the
  **Common Service Data Model (CSDM)**, it's the data backbone that makes
  ITOM/event-correlation/impact analysis possible — and it's "just tables" with a
  class hierarchy.
- **Customizing = creating/extending metadata, not forking code.** You add a field
  or a table through the UI and the platform stores it as more `sys_*` rows; no
  redeploy.

**Contrast with Eynis:** Eynis has an **explicit, hand-written Prisma schema** —
~45 concrete models (`Tenant`, `Contact`, `ServiceRequest`, `Deal`, `Pipeline`,
`VoiceCampaign`, …) with real columns and foreign keys. It is **schema-on-write,
opinionated, and typed end-to-end** (Prisma → TypeScript → `@eynis/shared`).
Where ServiceNow says "everything is a generic table you shape at runtime," Eynis
says "here are purpose-built entities with strong types." Eynis's *only* concession
to runtime flexibility today is `customFields Json` + a `CustomFieldDefinition`
concept (see `docs/crm-design.md` §5.5) — a deliberate, narrow escape hatch rather
than a whole platform. **This is the central architectural philosophy split:
generic-and-configurable (ServiceNow) vs. specific-and-typed (Eynis).**

### 1.4 The workflow engine (the actual product)

ServiceNow markets itself as "the workflow company," and that's literal. The most
valuable thing on the platform is the **workflow/automation engine**:

- **Flow Designer** — the modern low-code workflow builder: triggers (record
  created/updated, scheduled, inbound email/REST), conditions, actions, approvals,
  sub-flows. Replaced the older Workflow Editor.
- **Business Rules** — server-side scripts that run *before/after/async* on database
  operations (the GlideRecord side-effects above). This is where most "when X
  happens, do Y" logic lives.
- **SLAs / OLAs** — definitions that attach timers to records, pause/resume on
  state, and escalate on breach.
- **Assignment & routing** — assignment rules, **Advanced Work Assignment (AWA)**
  for skill/availability-based routing to agents.
- **Approvals** — multi-step approval chains as first-class workflow nodes.

**Contrast with Eynis:** Eynis's automation is a **purpose-built engine, not a
builder**. `core/automations/engine.ts` runs every **60 seconds** and evaluates a
fixed set of operational rules in parallel (`sla_breach_escalate`,
`sentiment_low_flag`, `checkin_welcome`, `upsell_followup`), using an
`AutomationExecution` row per (rule, entity) for **idempotency** (fire at most
once per entity). This is the right MVP move: a few high-value automations that
work out of the box, no builder to learn. ServiceNow's equivalent is a *general
workflow IDE* — vastly more powerful, vastly heavier, and something customers pay
integrators to configure. **The roadmap gap, if Eynis ever wants it, is a
Flow-Designer-style user-defined rule builder on top of the existing engine** —
but that's a "become a platform" decision, not an MVP one.

### 1.5 Low-code app building & the UI layer

ServiceNow isn't just pre-built apps; it's a **platform for building apps**:

- **App Engine Studio / Creator Workflows** — low-code IDE to build whole custom
  applications (tables, forms, flows, roles) without leaving the platform.
- **UI Builder** + the **Now Experience / Seismic (UXF)** framework — the modern
  component-based UI layer for "workspaces." The older customer/employee UI is the
  **Service Portal** (built on **AngularJS**).
- **Service Catalog** — productized request items (order a laptop, request access)
  with order guides, variables, and a fulfillment workflow behind each.
- **Knowledge Management** — KB articles, versioning, approval, surfaced in portal
  and Virtual Agent.

**Contrast with Eynis:** the UI is a **Next.js 15 App Router** app (React 19,
Tailwind), all **server components** with `force-dynamic`, talking to the API as a
pure client (no direct DB). It's a *hand-built product UI*, not a UI-building
platform. ServiceNow gives customers a canvas; Eynis gives customers a finished,
themeable product (white-label branding/tokens — E-9). Different bets: extensibility
vs. polish-out-of-the-box.

### 1.6 Shipping changes: Update Sets, scoped apps, the Store

- **Update Sets** — the unit of change promotion. Config changes are captured as an
  XML payload and moved dev → test → prod (ServiceNow's answer to "git for config").
- **Scoped Applications** — namespaced apps with their own tables/APIs and access
  controls, so third-party/custom apps don't collide with the global scope.
- **ServiceNow Store** — marketplace of certified apps/integrations.

**Contrast with Eynis:** changes ship the normal way — **git, PRs, CI, Vercel
deploy** (`README.md`). One codebase, one deploy, conventional SDLC. No per-tenant
config-promotion problem *because there's no per-tenant instance to promote
between* — config differences are just rows in the shared DB (branding, connector
configs, pipelines).

### 1.7 Integrations: IntegrationHub, MID Server, import sets

- **IntegrationHub** — low-code connectors/"spokes" to call external APIs from
  flows (Slack, Jira, Azure AD, etc.).
- **MID Server** — a lightweight Java agent the customer runs **inside their own
  network** so the cloud instance can reach on-prem systems (discovery, orchestration,
  on-prem API calls) without opening inbound firewall holes. This is a big deal for
  enterprise ITOM/discovery.
- **Import Sets + Transform Maps** — the bulk-ingest pattern: land external data in a
  staging table, then map/transform it into target tables.
- **REST/SOAP APIs** — every table is exposed via the **Table API** automatically.

**Contrast with Eynis:** integration is the **connector-first ingest pipeline**
(`core/connectors/ingest.ts`) — this is arguably Eynis's *most ServiceNow-like*
idea, just lighter. An inbound WhatsApp message runs a fixed 8-step pipeline:
create `ConnectorEvent` → upsert `Contact` → AI-classify → create `ServiceRequest`
with SLA → broadcast SSE → send reply (Twilio/Interakt) → update event → write
`AuditLog`. The connector **registry** (6 connectors today: WhatsApp×2, PMS×2, POS,
Payments) with per-tenant `ConnectorConfig` (secrets masked) is conceptually the
same shape as IntegrationHub spokes + transform maps — *normalize many external
sources into one internal event schema* — but hard-coded and curated rather than a
build-your-own-spoke platform. **There's no MID Server analog** (Eynis is cloud-to-cloud
via webhooks/APIs); for SMB SaaS targets that's fine and on-prem reach isn't needed.

### 1.8 AI: how ServiceNow got here vs. how Eynis started

ServiceNow's AI is a **layered accretion** over a pre-AI platform:

- **Predictive Intelligence** — ML for categorization/assignment/similarity on
  records (trained per instance).
- **Virtual Agent** — conversational bot (NLU) over the catalog/KB; its ML/NLU
  lineage traces to the **Element AI** acquisition (announced Nov 2020, closed Jan
  2021, ~$500M; co-founder Yoshua Bengio became a technical advisor).
- **AI Search** — unified semantic search across the platform.
- **Now Assist** (2023+) — the **generative-AI** layer embedded *inside* existing
  workflows (not a standalone chatbot): summarize incidents/cases, draft responses,
  generate knowledge, text-to-code/flow in the builders.
- **AI Agents / agentic AI** (2024–2026) — ServiceNow's push into autonomous
  multi-step agents that act across workflows; in **March 2025 it announced the
  acquisition of Moveworks** to extend the agentic/front-end-assistant layer.

The key point: ServiceNow had to **retrofit AI onto a 15-year-old record/workflow
core**, where the data model and UI predate LLMs.

**Contrast with Eynis:** AI is **foundational, not retrofitted**. `core/ai/intelligence.ts`
is a **dual-provider** layer (Claude `claude-opus-4-7` with adaptive thinking +
OpenAI `gpt-4o`), provider-selectable per request, with a **keyword-classification
fallback** when no API key is set (so dev/test/ingest works with zero AI cost). It's
wired *into the ingest path itself* — every inbound event is classified
(category/priority/sentiment/routing) at the moment it arrives, and higher-order
functions (`generateMorningBriefing`/Smart Insights, `generateGuestIntelligence`,
`generateRevenueInsights`, `generateNightAuditReport`) reason over the unified
stream. This is the **one axis where the MVP genuinely out-architects the
incumbent**: Eynis's data model and pipeline were designed *assuming* an LLM brain,
where ServiceNow's were not.

---

## 2. Side-by-side: how each one *works* (mechanics, not tabs)

### 2.1 The lifecycle of a single request

This is the clearest "how it works" comparison — follow one inbound request through
each system.

**ServiceNow (an incident from a portal/email):**
1. Inbound channel (Service Portal form, inbound email, Virtual Agent, REST) creates
   a record in the `incident` table (which extends `task`).
2. `GlideRecord.insert()` fires **before/after Business Rules**, stamps audit
   history, and triggers any **Flow** whose condition matches.
3. **Assignment rules / AWA** route it to a group/agent; **SLA definitions** attach
   timers based on priority.
4. The workflow advances through states (New → In Progress → Resolved → Closed);
   approvals or sub-flows run as needed; **Predictive Intelligence** may auto-categorize
   and **Now Assist** may summarize.
5. Breach of an SLA timer escalates via workflow; everything is recorded as table
   rows queryable in reports/Performance Analytics.

**Eynis (an inbound WhatsApp message):**
1. Twilio/Interakt webhook → Next.js proxy route → API.
2. `core/connectors/ingest.ts` runs its **fixed 8-step pipeline**: `ConnectorEvent`
   row → upsert `Contact` by phone → **AI classify** (or keyword fallback) →
   create `ServiceRequest` with an `slaDueAt` deadline → **broadcast SSE** to live
   dashboards → send outbound reply → update the `ConnectorEvent` → write `AuditLog`.
3. The **60-second automation engine** later evaluates the SR for SLA breach,
   sentiment flags, etc., writing one `AutomationExecution` per (rule, entity) for
   idempotency, and emits transitions (`ServiceRequestTransition`) as the status
   changes.
4. Operators see it live via **SSE** (`/sse/live-feed`), and the AI layer can roll
   it into a briefing.

**What this shows:** both are **event-driven systems that turn an inbound signal
into a tracked work item with an SLA**. ServiceNow's eventing is *implicit* —
side effects of a database write, infinitely configurable through Business Rules
and Flows. Eynis's is *explicit and linear* — a readable 8-step function plus a
periodic rule loop. ServiceNow trades readability for configurability; Eynis trades
configurability for a pipeline a new engineer can read top-to-bottom in one sitting.
**Eynis also classifies with an LLM at ingestion** — a step that simply didn't exist
when ServiceNow's incident pipeline was designed.

### 2.2 Data & extensibility

| Dimension | **Eynis** | **ServiceNow** |
|---|---|---|
| Schema | Explicit Prisma models, typed to TS | Generic `sys_*` tables, table-per-class inheritance |
| Add a field | Migration + code (or `customFields` JSON) | Point-and-click; stored as metadata rows |
| Source of truth | Code repo (git) | The instance's own database |
| New entity type | New Prisma model + routes | Extend a base table in the UI |
| Strong typing | End-to-end (`@eynis/shared`) | Loosely typed; runtime metadata |
| Bet | **Specific & typed**, fast for *us* to build well | **Generic & configurable**, fast for *customers* to reshape |

### 2.3 Runtime & operations

| Dimension | **Eynis** | **ServiceNow** |
|---|---|---|
| App tier | Stateless Node `node:http` (one `server.ts`) | Java/Tomcat "Glide" nodes |
| DB | One shared Postgres (Prisma) | One dedicated DB **per instance** |
| Isolation | Row-level `tenantId`, enforced per query | Physical, separate DB per customer |
| Scripting | TypeScript, compiled, in-repo | Server-side JS (GlideRecord) at runtime |
| Real-time | In-memory SSE map | Workflow/notification engine, polling/AMB |
| Provisioning | Instant (insert a tenant row) | Stand up an instance (app node + DB) |
| HA/DR | Standard managed Postgres + Vercel | Paired data centers, async replication, failover |
| Upgrades | One deploy, all tenants | Per-instance, customer-scheduled, family upgrades |

### 2.4 Customization & delivery

| Dimension | **Eynis** | **ServiceNow** |
|---|---|---|
| How customers customize | Per-tenant **config + white-label branding**; provider-managed industry/domain | Build apps (App Engine), Business Rules, Flows, custom tables |
| Change promotion | git → PR → CI → Vercel | **Update Sets** dev→test→prod |
| Marketplace | None (curated connector registry) | **ServiceNow Store** |
| UI model | Finished, themeable product (Next.js) | UI-building platform (UI Builder / Service Portal) |

### 2.5 Function / product coverage

| Capability | **Eynis (MVP)** | **ServiceNow (mature)** |
|---|---|---|
| Service requests / tickets | ✅ `ServiceRequest` + transitions + SLA | ✅ ITSM (incident/problem/change), the flagship |
| CRM / deals / pipeline | ✅ Contacts, Companies, Deals, Pipelines, forecasting | ✅ CSM (customer service), Sales/OM via partners |
| Multi-channel messaging | ✅ WhatsApp (Twilio/Interakt), voice (Vapi), email (Resend) | Via CSM/IntegrationHub + telephony partners |
| Campaigns / sequences | ✅ Native (voice/WhatsApp/email, A/B, drip) | Not a core strength (marketing isn't its lane) |
| Workflow **builder** | ❌ (fixed-rule engine, by design) | ✅ Flow Designer — the crown jewel |
| Config Mgmt DB (CMDB) | ❌ (not the domain) | ✅ The backbone of ITOM |
| IT asset/ops mgmt (ITOM) | ❌ | ✅ Discovery, event mgmt, service mapping |
| HR / SecOps / GRC | ❌ | ✅ Whole product lines |
| App-building platform | ❌ | ✅ App Engine Studio |
| Native generative AI | ✅ Foundational (Claude + OpenAI) | ✅ Now Assist / AI Agents (retrofitted) |
| White-label by default | ✅ Core principle (branding/domain/email) | Partial; not a positioning pillar |
| Industry-agnostic core | ✅ Core principle (5 verticals, neutral models) | Industry "products" layered on the platform |

---

## 3. Scale & business context (so the comparison is grounded)

- **Size.** ServiceNow is a mega-cap: revenue **crossed $10B in 2024** (subscription
  grew at a ~26% CAGR 2020–2024), **~$10–11B+ cRPO** forward bookings, **~29,000
  employees**, and **~8,400 customers** including **>85% of the Fortune 500** (with
  ~2,100 customers over $1M ACV). Market cap sits in the **~$150B–230B** large-cap
  range. It is the de-facto standard for enterprise **ITSM** and a serious player
  across IT, employee, and customer workflows.
- **Operational scale.** The platform reportedly manages **~85,000 databases**,
  **~50,000 instances**, **~25 billion queries/hour**, and **~10B transactions/month**
  across its **8 data-center pairs** — the concrete cost of the dedicated-DB-per-instance
  model, at a scale Eynis's single shared Postgres will never need to reach for the
  same number of *tenants*.
- **Buyer & motion.** Sold top-down to **large-enterprise IT**, typically via
  **system integrators** (Accenture, Deloitte, etc.). **Per-fulfiller subscription**
  (third-party estimates ~$70–200/user/mo, volume-discounted), quoted not listed,
  **high ACV**, multi-quarter sales cycles. A **April 2026 pricing overhaul** is
  reported to collapse legacy SKUs into three AI-native tiers (**Foundation /
  Advanced / Prime**).
- **Implementation reality.** Deployments average **~5 months** and **$10K–$100K+**
  beyond licensing, need **certified admins and developers**, and ongoing platform
  teams. Power is real; so is the weight.
- **Known criticisms** (the openings Eynis is built into):
  - **Cost** — among the most expensive platforms in the category.
  - **Complexity** — steep learning curve; you staff for it.
  - **Time-to-value** — long implementations before payback.
  - **Specialist dependency** — you rarely run it without partners/admins.

**Eynis, by contrast,** is a **pilot-stage MVP**: one demo tenant ("The Riviera"),
~13 endpoints described in the vision doc (more in code now), connectors you wire in
**minutes**, AI on by default, white-label and industry-agnostic as *principles* not
add-ons. It targets **SMB/mid-market across many industries** with **self-serve,
fast time-to-value, and price** as the wedge. The whole product is intentionally a
few thousand lines you can read — the opposite of a platform you staff a team to run.

---

## 4. What this means for Eynis (keeping the plan intact)

The business plan doesn't change — this analysis *reinforces* it. ServiceNow proves
the **category** (a platform above your other tools, with a workflow/automation core
and a unified data model, is worth tens of billions) while leaving Eynis a clean
lane on the axes ServiceNow can't easily move on:

1. **Lean by design is a feature, not a deficiency.** Eynis's explicit 8-step
   pipeline + 60-second rule engine are *legible and fast to evolve*. Don't chase
   "everything is a configurable table" — that's the complexity that makes ServiceNow
   slow to adopt. Keep the typed, opinionated core; expose flexibility narrowly
   (`customFields`, per-tenant pipelines/branding), not as a whole meta-platform.
2. **AI-native is the real moat.** ServiceNow is *retrofitting* generative AI onto a
   pre-AI core. Eynis classifies and reasons at ingestion. Lean into agentic
   next-best-action and conversational capture (`docs/crm-design.md` §7) as
   *defaults*, never a paid tier — that's precisely where the market is moving and
   where the incumbent is structurally behind.
3. **Steal the *good* ServiceNow ideas, skip the weight.** Worth borrowing:
   provider-managed provisioning UX (already adopted, E-8/E-10), an SLA/transition
   audit trail (already have it), a normalize-everything-into-one-event-schema ingest
   layer (already have it). *Not* worth borrowing now: per-tenant instances, a
   full workflow IDE, an app-building platform, Update-Set-style config promotion.
   Those are "become an enterprise platform" investments — revisit only if/when a
   genuinely enterprise customer demands physical isolation or build-your-own
   workflows.
4. **Time-to-value, price, white-label, multi-industry** are the four wedges where
   ServiceNow is weakest and Eynis is strongest. The plan already centers them.
   Stay there.

**Bottom line:** Eynis is not a smaller ServiceNow — it's a *differently-shaped*
product aimed at the customers ServiceNow can't serve cheaply or quickly. The
architecture comparison validates the strategy: keep the AI-native, connector-first,
white-label, industry-agnostic plan exactly as written — and treat ServiceNow as the
map of what "platform maturity" eventually looks like, not as a spec to copy.

---

## 5. Sources & verification

**Eynis facts** are grounded directly in this repo: `docs/product-vision.md`,
`docs/crm-design.md`, `docs/enhancements-roadmap.md`,
`docs/industry-agnostic-and-white-label-plan.md`, `apps/api/prisma/schema.prisma`,
`apps/api/src/server.ts`, `apps/api/src/core/*`, and `CLAUDE.md`.

**ServiceNow facts** were cross-checked against product documentation and reputable
analyses (June 2026 research pass):

- Instance model / bare-metal / DB-per-customer & operational scale —
  [diginomica: "Managing 85,000 databases, 25 billion queries/hour"](https://diginomica.com/look-servicenow-managing-85000-databases-25-billion-queries-per-hour),
  [aegissofttech Now Platform overview](https://www.aegissofttech.com/insights/servicenow-now-platform-overview/),
  [hirekeyz platform architecture](https://hirekeyz.com/research-white-papers-detail/ServiceNow-Platform-Architecture/).
- High availability (paired DCs, async replication, RTO 2h / RPO 1h) —
  [ServiceNow Business Continuity FAQ (PDF)](https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/public-document/servicenow-business-continuity-faq.pdf),
  [ServiceNow Advanced High Availability white paper (PDF)](https://www.servicenow.com/content/dam/servicenow-assets/public/en-us/doc-type/resource-center/white-paper/wp-sn-advanced-high-availability-architecture.pdf),
  [Instance Data Replication docs](https://www.servicenow.com/docs/r/servicenow-platform/instance-data-replication-idr/instance-data-replication.html).
- Stack & RaptorDB/Swarm64 (MariaDB → PostgreSQL fork) —
  [Techzine: ServiceNow trades MariaDB for RaptorDB](https://www.techzine.eu/news/data-management/119846/servicenow-trades-mariadb-for-raptordb-postgresql/),
  [ServiceNow dev blog: MariaDB vs RaptorDB perf](https://www.servicenow.com/community/developer-blog/maria-db-vs-raptor-db-record-insertion-performance-part-1/ba-p/3372635).
- Table model / TPH inheritance / CMDB —
  [ServiceNow KB: Table Structures FAQ](https://support.servicenow.com/kb?id=kb_article_view&sysparm_article=KB0723580),
  [Community: TPC/TPH/TPP](https://www.servicenow.com/community/developer-forum/table-extensions-table-per-class-table-per-hierarchy-table-per/m-p/2751593),
  [CMDB tables reference](https://www.servicenow.com/docs/bundle/zurich-servicenow-platform/page/product/configuration-management/reference/cmdb-tables-details.html).
- Scripting (GlideRecord / Script Includes / GlideAjax) —
  [snprotips: GlideRecord client vs server](https://snprotips.com/blog/2016/2/6/gliderecord-client-side-vs-server-side),
  [thesnowball: Script Include](https://thesnowball.co/glossary/script-include).
- Low-code / UI (App Engine Studio, UI Builder, Seismic, Service Portal) —
  [App Engine Studio](https://www.servicenow.com/products/app-engine-studio.html),
  [Future of ServiceNow UI — Seismic & Now Design System](https://www.servicenow.com/community/developer-articles/future-of-servicenow-ui-seismic-and-the-now-design-system/ta-p/2323669).
- Packaging (scoped apps, update sets) —
  [Scoped Application Release Process](https://www.servicenow.com/community/developer-articles/scoped-application-release-process/ta-p/2310946),
  [Don't mix Update Set & App Repo](https://www.servicenow.com/community/developer-blog/servicenow-things-to-know-7-you-shouldn-t-mix-update-set-and-app/ba-p/2756565).
- Integration (IntegrationHub, MID Server, import sets) —
  [IntegrationHub resources](https://www.servicenow.com/community/now-platform-articles/platform-integration-hub-knowledge-amp-troubleshooting-resources/ta-p/2313162),
  [oneio: ServiceNow integrations](https://www.oneio.cloud/blog/servicenow-integrations).
- AI (Element AI, Now Assist, AI Agents, Moveworks) —
  [ServiceNow to acquire Element AI](https://www.servicenow.com/company/media/press-room/servicenow-to-acquire-element-ai.html),
  [Now Assist GenAI](https://aelumconsulting.com/blogs/servicenow-generative-ai-with-now-assist/),
  [AI Agent vs Now Assist vs Virtual Agent](https://www.servicenow.com/community/developer-forum/difference-between-ai-agent-now-assist-and-virtual-agent/m-p/3329000).
- Modules / positioning / pricing / criticism —
  [ITSM product page](https://www.servicenow.com/products/itsm.html),
  [dotsquares: modules](https://www.dotsquares.com/press-and-events/tech/servicenow-modules),
  [NowTribe: ITSM pricing 2026](https://nowtribe.com/how-much-does-servicenow-itsm-cost-in-2026-a-complete-breakdown/),
  [sprinto: honest review](https://sprinto.com/blog/servicenow-review/),
  [ksolves: why implementations fail](https://www.ksolves.com/blog/servicenow/why-servicenow-implementations-fail).
- Financials/scale —
  [ServiceNow FY2024 8-K (SEC EDGAR)](https://www.sec.gov/Archives/edgar/data/0001373715/000137371525000007/erq4fy24.htm),
  [ServiceNow ranks on Fortune 500](https://www.servicenow.com/blogs/2025/servicenow-ranks-fortune-500-list).

**Caveats (flagged honestly):** per-seat pricing and the April-2026 tier names
(Foundation/Advanced/Prime) are third-party/recent — verify against a current
ServiceNow quote before external use. Operational-scale numbers are a point-in-time
diginomica snapshot (order-of-magnitude). Market cap was not in primary sources —
pull a live NOW quote before citing. The AHA white-paper PDF was access-restricted
to the automated fetcher; HA specifics come from the Business Continuity FAQ and the
white-paper abstract — confirm exact phrasing in a browser if quoting verbatim.
