# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Product Principles (read before designing anything)

These are standing directives — apply them to **every** new feature, schema change, doc, and UI.

1. **Industry-agnostic, not hospitality-specific.** Eynis began as a hotel product but is now a generic operations platform serving many industries (hospitality, manufacturing, F&B, travel, healthcare, and more via `apps/web/lib/industry-config.ts`). Design every new capability to work for *any* industry. Prefer neutral domain language (tenant/organization, contact/customer, request) over hospitality terms (hotel/guest) in new code, copy, and docs. NB: the code/models are now industry-neutral — `model Tenant` and `model Contact`, scoped by `tenantId` — but the underlying DB tables/columns stay `Hotel`/`Guest`/`hotelId` via Prisma `@@map`/`@map` (no data migration). Don't add *new* hospitality-specific assumptions.
2. **White-label by default.** Customers will rebrand and run Eynis as their own product. Anything customer-facing must be themeable per tenant (name, logo, colors, and **their own sending domain** for email — see `docs/email-deliverability-design.md`). Never hard-code "Eynis" branding or an `eynis.com` identity into customer-facing output.

## Commands

### Development
```bash
# Run API (port 4000) — Terminal 1
npm run dev -w @eynis/api

# Run web app (port 3000) — Terminal 2
npm run dev -w @eynis/web
```

### Build (order matters — shared must build first)
```bash
npm run build                        # All packages in correct order
npm run build -w @eynis/shared       # Shared types only
npm run build -w @eynis/api          # API only
npm run build -w @eynis/web          # Web only
```

### Testing & Lint
```bash
npm run test                         # All packages
npm run test -w @eynis/api           # API tests only (hits a real Postgres DB — no mocking)
npm run lint                         # TypeScript type-check across packages

# Run a single test by name (Node built-in test runner)
tsx --test --test-name-pattern="GET /health" apps/api/src/**/*.test.ts
```

### Database
```bash
npm run db:generate -w @eynis/api    # Regenerate Prisma client after schema changes
npm run db:migrate -w @eynis/api     # Apply migrations (creates new migration)
npm run db:seed -w @eynis/api        # Seed "The Riviera" demo hotel with full data
```

### Clean rebuild (when dependencies break)
```bash
# Windows
rmdir /s /q node_modules apps\api\dist apps\web\.next
del package-lock.json
npm install --legacy-peer-deps
npm run build
```

## Architecture

### Monorepo Structure
- **`apps/api`** — Node.js HTTP backend, no framework (`node:http` only)
- **`apps/web`** — Next.js 15 App Router frontend, React 19, Tailwind CSS
- **`packages/shared`** — Shared TypeScript types (`SystemRoleKey`, `Tenant`, `Contact`, `ServiceRequest`; `UserRole`/`Hotel`/`Guest` retained as deprecated aliases)

`@eynis/shared` is a build-time dependency of both `apps/api` and `apps/web`. Its `dist/` must exist before either can compile.

### API Server (`apps/api/src/server.ts`)
The entire API is one ~6900-line file with all routes as an `if/else` chain matching on `req.url` and `req.method`. There is no Express/Fastify — only `node:http`. The file exports both `buildServer()` (used by tests) and starts the server when `START_SERVER=true`.

**Route authorization pattern:**
1. `getAuthenticatedContext(req)` → verifies JWT, loads user + live permissions from DB
2. `canAccess(permissions, "METHOD /path")` → looks up the route's required permission in `policyMap` and checks the user has it
3. `ensureTenantAccess(tenantId)` → verifies the tenant exists

`policyMap` at the top of `server.ts` maps every route to the **permission** it requires (`null` = any authenticated user). RBAC is permission-based: generic system roles (`admin`/`manager`/`supervisor`/`agent`/`viewer`) carry permission sets in the `Role` table. The legacy hospitality role union (`owner`/`front_desk`/…) in `@eynis/shared` is **deprecated** and used only as a backward-compat fallback.

**All API responses follow:** `{ ok: boolean, ...data }` on success or `{ ok: false, error: string }` on failure. Paginated endpoints return `{ items, page: { limit, offset, total, hasMore } }`.

