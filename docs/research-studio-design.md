# Research Studio — Design & Build Plan

> Status: **Proposal / design doc** (June 2026). No feature code yet — this is the plan we
> review before building. Read alongside `docs/crm-design.md`, `docs/enhancements-roadmap.md`,
> `docs/design-system.md`, and `CLAUDE.md` (Product Principles).
>
> **Branch:** `claude/repo-review-planning-yLhwg` · **Phase IDs:** `RS-1` … `RS-4`
> **Convention:** mirrors the `E-NN` enhancement series — each phase maps to a GitHub issue;
> this document is the canonical reference linked from every `RS-` issue.

---

## TL;DR

We have a working agentic research-and-report pipeline in a separate repo (`ai-audit`): a
Tally webhook → LangGraph flow (Research → Audit → Validate → Build → Deliver) that researches
a business and emits a branded marketing report. It is **hardcoded to one report type**, runs
as a standalone Python service, and uses **paid** web search (Tavily).

Research Studio brings that capability **into Eynis as a native, configurable module** with
three changes that make it a platform feature rather than a script:

1. **Dynamic, not static.** The report template stops being a file on disk and becomes a
   **per-tenant, user-editable object in the DB**. Users define *what to research, which
   sources to use, and how the report is structured* — all in-platform. "Marketing audit" is
   just one saved template among many. The module is **not limited to marketing**: subjects can
   be a deal, contact, company, or free-form prospect.
2. **Cheap by construction.** Only the synthesis step costs money. Web search moves to
   **self-hosted SearXNG**, page content to **self-hosted crawl** (Playwright +
   `@mozilla/readability`), and only the final structuring uses Claude/OpenAI — tiered
   cheap→premium. Search and crawl are fixed infra, not per-query fees.
3. **Native to the platform.** It reuses Eynis's existing AI provider layer, branded
   render/export, RBAC, multi-tenancy, SSE live feed, and the report-builder UI patterns — and
   **feeds the CRM** (logs to the activity timeline, contributes to lead score, proposes deal
   moves) rather than living off to the side.

Two surfaces, one engine: a full **Research Studio** (`/research`) and a lightweight, faster
**Research** button embedded on Deal / Contact / Company.

---

## 1. Why now

Eynis has campaigns, a CRM spine (Contact / Company / Deal / Pipeline / Activity), AI
intelligence, and branded reporting. The recurring question a CRM cannot answer today is the
*pre-action* one: *"Who is this prospect/competitor/vendor, what should I know before I act, and
how do they score?"* That is research, and it is the natural complement to the CRM: research
**feeds** the relationship record. The `ai-audit` repo already proves the agentic flow works;
the job is to generalise it, make it cheap, and wire it into the platform.

---

## 2. Decisions confirmed up front

| # | Decision | Choice |
|---|----------|--------|
| 1 | Where the engine runs | **Option A — TS-native inside `apps/api`.** No Python sidecar in v1. Port the (~220-line) gather logic to TypeScript; add a Python scrape-worker later only if scraping quality demands it. |
| 2 | Automation tie-in | **In scope.** Auto-run on deal stage change; results written back as CRM activity, lead score, and (safe-mode) deal suggestions. |
| 3 | Surfaces | **Both.** Research Studio first; contextual lite button on deal/contact/company as a trimmed, faster config of the same engine. |
| 4 | Frontend bar | **High.** Built entirely on `components/ds/` primitives; live-progress run UX; cost transparency on every source/run. |
| 5 | Web search | **Self-hosted SearXNG** (JSON API, locked to app-server IPs) replaces Tavily. |

---

## 3. What we reuse (verified seams — do not rebuild)

