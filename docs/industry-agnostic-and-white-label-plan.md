# Industry-Agnostic & White-Label — Architecture & Execution Plan

_Status: **core shipped** (July 2026) · Authored Jun 2026. The platform layer is
built and merged (E-8 … E-16): the `Hotel→Tenant` / `Guest→Contact` model rename
(via `@@map`, no data migration), per-tenant branding + theming with tier gating
(`core/whitelabel.ts`, `apps/web/lib/theme.ts`), custom domains, and the
provisioning console (`apps/web/app/admin/provisioning`). Remaining gaps are
vertical depth (non-hospitality ops pages are still demo stubs) and residual
hotel-shaped types/copy — tracked in `docs/improvement-plan-2026-07.md`. It
scopes two committed product directions from `CLAUDE.md` → Product Principles:_

1. **Industry-agnostic** — Eynis serves many industries; nothing new should assume
   hospitality.
2. **White-label by default** — customers run Eynis as *their own* product
   (branding, domain, email).

> Nothing here is built yet. Sections marked **Today** describe current behaviour
> (verified against the codebase); everything else is proposed.

---

## 1. Why this doc exists

Eynis began as a hotel product and the **presentation layer** has since been
generalised (5 industries, per-industry navigation + terminology). But the
**foundation is still hospitality-shaped**: the tenant entity is literally
`Hotel`, the contact entity is `Guest`, the canonical roles are front-desk /
housekeeping, and "branding" is derived from *industry*, not from the *tenant*.

That mismatch is invisible in a demo and expensive later: every hospitality
assumption we add now is another thing to unwind when a manufacturing or
healthcare customer onboards under their own brand. This plan makes the two
principles concrete, inventories the coupling, and sequences the work so it can
ship incrementally without a big-bang rewrite.

---

## 2. Current state — what's already agnostic vs. coupled

### 2.1 Already industry-neutral ✅ (Today)
- **Per-tenant industry field.** `Hotel.industry` (`schema.prisma`, default
  `"hospitality"`) already tags each tenant with an industry. Tenant→industry is
  data-driven at the row level.
- **Per-industry presentation.** `apps/web/lib/industry-config.ts` defines, per
  industry: `name`, `tagline`, `accentColor`, `navItems`, **`terminology`**
  (`entity`, `entityPlural`, `request`, `property`, `team`), and onboarding
  questions. Five industries today: hospitality, manufacturing, fnb, travel,
  healthcare.
- **Industry-specific dashboards** exist (`manufacturing-dashboard.tsx`,
  `healthcare-dashboard.tsx`, `travel-dashboard.tsx`, `fnb-dashboard.tsx`).
- **Newer RBAC is org-shaped.** A per-tenant `Role` model (`key`, `displayName`,
  `permissions`, `isSystem`/`isCustom`) and an `orgRole` concept in the web shell
  already layer a generic, permission-based role system over the legacy roles.
- **The web shell partially speaks "org"** — it fetches `orgRole`, `industry`,
  `propertyName` from an org-context endpoint and themes from
  `config.accentColor` via a `--color-industry` CSS variable.

