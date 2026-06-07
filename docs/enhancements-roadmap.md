# Enhancements Roadmap (E-series)

> Product enhancement plan derived from the stakeholder `Enhancements.docx` brief, analysed
> against the live codebase, with external research. Each item has a stable ID (`E-NN`) tracked
> to a GitHub issue. This document is the canonical reference linked from every E-series issue.
>
> **Generated:** 2026-06-05 · **Branch:** `claude/practical-ride-rc4Au` · **Tracking epic:** #104
> **Convention:** mirrors the prior `F-NN` audit series (`docs/findings-and-enhancements.md`, #48–#82).

---

## 0. How to read this

- Severity here is **product priority**, not a defect grade: 🔴 structural / high-leverage ·
  🟠 feature depth · 🟡 fix / polish.
- Every item maps **Ask → Reality in code (file:line) → Proposal → Acceptance criteria**.
- "Reality in code" was verified by exploring `apps/web` and `apps/api`; file/line refs are
  accurate as of the generation date and may drift as the code changes.
- Four cross-cutting decisions were confirmed with the stakeholder up front — see §2.

---

## 1. Executive summary

The brief asks for a shift from a **hospitality-shaped demo shell** toward a **clean, industry-agnostic,
white-label operations platform** — fewer but deeper modules, a real CRM surface, provider-managed
provisioning (the ServiceNow "instance" model), wider white-labelling, and self-serve reporting.

Three themes run through it:

1. **Consolidate the surface area.** 15 flat nav items → 7 modules with landing screens; merge
   overlapping features (Campaigns + Upsell); unify CRM; split Integrations out of an overloaded
   Settings page.
2. **Own the white-label / provisioning layer.** Take industry selection and custom domains *out*
   of the customer's hands (we provision per the deal), and widen branding well beyond logo + colours.
3. **Make data honest and queryable.** Insights and reports for *all* industries, on real data, with
   date-range filtering and a user-built report builder.

Good news from the analysis: several asks are **lighter than they look** because the backend already
supports them (the Smart Insights backend is already industry-agnostic; CRM models already carry
`customFields`/`tags`/`source`; deals are already seeded). Those become wiring/UX tasks rather than
rewrites.

---

## 2. Cross-cutting decisions (confirmed with stakeholder)

| Decision | Choice | Affects |
|---|---|---|
| **Navigation IA** | Approve consolidation of 15 flat items → **7 modules** with landing screens | E-2, E-4, E-5, E-16 |
| **Provisioning model** | Industry + custom domain + white-label tier are **provider-managed** via an **internal super-admin console** (ServiceNow instance model). Customer UI is read-only. | E-8, E-9, E-10 |
| **White-label scope** | Widen to **all four**: branded email/domain, branded PDF/exports, theme tokens/custom CSS, branded login/loading | E-9, E-12 |
| **Reporting scope** | Build **both now**: date-range filters **and** a custom report builder | E-15, E-16 |

### 2.1 Approved navigation IA

```
Dashboard            ← Smart Insights lives here (E-1)
Service Requests     ← + live feed (Operations)
CRM            ▸     Contacts · Companies · Deals · Tasks            (E-4)
Marketing      ▸     Campaigns (incl. Upsell) · Automations · Sequences · Templates
Analytics      ▸     Revenue · Sentiment · Staff Performance · Reports   (E-16)
Integrations         ← split out of Settings (E-5)
Settings
```

15 items → 7. Campaigns + Upsell merged; CRM unified; Reports is new under Analytics; Integrations
promoted out of Settings. Each module opens a **landing screen** with sub-tabs. The tree is driven
from `apps/web/lib/industry-config.ts` so every vertical inherits the same skeleton with its own
terminology, and RBAC continues to hide modules/sub-items the user can't access
(`app-shell.tsx` → `getAllowedNavItems()`).

---

## 3. External research (informing the issues)

### 3.1 User impersonation (E-6) — how ServiceNow does it
When impersonating, the admin sees **exactly** what the target user can access (same menus/modules);
actions are recorded as the impersonated user; ending impersonation returns you to your own account
instantly; scope-protected / elevated roles are stripped during impersonation. Impersonation requires
an explicit impersonator role.

> Sources: [ServiceNow platform admin docs](https://www.servicenow.com/docs/bundle/xanadu-platform-administration/page/administer/users-and-groups/concept/c_ImpersonateAUser.html),
> [s2-labs: Impersonate User](https://s2-labs.com/servicenow-admin/servicenow-impersonate-user/)

**Implication for Eynis:** today's "Preview As Role" is client-side `localStorage` — not authoritative.
Real impersonation must be **server-side** (a signed token carrying `actingAsUserId` + the original
admin id), permission-gated, tenant-scoped, and fully audit-logged.

### 3.2 White-label architecture (E-9, E-10)
A robust white-label SaaS goes beyond logo + colours: tenant-level branding with **custom CSS/fonts**,
**configurable feature toggles per tenant**, and **white-labelled system artifacts** (emails, SMS,
PDFs/reports). Custom-domain support is table-stakes but requires a reverse-proxy host→tenant map
**plus automated SSL provisioning** — operational work best owned by the provider, not the customer.

> Sources: [DevelopEx: scalable white-label SaaS](https://developex.com/blog/building-scalable-white-label-saas/),
> [Domo: white-labeled BI](https://www.domo.com/glossary/what-is-a-white-labeled-bi-tool)

### 3.3 CRM grid UX (E-4)
Leading CRMs treat the **grid as the primary surface**: inline cell editing, per-column typing,
multiple views (grid/kanban/calendar/gallery), powerful filter/sort/group, saved views, bulk edit,
column chooser, and CSV/Excel **import (with field mapping) + export**.

> Sources: [Airtable support](https://support.airtable.com/docs/integrating-hubspot-with-airtable),
> [Zoho blog: Airtable for Zoho CRM](https://www.zoho.com/blog/marketplace/app-spotlight-airtable-appiworks-for-zoho-crm.html)

---

## 4. Master enhancements list

Issue numbers: **E-N → #(87+N)** (E-1 → #88 … E-16 → #103). Epic: **#104**.

| ID | Pri | Area | Enhancement | Issue |
|---|---|---|---|---|
| E-1 | 🟠 | AI / Dashboard | Rename → "Smart Insights"; all-industry; generate on demand from real data | #88 |
| E-2 | 🔴 | Navigation / IA | Consolidate 15 nav items → 7 modules with landing screens | #89 |
| E-3 | 🟡 | Seed / CRM | Seed visible demo data into Deals | #90 |
| E-4 | 🔴 | CRM | Unify CRM + spreadsheet grid + import/export | #91 |
| E-5 | 🟠 | Integrations | Promote Integrations to its own module (tiles + connect modal) | #92 |
| E-6 | 🟠 | RBAC / Admin | Real user impersonation under Profile (replace "preview role") | #93 |
| E-7 | 🟠 | Campaigns | Dynamic A/B testing (user-defined N variants) | #94 |
| E-8 | 🔴 | Provisioning | Remove customer industry switcher → internal provisioning console | #95 |
| E-9 | 🔴 | White-label | Widen white-label (email/domain, PDF/exports, theme tokens/CSS, login/loading) | #96 |
| E-10 | 🟠 | Provisioning | Custom domain provider-managed (remove self-serve CNAME) | #97 |
| E-11 | 🟡 | White-label | Remove hardcoded "The Riviera Details" from Settings | #98 |
| E-12 | 🟡 | White-label / UX | Fix Eynis branding flash on load/refresh | #99 |
| E-13 | 🟠 | UX/UI | UX/UI overhaul epic (simpler, easier, more capable) | #100 |
| E-14 | 🟡 | Analytics | Sentiment Trends across all industries | #101 |
| E-15 | 🟠 | Analytics | Date-range filters on all report tabs | #102 |
| E-16 | 🔴 | Reporting | Reporting module + custom report builder | #103 |

---

## 5. Detail per enhancement

### E-1 · Smart Insights (#88) — 🟠
- **Ask:** rename "AI Morning Briefing" → "Smart Insights"; available for all industries; generate
  real-data insights on a button click.
- **Reality:** `apps/web/components/ui/ai-morning-briefing.tsx` (hospitality copy: "GM Top Priority",
  `guestExperienceNote`), dashboard-only (`apps/web/app/dashboard/page.tsx:83`). Backend
  `generateMorningBriefing()` (`apps/api/src/core/ai/intelligence.ts:407`) is **already
  industry-agnostic**; route `GET /ai/morning-briefing` (`server.ts:2565`).
- **Proposal:** rename everywhere; neutral industry-config-driven labels; explicit "Generate insights"
  action with loading + last-generated timestamp; real per-tenant aggregates with honest
  "not available" for missing metrics; keep Claude/GPT toggle.
- **Acceptance:** no "Morning Briefing"/"GM" strings; works on every industry; AI called on click;
  no fabricated metrics.

### E-2 · Nav consolidation (#89) — 🔴
- **Ask:** merge too-many options into modules, each with a landing screen; explicitly merge
  Upsell + Campaigns under a Marketing module.
- **Reality:** 15 flat items in `apps/web/lib/industry-config.ts:55-71`; rendered + RBAC-filtered in
  `apps/web/components/ui/app-shell.tsx:388-403`.
- **Proposal:** the approved 7-module IA (§2.1), config-driven, with landing screens, RBAC preserved,
  old routes redirected.
- **Acceptance:** 7 modules; expandable sub-items + landing screens; Campaigns/Upsell merged; RBAC
  intact; old routes resolve.

### E-3 · Deals demo data (#90) — 🟡
- **Ask:** put demo data in Deals.
- **Reality:** `apps/api/prisma/seed.ts:508-566` already seeds ~9 deals (default "Sales Pipeline",
  6 stages) for `eynis-riviera-1` — but they don't render on the live demo. Likely the deployed demo
  DB predates migration `20260605090043_add_crm_pipeline_deals`, or the board loads a different default
  pipeline than the seeded one.
- **Proposal:** verify root cause; ensure a populated multi-stage pipeline renders on first load; make
  seed idempotent so existing demos backfill.
- **Acceptance:** fresh seed → populated board; deals have owner + contact/company + value + close date;
  confirmed on the live demo.

### E-4 · Unified CRM + grid + import/export (#91) — 🔴
- **Ask:** one CRM module; responsive table-like grid (reference screenshot); import/export; research
  Airtable/Zoho/HubSpot.
- **Reality:** 4 separate nav items; Deals = kanban only (`deals-board-client.tsx`); Contacts/Companies
  basic lists; no grid, no inline edit, no import/export. Models already support it
  (`schema.prisma:148-204, 876-909` — `customFields`, `tags`, `ownerId`, `source`).
- **Proposal:** one CRM module (tabs); a shared responsive `<DataGrid>` with per-column search, sort,
  inline edit, column chooser, saved views, bulk actions; keep kanban as an alternate Deals view; CSV/Excel
  import with field mapping; CSV export of the filtered view. Evaluate shadcn table primitives (MCP configured).
- **Acceptance:** single CRM module; grid features above; import/export; Deals retains kanban; mobile-responsive.
- **Research:** §3.3.

### E-5 · Integrations module (#92) — 🟠
- **Ask:** split Integrations out of Settings; large square tiles (logo, description, requirements,
  Connect button); Connect → modal capturing required fields.
- **Reality:** cramped table inside `apps/web/app/settings/page.tsx:204-239`. Connector registry inline
  in `apps/api/src/server.ts`; per-tenant overrides via `PUT /connectors/configs/:key` (secrets masked).
- **Proposal:** new top-level Integrations module; data-driven tiles (add `description`/`requiredFields`/
  `logoUrl` to the registry); Connect modal saves to `ConnectorConfig`; grouped by category.
- **Acceptance:** Integrations is its own route, removed from Settings; tiles with connect modal; secrets masked.

### E-6 · User impersonation (#93) — 🟠
- **Ask:** replace "preview role" with "preview user" (inherit their role); end impersonation back to
  self; move under Profile as an "Impersonation" tab; ServiceNow-style modal.
- **Reality:** `RoleSwitcher` client-side `localStorage` role preview (`app-shell.tsx:73-177`); the
  "exit preview" flow is already buggy (closed **#15**).
- **Proposal:** server-authoritative impersonation (signed token w/ `actingAsUserId` + original admin id),
  permission-gated (`impersonate`), tenant-scoped, audit-logged; Profile → Impersonation tab → modal
  (user search + recent impersonations); persistent banner + reliable "Stop impersonating".
- **Acceptance:** "Preview As Role" removed; impersonation reflects target's real permissions enforced
  server-side; reliable stop (closes #15 behaviour); audit-logged.
- **Research:** §3.1.

### E-7 · Dynamic A/B (#94) — 🟠
- **Ask:** make A/B dynamic — user chooses how many variants (1..N).
- **Reality:** hardwired two variants — `voiceA/voiceB`, `personaA/personaB`, `vapiAssistantIdA/IdB`
  (`schema.prisma:484-538`); `abVariant: "A"|"B"` on leads/calls; builder
  (`campaign-builder.tsx:188-200`) and two-arm z-test analytics (`campaign-analytics-tab.tsx`).
- **Proposal:** new `CampaignVariant` child table (voice/persona/script/weight/assistantId); migrate A/B
  rows; lead/call FK to `variantId`; weighted assignment; dynamic add/remove variants in builder; N-arm analytics.
- **Acceptance:** add/remove 1..N variants; weighted distribution; N-arm analytics; existing A/B migrated.

### E-8 · Industry via provisioning console (#95) — 🔴 ✅ implemented
- **Ask:** industry selection is ours to set at onboarding, not the customer's (ServiceNow instance model).
- **Reality:** customer-facing `change-industry.tsx` switcher (`settings/page.tsx:91-105`); `Tenant.industry`
  (`schema.prisma:17`).
- **Proposal:** remove the customer switcher; internal super-admin console sets `Tenant.industry` (staff-only,
  cross-tenant, audit-logged); customer sees read-only industry. Shared console with E-9/E-10.
- **Acceptance:** customers can't switch industry; internal console sets it; read-only "managed by us" note; staff-only + audited.
- **Done:**
  - Customer switcher removed; `change-industry.tsx` deleted. Settings shows industry **read-only** with a neutral
    "managed for you — contact support" note (no hardcoded "Eynis", per the white-label principle).
  - New **platform-staff identity** (`apps/api/src/core/platform-admin.ts`, gated by `PLATFORM_ADMIN_SECRET`),
    completely separate from tenant JWT/RBAC. Internal routes `GET /internal/tenants` and
    `PATCH /internal/tenants/:id/industry` (validated against `core/industries.ts`, **audit-logged** as
    `actorRole: "platform_staff"`, action `tenant.industry_changed`).
  - **Internal console** at `apps/web/app/admin/provisioning` (shared surface for E-9/E-10): secret-gated login →
    httpOnly cookie; server-side proxies keep the API secret out of the browser; cross-tenant industry table.
  - API tests: `apps/api/src/core/platform-provisioning.test.ts` (auth-gating, validation, update + audit, 404).

### E-9 · Wider white-label (#96) — 🔴 ⏳ core slice landed
- **Ask:** white-label should be wider; research; proper architecture.
- **Reality:** `TenantBranding` (`schema.prisma:106-122`) = name/tagline/logo/favicon/primary+accent/support
  email/hidePoweredBy. Theme resolution in `apps/web/lib/theme.ts`.
- **Proposal (all four, confirmed):** branded email + sending domain (see `docs/email-deliverability-design.md`);
  branded PDF/exports/reports; theme tokens / custom CSS & fonts; branded login/loading/invite/public pages.
  White-label **tier** set via the provisioning console.
- **Acceptance:** `TenantBranding` extended + migration; artifacts brand-correct (zero hardcoded "Eynis");
  login/loading branded; sanitised custom CSS; tier-gated.
- **Research:** §3.2.
- **Done (core slice):**
  - `Tenant.whitelabelTier` (`standard` / `white_label`) + extended `TenantBranding`
    (`sidebarColor`, `fontFamily`, `brandEmails`, `brandReports`) + migration `20260607000000_widen_white_label`.
  - Tier modelled in `core/whitelabel.ts`; set via the provisioning console
    (`PATCH /internal/tenants/:id/whitelabel-tier`, audit-logged) + a tier column in the console UI.
  - `resolveTheme(branding, industry, tier)` widened; deep overrides (font, sidebar token, hide
    "powered by") **gated to `white_label`**. New CSS vars `--font-brand`, `--color-sidebar`.
  - Branding panel edits the new fields; premium controls disabled below the white_label tier.
  - Branded email wrapper (`core/email/branding.ts`, tier-gated "powered by", `brandEmails` flag);
    branded night-audit report header (`brandReports` flag).
  - Invite + public `/request` pages now carry the tenant brand (`resolveHostTheme`); hardcoded "Eynis"
    removed from invite / global-error / branding panel.
- **Deferred (fast-follows):** sanitised raw **custom CSS** (only structured tokens + font landed);
  real **PDF / CSV export** renderer (no PDF lib yet — header brands the in-app/print view);
  per-tenant **email sending domain** (deliverability "Phase 3" in `docs/email-deliverability-design.md`).

### E-10 · Custom domain provider-managed (#97) — 🟠
- **Ask:** don't give customers self-serve custom domains; we set them up (or optionally offer it).
- **Reality:** customer self-serve `domains-panel.tsx` + `GET/PUT /tenant/domains`; `Tenant.slug`/`customDomain`;
  `GET /tenant/resolve?host=` for host→tenant.
- **Proposal:** remove self-serve (or make it read-only + "request a domain"); set slug/customDomain in the
  provisioning console with DNS/SSL steps tracked; keep host resolution working.
- **Acceptance:** no arbitrary self-set CNAME; console sets domain + documents DNS/SSL; subdomain + custom domain both resolve.
- **Research:** §3.2.

### E-11 · Remove "Riviera Details" (#98) — 🟡
- **Ask:** the hardcoded Riviera details make no sense — fix.
- **Reality:** `apps/web/app/settings/page.tsx:134,144-183` — section titled "The Riviera Details",
  placeholder `vikram@theriviera.com`.
- **Proposal:** drive property/profile from the current tenant + industry terminology (`propertyLabel`);
  neutral/real values; audit the page for other literals.
- **Acceptance:** no "Riviera"/`theriviera.com` strings; tenant-driven section title + fields.

### E-12 · Branding flash on load (#99) — 🟡
- **Ask:** on refresh/tab-switch the screen flashes "Eynis / Hotel & Resort Intelligence" before the
  tenant brand loads (screenshot) — fix.
- **Reality:** theme resolved in `app-shell.tsx` (~`:275`); `apps/web/app/loading.tsx` neutral spinner;
  the sidebar brand block paints the Eynis/industry fallback before `TenantBranding` applies (FOUC).
- **Proposal:** resolve tenant branding server-side before first paint, or render a neutral/tenant skeleton —
  never the Eynis fallback; loading screen tenant-branded or neutral.
- **Acceptance:** no "Eynis"/"Hotel & Resort Intelligence" flash for a branded tenant.

### E-13 · UX/UI overhaul epic (#100) — 🟠
- **Ask:** better and easier design + usability — more features but easy.
- **Workstreams:** IA (E-2); a consistent component system (shadcn primitives for tables/modals/tabs/forms);
  density & progressive disclosure on dense pages (Settings, Campaign builder, Dashboard); responsiveness &
  accessibility; friendly branded empty/loading/error states; a per-module "UX bar".
- **Acceptance:** documented design principles; each module passes the UX bar; no raw/unstyled tables or modals.

### E-14 · Sentiment in all industries (#101) — 🟡
- **Ask:** Sentiment Trends should be in all industries.
- **Reality:** present only in hospitality `navItems` (`industry-config.ts:55-71`); `SentimentEvent`
  (`schema.prisma:737-753`); `GET /analytics/sentiment` (`server.ts:2480`).
- **Proposal:** add to every industry (under Analytics, E-2); neutral copy; verify endpoint returns real
  data for non-hospitality tenants.
- **Acceptance:** visible for every industry; neutral copy; real data for non-hospitality.

### E-15 · Date-range filters on reports (#102) — 🟠
- **Ask:** all report tabs need a date-range filter to query past data.
- **Reality:** sentiment fixed 30-day; night audit "today" + latest-only (`server.ts:2754,2860`); revenue
  no filter (`server.ts:1740`); staff/upsell no filter.
- **Proposal:** date-range control (Today/7d/30d/90d/custom) on every report tab; thread `from`/`to` through
  each endpoint; browsable night-audit history.
- **Acceptance:** every report tab has the control; endpoints accept `from`/`to`; night-audit history browsable;
  defaults preserve current behaviour.

### E-16 · Reporting module + report builder (#103) — 🔴
- **Ask:** a reporting module; let users build & customise their own reports (ServiceNow-style). Confirmed: build now.
- **Proposal:** Reports landing (saved + system reports); builder (pick source → columns/metrics → filters incl.
  date range → group/sort → visualization); save/run/share/export (tenant-branded per E-9); new `Report`
  (definition JSON) model + executor; permission-gated + tenant-scoped + RBAC-respecting.
- **Phasing:** A) definition model + table-only builder over 2–3 core sources + save/run. B) charts, sharing,
  branded export, more sources.
- **Acceptance:** Reports module lists saved+system; builder as above; save/run/share/export; definitions
  persist and execute against real RBAC-respecting data.

---

## 6. Suggested sequencing

1. **Quick white-label fixes:** E-11 (#98), E-12 (#99) — visible, low-risk.
2. **Structure:** E-2 (#89) nav → unlocks E-4 (#91 CRM), E-5 (#92 Integrations), E-16 (#103 Reports under Analytics).
3. **Provisioning console** (one shared surface): E-8 (#95), E-10 (#97), and the white-label tier of E-9 (#96).
4. **Feature depth:** E-1 (#88), E-3 (#90), E-6 (#93), E-7 (#94), E-14 (#101), E-15 (#102).
5. **Big builds:** E-9 (#96 full white-label), E-16 (#103 report builder), E-13 (#100 UX, ongoing).

---

## 7. Relationship to the prior audit (`F-NN`)

Some E-items touch areas the closed `F-NN` audit already hardened — build on those, don't redo them:
- **E-1/E-14/E-15** sit on top of the **F-17** fix (analytics now compute real aggregates or honest nulls).
- **E-11/E-9** continue the **F-20/F-21** white-label de-hardcoding (the Settings "Riviera" instance remained).
- **E-6** fixes the same behaviour as closed issue **#15** ("Role Impersonation does not end").
