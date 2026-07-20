# WhatsApp / BSP guardrails (#168)

WhatsApp is the primary intake/outbound channel and a single point of failure —
Meta policy, the BSP relationship, and spam-blocking can all take it down for a
tenant. This document describes the guardrails Eynis **enforces in code** so an
automation bug or a careless staff action can't get a number flagged.

## 1. Inbound webhook signature verification (already on)

Twilio/Interakt webhook signatures are enforced **automatically** once the
provider's verification config exists — an Interakt webhook secret, or Twilio's
auth token **plus** the public URL its HMAC covers (`core/connectors/webhook-verify.ts`,
`webhookEnforcement()`). `VERIFY_WEBHOOKS` is an explicit override: `true` forces
enforcement even when half-configured, `false` is the dev escape hatch. Unset →
auto. So a correctly-configured production deploy verifies by default.

## 2. Outbound guardrails (`core/connectors/messaging-guardrails.ts`)

The operational (non-campaign) senders — the ingest transactional reply, the
automation engine's `checkin_welcome`, and the manual `POST /connectors/whatsapp/send`
endpoint — all pass through one gate, `evaluateOutboundSend({ tenantId, phone, kind })`,
before sending. Campaign sends keep their own richer guard
(`core/campaigns/guard.ts`: consent + TRAI DND scrub); this is its operational
complement.

| Gate | `automated` | `transactional` | `manual` |
|---|---|---|---|
| **Opt-out / DND** (durable `DoNotContact` list) | ✅ | ✅ | ✅ |
| **Quiet hours** (tenant-timezone) | ✅ | — | — |
| **Daily cap** (per subject, rolling 24h) | ✅ | — | — |

- **Opt-out** honours the same tenant-wide `DoNotContact` list the campaign
  senders use (`reason` = `opt_out` \| `dnd` \| `manual` \| `gdpr_erasure`). It
  applies to **every** send kind, including a manual staff send (which returns
  `403` for a suppressed subject).
- **Immediate STOP/START.** On every inbound message, a leading `STOP`,
  `UNSUBSCRIBE`, `CANCEL`, `END`, `QUIT`, or `OPT-OUT` adds the subject to the
  suppression list *before* any reply is built; `START` / `RESUME` / `SUBSCRIBE`
  lifts a **reversible** opt-out only — it never resurrects a `manual` or
  `gdpr_erasure` suppression.
- **Automated sends** additionally face quiet-hours and the daily cap; a blocked
  automation execution is finalised as `skipped` (never retried). Only automated
  operational sends are logged (`AutomatedMessageLog`) to power the cap — campaign
  sends have their own `MessageDelivery` ledger; manual/transactional sends are
  never capped, so they aren't logged.

### Configuration (platform env, sane defaults)

| Variable | Default | Purpose |
|---|---|---|
| `WHATSAPP_AUTOMATED_DAILY_CAP` | `6` | Max automated messages per subject per rolling 24h. |
| `WHATSAPP_QUIET_START_HOUR` | `21` | Quiet-hours window start (tenant local hour, 0–23). |
| `WHATSAPP_QUIET_END_HOUR` | `8` | Quiet-hours window end (exclusive). Overnight when start > end. |

Quiet-hours use the tenant's `timezone`; an invalid timezone falls back to UTC
so a bad value never throws mid-send.

## 3. BSP relationship & per-message cost (assumptions)

- **BSP.** Outbound runs through either Twilio (WhatsApp Business API) or Interakt
  as the BSP, resolved per tenant from `ConnectorConfig` (env fallback for demo).
  The tenant owns the Meta WABA / sender number; Eynis is the software layer.
- **Message categories & cost.** Meta bills per *conversation* (24h window) by
  category — **service** (user-initiated), **utility**, **marketing**,
  **authentication** — at country-specific rates. The transactional ack reply is a
  service message inside the user-opened window; `checkin_welcome` is a
  business-initiated utility/marketing conversation and requires an approved
  template (see below). Assume marketing conversations cost the most and count
  them against the daily cap; treat these caps as cost controls, not just
  anti-spam.

## Follow-ups (not in this change)

- **Approved template library** gating business-initiated message formats (Meta
  requires pre-approved templates for out-of-session sends; `sendWhatsAppTemplate`
  already exists — a manager-approved template registry would gate which
  `contentSid`s the automations may use).
- Per-tenant (vs platform-env) cap / quiet-hours configuration surface.