### Authentication
JWT via `jose` (HS256, 12h expiry). Claims: `{ sub, tenantId, email, roleKey, role?, permissions }` (`hotelId` also emitted as a deprecated alias). `roleKey` is the canonical generic role (admin/manager/supervisor/agent/viewer); `role` is the **deprecated** hospitality union (owner/front_desk/…), retained for backward compat. A token is valid if it carries either identity. Token is issued at `POST /auth/token` by matching credentials against the DB (no passwords — email + role is the credential). The web app fetches a token server-side in `apps/web/lib/api.ts` using demo env vars, or uses `EYNIS_API_TOKEN` if set.

### Multi-tenancy
Every DB query is scoped to `tenantId` from the JWT. The JWT's `tenantId` is verified against the `User` record on every request — a user cannot impersonate a different tenant by forging claims.

### AI Intelligence Layer (`apps/api/src/core/ai/intelligence.ts`)
Dual-provider: **Claude** (`claude-opus-4-7` with adaptive thinking) and **OpenAI** (`gpt-4o`). Provider is selected per request via `?provider=openai` query param (defaults to Claude). When neither `ANTHROPIC_API_KEY` nor `OPENAI_API_KEY` is set, the ingest pipeline falls back to **keyword classification** (no API calls needed for dev/test).

Functions: `classifyInboundEvent`, `generateMorningBriefing`, `generateGuestIntelligence`, `generateRevenueInsights`, `generateNightAuditReport`. All return structured JSON extracted from free-text AI responses via `extractJson()`.

### Connector Ingest Pipeline (`apps/api/src/core/connectors/ingest.ts`)
Handles inbound WhatsApp messages. Steps executed in order:
1. Create `ConnectorEvent` record
2. Upsert `Contact` by phone number
3. Classify via AI (or keyword fallback)
4. Create `ServiceRequest` with SLA deadline
5. Broadcast SSE event to connected clients
6. Send outbound WhatsApp reply (Twilio or Interakt)
7. Update `ConnectorEvent` with all results
8. Write `AuditLog` entry

### Automation Engine (`apps/api/src/core/automations/engine.ts`)
Runs every 60 seconds, evaluating 4 operational rules in parallel:
- `sla_breach_escalate` — escalates SRs past their SLA deadline
- `sentiment_low_flag` — creates a front_desk SR for negative sentiment events
- `checkin_welcome` — sends WhatsApp welcome to guests who checked in within 30 min
- `upsell_followup` — queues an `OfferEvent` after a SR is resolved

Uses `hasExecution(ruleId, triggerEntityId)` to ensure each rule fires at most once per entity.

### Real-time SSE (`apps/api/src/sse/clients.ts`)
In-memory map of SSE client connections. `broadcastSSEEvent()` is called by the ingest pipeline and status-change routes. The web app proxies the stream through `apps/web/app/api/sse/route.ts` → `GET /sse/live-feed` on the API.

### Web Frontend (`apps/web`)
All pages are Next.js **server components** with `export const dynamic = "force-dynamic"`. Data fetching calls `apps/web/lib/data.ts`, which calls the API with a token from `apps/web/lib/api.ts`. The web has no direct DB access — it is purely an API client.

Next.js API routes in `apps/web/app/api/` proxy specific API calls (SSE, public request intake, connector webhooks) so they are accessible without CORS configuration.

### Database Schema (`apps/api/prisma/schema.prisma`)
PostgreSQL via Prisma. Key models and relationships:
- `Tenant` (table `Hotel`) → `User[]`, `Contact[]`, `ServiceRequest[]`, `AutomationRule[]`, `ConnectorEvent[]`, `ConnectorConfig[]`, `AuditLog[]`
- `ServiceRequest` → has `ServiceRequestTransition[]` (status history), `assignedTo` (User), SLA fields (`slaDueAt`, `slaBreachedAt`)
- `ConnectorConfig` — per-hotel enabled/config for each connector key; secrets are masked in API responses
- `AutomationRule` → `AutomationExecution[]` (one row per rule+entity combination, used for idempotency)
- `NightAuditReport` — unique per `(tenantId, reportDate)`; stores AI-generated JSON report

