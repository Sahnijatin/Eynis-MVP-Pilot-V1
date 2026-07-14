# Email Sending & Deliverability — Design

_Status: **partially built** (July 2026) · Author note: written after the first live
Resend send (Jun 2026), prompted by Resend's "use a subdomain" insight and the
question of how to handle email **at scale** (thousands of sends, many tenants)._

> Phases 1 & 3 are substantially implemented: suppression handling
> (`EmailSuppression` model + `core/email/resend-webhook.ts` consuming
> `/webhooks/resend`), per-tenant sending domains (`SendingDomain` model +
> `core/email/domains.ts`), and tenant email branding (`core/email/branding.ts`).
> Phase 2 (marketing/transactional stream split) is **not yet built**. "Today"
> sections describe behaviour at authoring time and may lag the code.

---

## 1. Problem

Email works end-to-end today (Resend, verified `eynis.com`), but it's built for
a single pilot tenant on a single sending identity. Two pressures break that as
volume grows:

1. **Reputation segmentation.** A spam complaint on a marketing blast must not
   degrade the deliverability of transactional mail (welcome, booking confirms,
   OTP). The industry-standard fix is to split sending **streams** onto separate
   subdomains so their reputations are isolated — this is what Resend's insight
   is nudging us toward.
2. **Multi-tenant scale.** Eynis is multi-tenant (every query is scoped to
   `hotelId`). At thousands of sends across many tenants we need a deliberate
   answer to: *what domain does each tenant send from, who owns DNS, and how is
   that configured in setup?*

A third issue is the real silent killer at volume and is currently **missing
entirely**: bounce/complaint feedback. See §6.

---

## 2. Where we are today

| Concern | Current state | File |
|---|---|---|
| Provider | Resend REST API via `fetch` (no SDK) | `apps/api/src/core/email/resend.ts` |
| Credentials | Per-tenant `ConnectorConfig.email_resend` `{ apiKey, fromAddress, fromName }`, env fallback (`RESEND_API_KEY`, `EMAIL_FROM_ADDRESS`, `EMAIL_FROM_NAME`) | `resolveResendCredentials()` |
| Sending identity | **One** `fromAddress` per tenant — no purpose/stream split | `sendFollowUpEmail()` |
| Body rendering | `{variable}` system; plain-text newlines → `<br>` (`toEmailHtml`) | `resend.ts` |
| Setup UI | **None** for `email_resend` (only Twilio/Interakt/Cloudbeds/Stripe have forms) | `connector-config-panel.tsx` |
| Bounce/complaint feedback | **None** — no Resend webhook consumer | — |
| Suppression | `DoNotContact` exists but is **phone-keyed** (WhatsApp/voice); no email suppression | `schema.prisma` |

**Implication:** today every tenant sends all mail (campaigns *and* future
transactional) from one address, with no feedback loop and no self-serve setup.

---

## 3. Core concept — Sending Streams

The reputation win is not "subdomains" — it's isolating sending by **purpose**.
Define a small, fixed set of streams:

| Stream | Purpose | Example content | Tolerance for complaints |
|---|---|---|---|
| `transactional` | system-triggered, expected mail | welcome, booking confirm, OTP, receipts | must always land |
| `marketing` | business-initiated outreach | campaigns, upsells, re-engagement | higher complaint rate — quarantine here |

Each stream maps to its own **subdomain** so DKIM/SPF/DMARC alignment and
reputation are per-stream:

```
tx.<domain>     → transactional
mkt.<domain>    → marketing
```

The campaign sender (`senders.ts → emailSender`) resolves the **marketing**
identity; future automation/welcome mail resolves **transactional**. Streams are
an internal concept — not exposed as free-form config — so we can reason about
deliverability globally.

---

## 4. Ownership models (the real design fork)

Who owns the sending domain? Three options; the data model is identical, only the
domain differs.

