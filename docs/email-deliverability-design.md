# Email Sending & Deliverability — Design

_Status: **proposal / not yet built** · Author note: written after the first live
Resend send (Jun 2026), prompted by Resend's "use a subdomain" insight and the
question of how to handle email **at scale** (thousands of sends, many tenants)._

> This is a design doc, not a build log. It exists so we agree on the model
> **before** writing code. Nothing here is implemented yet except where the
> "Today" sections note current behaviour.

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
   `hotelId`). At thousands of sends across many hotels we need a deliberate
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

### Model A — Eynis-managed shared subdomains
Eynis owns `mkt.eynis.com` / `tx.eynis.com`. Tenants send as
`Crowne Plaza <crowne-plaza@mkt.eynis.com>`.
- ✅ Zero DNS work for tenants — instant onboarding.
- ✅ Eynis controls DKIM/DMARC, dedicated IP, warmup centrally.
- ❌ Not the hotel's own domain (weaker branding; "via eynis.com" in some clients).
- Per-tenant isolation via the local part or a per-tenant sub-subdomain
  (`crowne.mkt.eynis.com`) if a noisy tenant needs quarantining.

### Model B — per-tenant custom domains (white-label)
Each hotel verifies `mail.crowneplaza.com`. We use Resend's **Domains API** to
add the domain, fetch its DNS records, render them in the setup UI, and poll
verification.
- ✅ Full branding + best deliverability (hotel's own reputation).
- ❌ Onboarding friction: tenant must add DNS records and wait for verification.

### Recommended — Hybrid
Default new tenants to **Model A** (works in 0 clicks). Offer an **upgrade to
your own domain** path (Model B) for tenants who want white-label. Both coexist;
`SendingDomain.ownership` records which is in play.

---

## 5. Data model changes

Replace the single `fromAddress` with **stream-keyed identities** plus a domain
registry.

```prisma
model SendingDomain {
  id            String   @id @default(cuid())
  hotelId       String
  hotel         Hotel    @relation(fields: [hotelId], references: [id])
  domain        String   // e.g. "mkt.eynis.com" or "mail.crowneplaza.com"
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

1. **Choose ownership:** "Use Eynis sending (recommended, no setup)" vs "Use your
   own domain."
2. **Custom domain path:** enter domain → backend calls Resend Domains API →
   UI shows the DNS records to add + a live **status badge** (pending/verified),
   polled until green.
3. **Per-stream from-identity:** display name + local part for marketing and
   transactional (e.g. `Crowne Plaza <campaigns@…>` and `<bookings@…>`).
4. **Health panel:** recent bounce/complaint rate per stream (from §6 events) so
   operators can see reputation before it becomes a problem.

---

## 8. Phasing & recommendation

| Phase | Scope | Why this order |
|---|---|---|
| **1 — Foundation** | In-app `email_resend` setup form + Resend webhook → email suppression (§6.1–6.2) | Makes today's single-domain sending **self-serve and safe**. Best value/effort; unblocks volume without subdomains. |
| **2 — Streams** | `SendingDomain` model, marketing vs transactional subdomains, `resolveSender(hotelId, stream)` (§3, §5) | The reputation isolation Resend is asking for. |
| **3 — White-label** | Per-tenant custom domains via Resend Domains API + in-app verification (§4 Model B, §7) | Branding/deliverability for larger clients; build once Phase 1–2 are proven. |

**Recommendation:** ship **Phase 1 first.** Stream subdomains (Phase 2) are the
right end-state, but they're moot if bounces and complaints aren't captured —
that feedback loop is what actually protects a sending reputation at thousands of
emails. Phase 1 also delivers immediate operator value (self-serve setup) with no
DNS dependency.

---

## 9. Open questions

- **Shared-domain branding:** is "via eynis.com" acceptable for hotels, or is
  white-label (Model B) a launch requirement for the segment we're selling to?
- **One Resend account vs per-tenant accounts:** Model A implies a single
  platform Resend account (simpler, central reputation); Model B can use either.
  Sub-accounts affect billing and isolation.
- **Consent semantics:** on `email.complained`, do we withdraw consent across
  *all* channels for that lead, or email-only?
- **Migration:** when `SendingDomain` lands, do we backfill existing tenants to a
  default shared marketing identity automatically?