### 2.2 Hospitality coupling that must change ❌ (Today)
| Area | Coupling | Where |
|---|---|---|
| **Tenant entity** | Model is named `Hotel` | `schema.prisma:10`; ~700 `hotel` refs across API + web |
| **Contact entity** | Model is named `Guest` (`fullName`, `phoneE164`, `visitCount`) | `schema.prisma:63` |
| **Hospitality domain models** | `Stay`, `ServiceRequest`, `NightAuditReport`, `OfferEvent`, `SentimentEvent` are hospitality-framed | `schema.prisma` |
| **Canonical roles** | `UserRole = "owner" \| "front_desk" \| "housekeeping" \| "fnb_manager"` — hospitality job titles, baked into the **shared** package | `packages/shared/src/index.ts:1` |
| **Shared interfaces** | `Hotel`, `Guest`, `ServiceRequest` shapes exported from shared | `packages/shared/src/index.ts` |
| **Fixed industry list** | `Industry` is a hardcoded TS union of 5 — adding an industry is a code change | `industry-config.ts:10` |
| **JWT claims** | `{ sub, hotelId, email, role }` — `hotelId` naming | `server.ts` `getAuthenticatedContext` |
| **Env / helpers** | `EYNIS_DEMO_HOTEL_ID`, `ensureHotelAccess`, `upsertGuestByPhone` | `server.ts`, CLAUDE.md |
| **Branding source** | "Brand" = industry accent + industry tagline + a generic icon; **no per-tenant logo/colors** | `app-shell.tsx` (`brand-logo`, `config.tagline`) |
| **Demo/sample copy** | "The Riviera", "ITC Hotels" hardcoded in seed + notifications | seed, `app-shell.tsx` |

### 2.3 White-label gaps ❌ (Today)
- Branding is **industry-derived, not tenant-derived**: every hospitality tenant
  gets the same teal + "Hotel & Resort Intelligence" tagline and a generic logo
  glyph. There is no per-tenant brand name, logo, color, favicon, or custom app
  domain.
- Email identity is single shared `eynis.com` (see
  `docs/email-deliverability-design.md`); white-label needs per-tenant sending
  domains.
- Auth pages (Clerk) and the "Eynis" wordmark are not themeable per tenant.

---

## 3. Target architecture

### 3.1 Vocabulary
Adopt neutral domain language in all **new** code, and migrate existing names over
time:

| Hospitality term | Neutral term | Notes |
|---|---|---|
| Hotel | **Tenant** (a.k.a. Organization) | the billable, isolated account |
| Guest | **Contact** | the end customer a tenant engages |
| Stay | **Engagement / Visit** | industry module, not core |
| Service Request | **Request** | already partly generic |
| front_desk / housekeeping | permission-based **Roles** | retire the union |
| Property | **Location / Site** | per-industry label via `terminology` |

### 3.2 Three layers, cleanly separated
```
┌─────────────────────────────────────────────────────────────┐
│ CORE (industry-neutral)                                      │
│   Tenant, User, Role, Contact, Request, Campaign, Connector, │
│   MessageDelivery, AuditLog, Billing/License …               │
├─────────────────────────────────────────────────────────────┤
│ INDUSTRY MODULES (gated per tenant.industry)                 │
│   hospitality: Stay, NightAudit, ServiceRequest flavour      │
│   manufacturing: WorkOrder, Inventory …                      │
│   healthcare: Appointment, Patient flavour …                 │
├─────────────────────────────────────────────────────────────┤
│ TENANT BRANDING (white-label, overrides industry defaults)   │
│   brandName, logo, colors, emailDomain, appDomain, wordmark  │
└─────────────────────────────────────────────────────────────┘
```
- **Core** is what every tenant has, named neutrally.
- **Industry modules** are opt-in capabilities selected by `tenant.industry` (or,
  later, a per-tenant module list). Night Audit, Stays, etc. live here and are
  hidden for industries that don't use them.
- **Tenant branding** is the white-label layer; it overrides the industry's
  default theme.

### 3.3 Data-driven industries
Move the fixed `Industry` union toward configuration so a new industry doesn't
require a code release:
- Short term: keep the TS config but treat `Hotel.industry` as the source of
  truth and ensure every consumer reads terminology/nav from config (no inline
  "Guest"/"Hotel" strings).
- Longer term: an `Industry` table (or a versioned config blob) so industries —
  and their nav/terminology/modules — are editable without a deploy.

---

## 4. Workstream A — Industry-agnostic

### 4.1 The `Hotel → Tenant` rename (the big one)
~700 references. Three strategies, in increasing ambition:

