# Custom App Domains — How It Works & Operational Runbook (Plan A7)

_Status: app-layer foundation **built** (model + resolve API + Settings UI); the
hosting/DNS/Clerk wiring below is **operational** (done in dashboards), and the
host-detection middleware is the remaining code step (best validated on the live
deploy)._

## The two URL forms (example tenant "Tempus")

| Form | URL | Tenant setup | TLS |
|---|---|---|---|
| **Workspace subdomain** | `https://tempus.eynis.com` | set `slug = tempus` in Settings → Domains | covered by our `*.eynis.com` wildcard cert (instant) |
| **Custom domain** | `https://app.tempus.com` | set `customDomain` + add one CNAME | auto-provisioned per-domain (Let's Encrypt) |

## Request flow
```
Browser → app.tempus.com
  → Vercel terminates TLS (host = app.tempus.com)
  → Next.js middleware reads Host, calls  GET /tenant/resolve?host=app.tempus.com
  → API returns { tenantId, industry, branding }   (keyed by customDomain / slug)
  → sign-in page is themed as Tempus (logo/colors/name) BEFORE auth,
    then the whole app — via the A1 branding/theming pipeline.
```
Platform hosts (`eynis.com`, `demo.eynis.com`, `localhost`) resolve to
`{ found:false }` → the default Eynis experience.

## What's already built (this repo)
- **Schema**: `Tenant.slug` + `Tenant.customDomain` (both unique, nullable).
- **Public API** `GET /tenant/resolve?host=|slug=` → `{ found, tenantId, industry, branding }`.
- **Admin API** `GET|PUT /tenant/domains` (`manage_settings`) with slug/hostname
  validation, eynis.com rejection, and 409 on a taken slug/domain.
- **Settings → Domains** panel to set them, with live URL preview + the CNAME hint.

## Operational steps to actually serve a custom domain

### A) Workspace subdomain (`tempus.eynis.com`) — nothing to do
A wildcard `*.eynis.com` DNS record + wildcard cert already routes every
subdomain to the app. The tenant just sets their `slug`.

### B) Custom domain (`app.tempus.com`)
1. **Tenant** adds a DNS record at their registrar:
   `app.tempus.com  CNAME  cname.eynis.com` (our branded alias, itself pointing at the hosting provider).
2. **Us** — register the domain on the Vercel project (Dashboard → Project →
   Domains → Add, or the Vercel Domains API). Vercel verifies the CNAME and
   auto-issues a Let's Encrypt certificate (minutes).
3. The tenant sets `customDomain = app.tempus.com` in Settings → Domains.

### C) Clerk (auth) — the one real gotcha
Clerk sessions are domain-scoped, so each custom host must be allowed:
- Add every custom domain (and `*.eynis.com`) as a **satellite domain** /
  allowed origin in the Clerk dashboard, and set the corresponding env
  (`NEXT_PUBLIC_CLERK_*` / satellite config) so sign-in works cross-domain.
- Without this, the app loads + themes correctly but Clerk auth will reject the
  origin. This is why custom-domain auth must be validated on the live deploy.

### D) Env
- `PLATFORM_APP_DOMAIN` (API) — defaults to `eynis.com`; controls which hosts are
  treated as platform (not tenant) and how subdomains are parsed.

## Pre-auth theming — DONE (server-side, no middleware)
The sign-in / sign-up pages (`app/sign-in`, `app/sign-up`) now resolve the tenant
**server-side** from the `Host` header via `lib/host-theme.ts` → `GET
/tenant/resolve`, and render the tenant's logo + brand name + primary color
(including Clerk's `appearance.colorPrimary`). This is cleaner than a middleware
and never touches the Clerk auth boundary — it degrades to the Eynis default on
the platform host or any error/timeout (2.5s). Post-auth theming continues to
come from the logged-in user's tenant via `/api/me` (A1).

> We deliberately did **not** add a Next.js middleware: themed login is achieved
> in the page render, and `clerkMiddleware` (auth) is left untouched.

## What's left — purely operational (no code), validated on the live deploy
1. **Vercel** — add each custom domain (and the `*.eynis.com` wildcard) to the
   project; Vercel verifies the CNAME and issues TLS.
2. **Clerk** — add those domains as allowed/satellite origins so sessions work
   cross-domain (the one real gotcha; see §C).
3. **Env** — set `PLATFORM_APP_DOMAIN` if the platform host isn't `eynis.com`.