| Need | Existing in Eynis | File |
|------|-------------------|------|
| LLM synthesis (Claude/OpenAI + fallback) | `aiComplete()`, `parseStructured<T>()`, `extractJson()` | `apps/api/src/core/ai/intelligence.ts` |
| Branded preview + PDF + CSV export | `renderBrandedReportHtml()`, `renderBrandedReportPdf()`, `brandedCsv()`, `loadReportBrand()` | `apps/api/src/core/export/` |
| Config-driven report module precedent | `REPORT_SOURCES`, `validateDefinition()`, `runReportDefinition()`; `Report`/`ReportShare` models; report-builder UI | `apps/api/src/core/reports/reports.ts`, `apps/web/components/ui/report-*.tsx` |
| Async worker pattern (idempotent) | `startAutomationWorker()` + `AutomationExecution` | `apps/api/src/core/automations/engine.ts` |
| Live progress to the UI | SSE feed + `live-feed-sse.tsx` | `apps/api/src/sse/`, `apps/web/components/ui/live-feed-sse.tsx` |
| RBAC / multi-tenancy / license gating | `policyMap`, `getAuthenticatedContext`, `ensureTenantAccess`, license flags | `apps/api/src/server.ts`, `core/license.ts` |
| UI primitives | `PageHeader, Card, Field, Input, Select, Textarea, Badge, Modal, Disclosure, Spinner, EmptyState, ToastProvider` | `apps/web/components/ds/index.tsx` |

The only genuinely new backend code is the **GATHER** layer; render/preview/export is free.

---

## 4. Architecture

```
1. GATHER     (cheap / self-hosted)  → SearXNG + crawl (Playwright + readability) + free APIs
2. SYNTHESIZE (paid, minimal)        → Haiku cleans/extracts → Sonnet structures (reuse AI layer)
3. RENDER     (free, already built)  → branded HTML preview + PDF / CSV export
```

### 4.1 Backend — `apps/api/src/core/research/`

```
sources/searxng.ts     GET {SEARXNG_URL}/search?format=json   (web search; replaces Tavily)
sources/crawl.ts       fetch + @mozilla/readability; Playwright fallback for JS-heavy pages
sources/pagespeed.ts   free Google PageSpeed (port of ai-audit services/seo.py)
sources/registry.ts    maps template "sources" keys → gatherer fns (extensible)
gather.ts              runs enabled gatherers in parallel; dedupes via ResearchSourceCache
synthesize.ts          per-section tiered LLM (Haiku → Sonnet); reuses aiComplete/parseStructured
validate.ts            structural checks (tables/charts/score clamp) + LLM fact-check vs evidence
engine.ts              orchestrates gather → synthesize → validate; writes status + SSE per stage
worker.ts              startResearchWorker() — drains queued runs (mirrors startAutomationWorker)
```

**Cost control is structural:** only `synthesize.ts` spends; it tiers cheap→premium.
`ResearchSourceCache` avoids re-crawling the same URL across runs. Every source is free/self-hosted.

### 4.2 Data model (new Prisma models, mirroring `Report`/`ReportShare`)

```
ResearchTemplate    id, tenantId, name, description,
                    subjectType (deal|contact|company|freeform),
                    inputs Json, sources Json, sections Json,
                    isBuiltIn Bool, createdBy, createdAt, updatedAt

ResearchRun         id, tenantId, templateId, templateSnapshot Json,
                    subjectType, subjectId?, inputs Json,
                    status (queued|gathering|synthesizing|validating|ready|failed),
                    gathered Json, result Json, usage Json (tokens/cost),
                    error?, createdBy, createdAt, updatedAt

ResearchSourceCache tenantId, urlHash, content, fetchedAt   // crawl dedupe / cost cut

ResearchShare       runId, granteeUserId? | granteeRoleKey?  // reuse ReportShare semantics
```

The template is **snapshotted into each run** so editing a template never mutates past reports.

### 4.3 Template object (the heart of "dynamic")

```jsonc
{
  "name": "Pre-Call Deal Brief",
  "subjectType": "deal",
  "inputs": [
    { "key": "website",  "label": "Website URL",     "prefillFrom": "company.domain" },
    { "key": "linkedin", "label": "LinkedIn",          "prefillFrom": "contact.linkedin" }
  ],
  "sources": {
    "webSearch": { "enabled": true, "queries": ["{name} funding", "{name} news", "{name} competitors"] },
    "crawl":     { "enabled": true, "seeds": ["{website}"], "maxPages": 6 },
    "pagespeed": { "enabled": false }
  },
  "sections": [
    { "id": "overview", "title": "Company Overview", "prompt": "Summarise who {name} is...", "outputs": ["text"] },
    { "id": "swot",     "title": "SWOT",             "prompt": "...",                         "outputs": ["table"] },
    { "id": "talktrack","title": "Recommended Talk Track", "prompt": "...",                   "outputs": ["text"] },
    { "id": "fit",      "title": "Fit Score",        "outputs": ["score"], "weight": 25 }
  ]
}
```