**Option 1 — Prisma model rename with table `@@map` (recommended core move).**
```prisma
model Tenant {
  // …fields…
  @@map("Hotel")   // underlying table stays "Hotel" → NO data migration
}
```
- The **database table is untouched** (zero-downtime, no migration risk on data).
- The **Prisma client API changes** (`prisma.hotel` → `prisma.tenant`), so every
  call site updates — mechanical, compiler-guided, but broad (~hundreds of sites).
- Field `hotelId` can stay as the column name initially (`@map("hotelId")`) and
  be renamed later; the relation scalar in code can become `tenantId` gradually.
- **Net:** big code diff, near-zero data risk. Do it in one focused PR per layer
  (api core, then web) behind a green test suite (178 API tests are the safety
  net).

**Option 2 — Domain alias layer (incremental, no Prisma change yet).**
Introduce a thin `core/tenant` module that re-exports tenant operations with
neutral names, and adopt it in **new** code only. Existing `prisma.hotel` calls
stay until Option 1 is scheduled. Lowest immediate churn; leaves duality longer.

**Option 3 — Full rename incl. table + columns.**
`@@map`-free true rename via a Prisma migration that `ALTER TABLE`s. Cleanest end
state, highest risk (data migration, FK churn). Only worth it once Option 1 is
proven and we want to drop the legacy table name.

> **Recommendation:** Option 2 immediately (stop the bleeding — new code is
> neutral), Option 1 as a scheduled initiative (rename the Prisma model with
> `@@map`), defer Option 3 indefinitely (table name is cosmetic once the client
> API is neutral).

### 4.2 `Guest → Contact`
Same pattern as 4.1 but smaller blast radius (`Guest` has fewer relations: Stay,
ServiceRequest). Rename `model Guest` → `model Contact @@map("Guest")`; generalise
fields (`fullName` → `displayName`, keep `phoneE164`, add optional `email`,
`externalId`). Hospitality-specific `visitCount` moves to the Stay/engagement
module.

### 4.3 Retire the hospitality `UserRole` union
- The `Role` model + `orgRole`/permissions system is the future. Treat
  `UserRole = owner|front_desk|housekeeping|fnb_manager` as **legacy** and stop
  referencing it in new code.
- Provide **industry-default role sets** seeded into the `Role` table per tenant
  (hospitality seeds front_desk/housekeeping; manufacturing seeds
  supervisor/operator; etc.) instead of a hardcoded union.
- `policyMap` in `server.ts` migrates from role-name checks to **permission**
  checks (`canAccessRoute` already exists on the web side — mirror server-side).
- Keep the union as a deprecated alias during transition so existing JWTs/tests
  keep working.

### 4.4 Reframe hospitality features as modules
`Stay`, `NightAuditReport`, hospitality-flavoured `ServiceRequest`, `OfferEvent`,
`SentimentEvent` become **industry modules**:
- Gate their nav entries and routes by `tenant.industry` (the nav already comes
  from `industry-config`; ensure the *API routes* are also capability-gated, not
  just hidden in the UI).
- A `tenant.modules` list (derived from industry, overridable) decides which
  capabilities are active. This lets a hospitality tenant keep Night Audit while a
  factory never sees it.

### 4.5 Copy & seed data
- Remove hardcoded hospitality strings from non-hospitality paths (e.g. the
  `app-shell` notifications referencing "ITC Hotels"; seed "The Riviera").
- All entity/role/request labels must come from `industry-config.terminology`,
  never inline literals.

---

## 5. Workstream B — White-label

### 5.1 Per-tenant branding model (new)
```prisma
model TenantBranding {
  id            String   @id @default(cuid())
  tenantId      String   @unique
  tenant        Tenant   @relation(fields: [tenantId], references: [id], onDelete: Cascade)

  brandName     String?  // overrides the industry tagline / "Eynis" wordmark
  logoUrl       String?  // tenant logo (sidebar, emails, auth)
  faviconUrl    String?
  primaryColor  String?  // overrides industry accentColor
  accentColor   String?
  // Domains
  appDomain     String?  // custom app host, e.g. app.acme.com (CNAME → Eynis)
  emailDomain   String?  // see email-deliverability-design.md (Resend domains)
  supportEmail  String?
  // White-label toggles
  hidePoweredBy Boolean  @default(false)
  customCss     String?  // escape hatch, sanitised

  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
}
```