### Connectors Registry
Twelve connectors defined in `CONNECTOR_CATALOG` (`packages/shared/src/index.ts`): `whatsapp_interakt`, `whatsapp_twilio`, `pms_hotelogix`, `pms_ezee`, `pos_petpooja`, `payments_razorpay`, `voice_vapi`, `email_resend`, `search_tavily`, `ai_openai`, `ai_anthropic`, `accounting_busy`. Each has an env flag (e.g. `CONNECTOR_WHATSAPP_TWILIO_ENABLED=true`) that controls default availability. Tenants can override via `PUT /connectors/configs/:key`.

## Key Environment Variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | — | Postgres connection string, e.g. `postgresql://user:pass@host:5432/eynis` |
| `PORT` | `4000` | API server port |
| `JWT_SECRET` | `dev-only-secret-change-me` | JWT signing key |
| `ANTHROPIC_API_KEY` | — | Claude AI (optional; keyword fallback used if absent) |
| `OPENAI_API_KEY` | — | OpenAI fallback (optional) |
| `SEARXNG_URL` | — | API: base URL of a self-hosted SearXNG instance with the JSON API enabled (`search.formats: [html, json]`). The default Research Studio web-search provider (platform-wide). Unset → web search degrades gracefully (crawl + PageSpeed still work). Lock the JSON API to your app/IPs or run it as a private service. |
| `TAVILY_API_KEY` | — | API: env fallback for the optional **Tavily** web-search provider. Preferred path is per-tenant via Integrations (connector `search_tavily`). SearXNG + Tavily can run together (results merged); use either, both, or neither. |
| `RESEARCH_AI_PROVIDER` | auto | API: force Research Studio synthesis to `claude` or `openai`. Default auto-selects: Claude if `ANTHROPIC_API_KEY` is set, else OpenAI. Set `openai` if you only have an OpenAI key (or to prefer it when both are set). |
| `RESEARCH_PLAYWRIGHT_ENABLED` | `false` | API: enable the **optional** headless-browser crawl fallback for JS-heavy pages. Off by default and `playwright` is not a declared dependency — to use it, self-host with `npm i playwright && npx playwright install chromium`, then set `true`. When on, a page whose static HTML is thinner than `RESEARCH_JS_MIN_CHARS` is re-fetched via Chromium and the richer result is cached. Unset/false → static-fetch-only (unchanged). |
| `RESEARCH_JS_MIN_CHARS` | `250` | API: static-text length below which a page is treated as a JS shell and (when the fallback is enabled) retried via Playwright. |
| `VERIFY_WEBHOOKS` | `false` | Enforce Twilio/Interakt webhook signatures |
| `TWILIO_ACCOUNT_SID` / `TWILIO_AUTH_TOKEN` / `TWILIO_WHATSAPP_FROM` | — | Twilio WhatsApp outbound |
| `INTERAKT_API_KEY` | — | Interakt WhatsApp outbound |
| `EYNIS_API_BASE_URL` | `http://localhost:4000` | Web → API base URL |
| `EYNIS_API_TOKEN` | — | Static API token for web (skips `/auth/token` call if set) |
| `EYNIS_DEMO_HOTEL_ID` | `eynis-riviera-1` | Demo hotel used by web to authenticate |
| `EYNIS_ALLOW_DEMO_FALLBACK` | `false` | Web: serve the demo hotel to unresolved visitors. Set `true` for the public demo; leave off in real multi-tenant prod. A resolved real user never falls back to demo regardless. |
| `LICENSE_PLAN_OVERRIDE` | — | API: force EVERY tenant to a plan (`starter`/`growth`/`enterprise`) for feature gating, ignoring per-tenant DB plans. Unlocks plan-gated features (Research Studio, advanced analytics, automations, night audit) with one env var — no billing/DB change. For single-tenant/demo/self-hosted only; leave unset in real multi-tenant prod. |

## Engineering Principles (from `docs/engineering-principles.md`)
- Build → test → self-review → user validation → push
- Every change must be reviewed for tenant isolation, security, and failure handling
- No secrets in code, logs, or docs