This is the old `ai-audit/templates/template.json` generalised: add `subjectType`, `inputs` (with
CRM prefill), and per-source config, so it is **not marketing-bound**.

### 4.4 API routes (added to `server.ts` if/else chain + `policyMap`)

```
GET/POST/PUT/DELETE /research/templates              manage_research
POST   /research/runs            (enqueue)           run_research
GET    /research/runs            (list)              view_research
GET    /research/runs/:id        (poll / result)     view_research
GET    /research/runs/:id/export?format=pdf|csv      view_research
POST   /research/runs/:id/share                      manage_research
GET    /research/sse/:id         (live progress)     view_research
```

License gate: feature flag `research_studio` on the `License` model.

---

## 5. Automation tie-in

1. **Rule `research_on_stage`** (new automation rule): when a Deal enters a configured stage,
   auto-enqueue a run with a chosen template + the deal as subject. Idempotent via
   `AutomationExecution`.
2. **Result → CRM activity:** on `ready`, write an `Activity` on the subject (score + link to
   report) so research appears natively on the timeline.
3. **Result → signals:** feed the run `score` into the contact's `leadScore` and, for deals, a
   **safe-mode** `DealSuggestion` (human confirms; never auto-moves).
4. **Optional triggers (later):** new contact from a campaign; scheduled weekly re-research toggle.

---

## 6. Frontend (built on `components/ds/`)

### A. Research Studio (`/research`)
- **Templates gallery** — `Card` grid of saved templates (built-in starters + custom), each with
  a subject-type `Badge` and Run / Edit. `EmptyState` when none.
- **Template editor** — 3-step `Disclosure`-driven builder (same feel as `report-builder.tsx`):
  **① Subject & Inputs → ② Sources** (toggles with per-source query fields and a "free /
  self-hosted" cost hint) **→ ③ Report structure** (orderable sections; output-type chips:
  text/table/chart/score). Live "what this produces" outline alongside.
- **Runs list** — `data-grid` of past runs: status `Badge`, subject, score, date.

### B. Run experience
Pick template → fill inputs (`Field`/`Input`) → **Run**. A **live progress panel** driven by
`live-feed-sse.tsx`: animated stages *Gathering → Reading pages → Synthesizing → Validating →
Ready*, with discovered sources ticking in. Never a bare spinner.

### C. Report preview
Branded layout via the `report-view.tsx` pattern: cover, score gauge (`charts.tsx`), sections
with tables/charts, sticky action bar (**Export PDF / CSV**, **Share** via `report-share-modal.tsx`,
**Log to CRM**). This is the in-platform preview.

### D. Contextual "Research" button (lite)
On Deal/Contact/Company detail panels, a `Research` button opens a `Modal` that **pre-fills inputs
from the record**, defaults to a fast template (fewer sources/sections, cheap model only), and runs
inline — result drops onto the record's timeline. "Open full report" escalates to the Studio view.
Same engine, trimmed config = faster + cheaper.

**Design principles:** one primary action per screen; progressive disclosure for advanced source
options; cost transparency on every source/run; live-progress so a 1–2 min run feels intentional;
fully themed by tenant brand tokens (white-label by default).

---

## 7. Built-in starter templates (ship with the module)

1. **Pre-Call Deal Brief** (subject: deal) — overview, recent news, SWOT, talk track, fit score.
2. **Competitor Teardown** (subject: company/free-form) — positioning, pricing signals, strengths/gaps, opportunities.
3. **Company / Prospect Profile** (subject: contact/company) — firmographics, footprint, buying signals, score.
4. *(optional)* **Marketing Audit** — the original `ai-audit` template, ported as a starter.

---

## 8. Phased rollout (RS-series)

| Phase | Scope | Acceptance |
|-------|-------|------------|
| **RS-1 — Engine + Studio MVP** | Models + migration; gather (SearXNG + crawl + pagespeed); synthesize (tiered) + validate; `startResearchWorker`; templates CRUD; run + branded HTML preview + PDF export; 2–3 built-in templates; route + `policyMap` + license gate. | A user can create/edit a template, run it against a free-form subject, watch live progress, and preview + export a branded report. |
| **RS-2 — Contextual lite button** | `Research` button + `Modal` on deal/contact/company; input prefill from record; fast template defaults; result logged to the activity timeline. | One-click research from a deal/contact/company, result appears on the timeline in < ~90s. |
| **RS-3 — Automation tie-in** | `research_on_stage` rule; CRM activity + lead-score + safe-mode deal-suggestion write-back; share ACL; CSV export. | Moving a deal to a configured stage auto-runs research; output enriches the CRM; reports are shareable. |
| **RS-4 — Polish** | `ResearchSourceCache` + cost dashboard; scheduled re-research; more starter templates; first **web tests** for the module. | Repeat runs hit cache; per-run cost is visible; web test suite exists. |