### 5.2 Theming pipeline
Today `app-shell` sets `--color-industry` from `industry-config`. Generalise to a
**resolved theme** with precedence:

```
tenant branding  ▶ overrides ▶  industry default  ▶ overrides ▶  Eynis fallback
```
- Resolve once (server component / org-context endpoint) into a `ResolvedTheme`
  `{ brandName, logoUrl, faviconUrl, primaryColor, accentColor, … }`.
- Inject as CSS variables (`--color-primary`, `--color-accent`, `--brand-*`) at
  the shell root so every component (including the new design system in
  `components/ds`) reads tenant theme automatically.
- The DS tokens (`components/ds/tokens.ts`) should consume these CSS variables so
  white-label theming flows through the whole UI for free.

### 5.3 White-label dimensions (checklist)
| Dimension | What changes | Depends on |
|---|---|---|
| App branding | logo, brand name, colors, favicon | 5.1, 5.2 |
| Email identity | per-tenant sending domain + from-name | `email-deliverability-design.md` |
| Custom app domain | `app.acme.com` → Eynis (CNAME + TLS), tenant resolved by host | host-based tenant resolution |
| Auth pages | Clerk appearance theming / hosted pages per tenant brand | Clerk config |
| "Powered by Eynis" | toggle off for white-label tiers | `hidePoweredBy`, billing tier |
| Transactional copy | sender name, footer, support email | 5.1 |
| Assets | logo/favicon upload + storage (e.g. S3/R2) + CDN | object storage |

### 5.4 Tenant resolution by host (custom domains)
For `appDomain`, the web must map an incoming host → tenant before auth UI
renders (to theme the login page). Add a host→tenant lookup (cached) in
middleware; fall back to the Eynis default host. This is the web analogue of the
email custom-domain work.

---

## 6. Cross-cutting concerns

- **Multi-tenant isolation is unchanged.** Every query already scopes by
  `hotelId`/tenant id from the JWT; renames keep that invariant. Branding and
  module gating are *additional* per-tenant reads, not new trust boundaries.
- **JWT claims.** Optionally rename `hotelId` → `tenantId` (keep `hotelId` as a
  deprecated alias in the claim for one release so old tokens validate). Consider
  adding `industry` to claims to save a lookup, but it changes per tenant rarely —
  fetching from DB is fine.
- **Billing/License.** White-label level (e.g. custom domain, hide "powered by")
  should be a **licensed feature** — wire `hidePoweredBy`/`appDomain` to the
  `License`/`LicenseFeature` system so it's a paid tier, not a free toggle.
- **Testing.** The 178-test API suite (hits real DB, no mocking) is the safety net
  for the renames — keep it green at every step; add tenant-branding and
  module-gating tests as those land.

---

## 7. Phasing & sequencing

Ordered for **incremental, low-risk** delivery. Each phase ships independently.

| Phase | Scope | Risk | Unlocks |
|---|---|---|---|
| **A0 — Stop the bleeding** | Adopt Product Principles (done in `CLAUDE.md`). New code uses neutral names + `industry-config.terminology`; no new hospitality literals. | none | Prevents the gap widening |
| **A1 — Branding model + theming** | `TenantBranding` model, resolved-theme pipeline, DS tokens read tenant CSS vars, logo/colors/brand-name in the shell. | low | Visible white-label of the app UI |
| **A2 — Email white-label** | Per-tenant sending domain (Phase 1 of the email doc: setup form + bounce handling, domain-aware). | med | White-label email |
| **A3 — Role decoupling** | Permission-based `policyMap`; seed industry-default role sets; deprecate `UserRole` union. | med | Non-hospitality role models |
| **A4 — `Guest → Contact`** | Prisma rename via `@@map`, field generalisation, call-site sweep. | med | Neutral contact entity |
| **A5 — `Hotel → Tenant`** | Prisma rename via `@@map`, call-site sweep (api then web), JWT `tenantId` alias. | med-high (broad diff) | Neutral tenant entity |
| **A6 — Modules & data-driven industries** | Capability-gate hospitality features by industry/modules; move `Industry` toward DB/config. | med | Clean per-industry product |
| **A7 — Custom app domains** | Host→tenant resolution, CNAME/TLS, themed auth pages. | high (infra) | Full white-label (own domain end-to-end) |