### Model B — per-tenant custom domains (white-label) — **chosen direction**
Each tenant verifies their own `mail.acme.com`. We use Resend's **Domains API** to
add the domain, fetch its DNS records, render them in the setup UI, and poll
verification.
- ✅ Full branding + best deliverability (tenant's own reputation) — required by
  the product's **white-label** principle.
- ❌ Onboarding friction: tenant must add DNS records and wait for verification.
- Tenant sends as `Acme Co <campaigns@mail.acme.com>`.

### Model A — Eynis-managed shared subdomains (optional fallback)
Eynis owns `mkt.eynis.com` / `tx.eynis.com`; a tenant *without* its own domain
sends as `Acme Co <acme@mkt.eynis.com>`.
- ✅ Zero DNS work — instant start for trials/pilots.
- ❌ Not the tenant's own domain ("via eynis.com" in some clients) — **not**
  acceptable as the end state for paying, white-labeled customers.

### Decision
**White-label own-domain (Model B) is the target** — customers run Eynis as their
own product and must send from their own domain. Model A stays only as an
optional zero-setup path for trials before a customer has connected their domain.
`SendingDomain.ownership` records which is in play so both can coexist during
onboarding.

---

## 5. Data model changes

Replace the single `fromAddress` with **stream-keyed identities** plus a domain
registry.

```prisma
model SendingDomain {
  id            String   @id @default(cuid())
  hotelId       String
  tenant         Tenant    @relation(fields: [hotelId], references: [id])
  domain        String   // e.g. "mkt.eynis.com" or "mail.acme.com"
  stream        String   // "marketing" | "transactional"
  ownership     String   // "shared" | "custom"
  resendDomainId String? // Resend Domains API id (Model B)
  status        String   @default("pending") // pending | verified | failed
  fromLocalPart String   // "campaigns", "hello", "no-reply"
  fromName      String?
  createdAt     DateTime @default(now())

  @@unique([hotelId, stream])
}
```

- `resolveResendCredentials(hotelId)` → becomes `resolveSender(hotelId, stream)`,
  returning the right from-address + apiKey for that stream.
- Backward-compatible: if no `SendingDomain` row exists, fall back to the current
  `email_resend` config / env (so nothing breaks mid-migration).
- API key stays per-tenant in `ConnectorConfig.email_resend` (or a platform key
  for Model A); domains are the per-stream layer on top.

---

## 6. Deliverability infrastructure (the missing half)

Subdomains are pointless if we're not listening to feedback. **This is the
highest-risk gap and should land first.**

### 6.1 Resend webhooks → suppression
Consume Resend events at a new endpoint (e.g. `POST /webhooks/resend`, signature-
verified like the Twilio/Interakt webhooks already are):

| Event | Action |
|---|---|
| `email.bounced` (hard) | add recipient to email suppression; never retry |
| `email.complained` | suppress **and** flag the lead (consent withdrawn) |
| `email.delivered` / `opened` / `clicked` | update `MessageDelivery` + analytics |

### 6.2 Email suppression
`DoNotContact` is phone-keyed. Either extend it with an optional `email` column
or add an `EmailSuppression { hotelId, email, reason, createdAt }`. The email
sender (`emailSender.send`) checks it before sending — mirroring the existing
phone suppression path in `dispatch.ts`.

### 6.3 Throughput & warmup (Model A, platform-managed)
- Per-stream dedicated IP + warmup once volume justifies it (Resend feature).
- Respect Resend rate limits; the campaign dispatcher already batches — add
  per-tenant/day caps surfaced as `spendCap`-style controls.

---

## 7. Setup UX

A new **Email** step in the connector/settings UI (`connector-config-panel.tsx`
gains an `email_resend` field set, plus a richer domain panel):

1. **Choose ownership:** "Connect your own domain (recommended — white-label)" vs
   "Use shared sending to start (trial, no setup)." White-labeled customers are
   steered to their own domain; the shared option is a temporary trial path.
2. **Custom domain path:** enter domain → backend calls Resend Domains API →
   UI shows the DNS records to add + a live **status badge** (pending/verified),
   polled until green.
3. **Per-stream from-identity:** display name + local part for marketing and
   transactional (e.g. `Acme Co <campaigns@…>` and `<bookings@…>`).
4. **Health panel:** recent bounce/complaint rate per stream (from §6 events) so
   operators can see reputation before it becomes a problem.

---

## 8. Phasing & recommendation

| Phase | Scope | Why this order |
|---|---|---|
| **1 — Foundation** | In-app `email_resend` setup form + Resend webhook → email suppression (§6.1–6.2) | Makes today's single-domain sending **self-serve and safe**. Best value/effort; unblocks volume without subdomains. |
| **2 — Streams** | `SendingDomain` model, marketing vs transactional subdomains, `resolveSender(hotelId, stream)` (§3, §5) | The reputation isolation Resend is asking for. |
| **3 — White-label domains** | Per-tenant custom domains via Resend Domains API + in-app verification (§4 Model B, §7) | **Committed requirement**, not optional — customers must send from their own domain. |

**Recommendation:** still ship **Phase 1 first** (it's required regardless of who
owns the domain — bounces/complaints must be captured or reputation dies at
volume), but Phase 3 (white-label own-domain) is now a **committed launch
requirement**, not a "larger clients later" nice-to-have. Phase 1's setup form
should be built domain-aware from the start (i.e. the "connect your own domain"
flow), so Phase 3 extends it rather than replacing it. Phase 2 (transactional vs
marketing stream split) can follow once own-domain sending is live.

---

## 9. Decisions & open questions

**Decided (Jun 2026):**
- **White-label own-domain is required.** Customers white-label Eynis and send
  from **their own** domain (Model B). Shared sending (Model A) is only a trial
  fallback. This resolves the original branding question.
- **Industry-agnostic:** examples and copy in this doc and the build must stay
  industry-neutral (no hospitality-specific assumptions) — see the Product
  Principles in `CLAUDE.md`.

**Still open:**
- **One Resend account vs per-tenant accounts:** Model A implies a single
  platform Resend account (simpler, central reputation); Model B can use either.
  Sub-accounts affect billing and isolation.
- **Consent semantics:** on `email.complained`, do we withdraw consent across
  *all* channels for that lead, or email-only?
- **Migration:** when `SendingDomain` lands, do we backfill existing tenants to a
  default shared marketing identity automatically?