---

## 9. New env / infra

| Var | Purpose |
|-----|---------|
| `SEARXNG_URL` | Self-hosted SearXNG base URL; JSON API enabled (`formats: [html, json]`), locked to app-server IPs. |
| `PAGESPEED_API_KEY` | Optional, free-tier Google PageSpeed. |

New `apps/api` deps: `playwright`, `@mozilla/readability` (+ `jsdom`). **No new paid services.**

---

## 9a. Implementation status — RS-1 shipped

RS-1 is implemented in this branch. What landed, and a few deliberate calls made during the build:

**Backend (`apps/api`)**
- Models + migration: `ResearchTemplate`, `ResearchRun`, `ResearchSourceCache`, `ResearchShare` (`prisma/migrations/20260607050000_add_research_studio`).
- Engine in `src/core/research/`: `sources/{searxng,crawl,pagespeed,http}.ts`, `gather.ts` (parallel + per-tenant crawl cache), `synthesize.ts` (tiered), `validate`-by-construction (score clamp / table sanitize inside synthesize), `render.ts`, `engine.ts`, `worker.ts`, `types.ts`, `templates.ts`, `store.ts`.
- Routes added to `server.ts` (`/research/sources|templates|templates/:id|runs|runs/:id|runs/:id/export`); `startResearchWorker()` wired into `startServer()`.
- Permissions `view_research` / `run_research` / `manage_research` (`core/permissions.ts`, self-heal via `syncSystemRolePermissions`); license feature `research_studio` (Growth+).
- Tiered AI helper `aiCompleteTiered()` added to `core/ai/intelligence.ts` (Haiku/`gpt-4o-mini` cheap tier; premium keeps extended thinking).
- Unit tests (no DB): `core/research/research.test.ts` (validation, html→text, render, fallback synthesis, built-ins).

**Frontend (`apps/web`)**
- `/research` page + `components/ui/research-studio-client.tsx` (gallery, 3-step editor, run modal, live-progress run view via polling, branded preview + PDF/CSV/HTML export). Proxy routes under `app/api/research/*`. Nav entry added to the shared CRM module.