> **Recommended start:** **A1 (branding model + theming)**. It delivers the most
> visible white-label value, is low-risk (additive, no renames), and builds the
> theme pipeline that A2/A7 plug into. The `Hotel → Tenant` rename (A5) is the
> heaviest and should be scheduled deliberately behind the green test suite — not
> interleaved with feature work.

---

## 8. Risks & mitigations

| Risk | Mitigation |
|---|---|
| `Hotel → Tenant` rename is a huge diff | Use `@@map` (no data migration); compiler-guided; one layer per PR; 178 tests green at each step |
| Two role systems during transition | Keep `UserRole` union as a deprecated alias; migrate `policyMap` to permissions behind tests |
| Branding precedence bugs (tenant vs industry vs fallback) | One pure `resolveTheme()` function with unit tests for every precedence case |
| Custom-domain TLS/host complexity | Defer to A7; start with subdomain-on-Eynis before full custom CNAME+cert automation |
| Hidden hospitality literals leak into other industries | Lint/grep gate in CI for inline "hotel"/"guest" in new files; everything via `terminology` |
| White-label as a free-for-all | Gate premium white-label (custom domain, hide powered-by) behind `LicenseFeature` |

---

## 9. Decisions & open questions

**Decided (Product Principles, `CLAUDE.md`):**
- Industry-agnostic and white-label are committed, standing requirements.
- Email white-label = per-tenant own domain (see `email-deliverability-design.md`).

**Open:**
- **Rename ambition:** are we content with Option 1 (`@@map`, table stays "Hotel")
  long-term, or do we want the table physically renamed eventually (Option 3)?
- **Org vs Location:** do we need a two-level hierarchy (Organization → multiple
  Locations/Sites) now, or is single-level Tenant enough until a multi-property
  customer appears? (`terminology.property` hints this will come.)
- **Module model:** is `tenant.industry` enough to gate features, or do we need an
  explicit per-tenant `modules[]` (e.g. a hotel that also runs a restaurant)?
- **White-label tiers:** which dimensions are free vs paid (logo/colors free,
  custom domain + hide-powered-by paid)?
- **Custom-domain infra:** managed TLS approach (e.g. Vercel domains API,
  Cloudflare for SaaS) — decide before A7.

---

## 10. Appendix — concrete coupling inventory (grep-derived)

- Tenant model: `schema.prisma:10` `model Hotel`; ~700 `hotel`/`guest` refs across
  `apps/api/src` (≈593) and `apps/web` (≈123).
- Contact model: `schema.prisma:63` `model Guest`.
- Hospitality modules: `Stay` (78), `ServiceRequest` (93), `NightAuditReport`
  (235), `OfferEvent` (132), `SentimentEvent` (550) — line refs in `schema.prisma`.
- Roles: `packages/shared/src/index.ts:1` `UserRole` union; `Role` model
  `schema.prisma:260`.
- Industry config: `apps/web/lib/industry-config.ts` (`Industry` union :10;
  `terminology` interface; 5 industry blocks).
- Branding/shell: `apps/web/components/ui/app-shell.tsx` (`config.accentColor`,
  `--color-industry`, `brand-logo`, hardcoded notifications).
- Design system tokens: `apps/web/components/ds/tokens.ts` (today mirrors
  `globals.css`; should consume resolved-theme CSS vars for white-label).