**Deliberate deviations from the original plan (all sensible scope calls):**
1. **Crawl is dependency-free** (`fetch` + an HTML→text reducer) instead of Playwright + `@mozilla/readability`. This keeps RS-1 CI/serverless-safe with **no new npm deps and no headless-browser binary**. A Playwright fallback for JS-heavy sites moves to **RS-4**. Most company/marketing sites yield enough static HTML for synthesis.
2. **No-AI fallback:** when neither AI key is set, synthesis returns a complete, evidence-grounded report deterministically (mirrors the platform's keyword-fallback philosophy) so dev/test and unconfigured tenants still work end-to-end.
3. **Run progress via polling** (`GET /research/runs/:id` every ~1.8s) for a robust UX; the global SSE feed also carries `research_run` events. A dedicated SSE stream can come later.
4. **Early CRM bridge:** a run that targets a contact/deal/company already logs a completion `Activity` to the timeline — bringing part of RS-2/RS-3's value forward at no extra cost.

**New env vars:** `SEARXNG_URL` (web search; unset → search degrades gracefully), `PAGESPEED_API_KEY` (optional, free tier), and optional tuning: `RESEARCH_CLAUDE_CHEAP_MODEL`, `RESEARCH_OPENAI_CHEAP_MODEL`, `RESEARCH_WORKER_INTERVAL_MS`, `RESEARCH_WORKER_BATCH`, `RESEARCH_CACHE_TTL_MS`, `RESEARCH_USER_AGENT`.

## 9b. Implementation status — RS-2 shipped

The contextual lite Research button is implemented.

- Reusable `apps/web/components/ui/research-button.tsx`: opens a modal that picks a
  fast template for the subject type, **pre-fills inputs from the record**, runs a
  `fast: true` (cheap-tier) pass inline with live progress, then shows a compact
  preview. The result is auto-logged to the record's timeline (engine write-back).
- Embedded on the **Contact** and **Company** detail modals. The Studio gained
  **run deep-linking** (`/research?run=<id>`), so "Open full report" jumps straight
  to the full branded run view.
- **Deal-context note:** the deals board has no per-deal detail modal (deals are
  edited on the kanban/grid), so a direct deal button isn't wired in v1. Deal
  research is covered via the linked company/contact and, in **RS-3**, the
  `research_on_stage` auto-run. A deal button can drop in once a deal detail view exists.

## 9c. Implementation status — RS-3 shipped

Automation tie-in + CRM write-back.

- **`research_on_stage` automation rule** (`core/automations/engine.ts`): added to the
  60s cycle. A single per-tenant rule holds a list of stage→template triggers (the
  rule table is unique per `tenant+code`). For each configured stage it enqueues a
  `fast` research run for every open deal in that stage, once per `(stage, deal)` via
  the idempotency record. Uses the linked company (name + domain) for richer inputs.
- **Trigger management API** (`/research/triggers` GET/POST, `/research/triggers/:stageId`
  DELETE) + proxies + a **"Auto-run on deal stage"** card in the Studio (pick a
  pipeline stage + template → add/remove).
- **Score write-back:** a contact run now updates `Contact.leadScore` (in addition to
  the timeline activity from RS-1), so research enriches the CRM signal.

**Deferred from RS-3:** per-run share ACL. Runs are already team-visible to anyone
with `view_research` in the tenant, so a `ReportShare`-style ACL adds little until run
visibility is restricted to creator/shared — moved to a later pass. (CSV export and
the `ResearchShare` model already exist.) A safe-mode `DealSuggestion` write-back was
also skipped: `DealSuggestion` is specifically a *stage-move* proposal, which a
research score doesn't map onto cleanly — the timeline activity + lead-score are the
honest signals.

## 9d. Implementation status — RS-4 shipped

Polish + hardening.

- **SSRF hardening (security):** the crawler fetches *user-supplied* URLs (template
  seeds / run inputs), so `sources/crawl.ts` now resolves each host and **rejects
  private/loopback/link-local/metadata addresses**, and follows redirects
  **manually**, re-validating every hop (a public URL can't 302 into `169.254.169.254`).
  Residual DNS-rebinding (TOCTOU) is noted; the guard blocks the common direct +
  redirect vectors. SearXNG (operator-configured `SEARXNG_URL`) and PageSpeed (Google
  fetches the target, not us) are not SSRF surfaces.
- **Cost/usage visibility:** runs record `{ provider, llmCalls, usedAI, sourcesFetched,
  cacheHits, durationMs }`; the run view shows a one-line usage summary, and crawl
  **cache hits** are tracked (the per-tenant `ResearchSourceCache` already shipped in RS-1).
- **Re-run:** `POST /research/runs/:id/rerun` clones a past run (same snapshot/inputs/
  subject); "Re-run" buttons on the run view (ready *and* failed).
- **First web tests:** `apps/web/lib/research-format.ts` (pure formatting/usage helpers)
  + `research-format.test.ts`, with the web `test` script wired to `tsx --test` — the
  module's first web-side tests, no React/DOM harness.
- **Scheduled / recurring re-research (Unit C):** the clock-driven twin of `/rerun`. A
  new `ResearchSchedule` model snapshots a run's params and re-enqueues it on a cadence
  (`daily`|`weekly`|`monthly`). `startResearchScheduleWorker` (`core/research/schedule.ts`)
  drains due rows on a 60s tick, claiming each atomically (advances `nextRunAt` before
  enqueue) so an overrun/second instance can't double-run. Managed via
  `POST`/`GET /research/runs/:id/schedule` (one schedule per subject — re-posting updates
  it) and `GET /research/schedules` + `PATCH`/`DELETE /research/schedules/:id` (creator or
  `manage_research`). An **Auto-refresh** control on the run view drives it.

## 10. Non-goals (v1)

- No Python scrape-worker sidecar (revisit only if TS scraping quality is insufficient).
- No managed/paid search API (SearXNG is the default).
- No DOCX output (PDF/CSV/HTML only — reuses existing branded export; DOCX can follow).
- No customer-facing self-serve crawl of arbitrary authenticated sites.
