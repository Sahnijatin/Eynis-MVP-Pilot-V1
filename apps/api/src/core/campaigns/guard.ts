// Shared pre-send compliance guard (Phase 6.1).
//
// One gate every channel (voice dialler, WhatsApp sender, email sender) calls
// before contacting a lead. Pure and channel-aware so it is trivially testable
// and reusable; the durable-suppression lookup is done in batch by the caller
// and passed in as `suppressed` (keeps this allocation-free per lead and lets
// the dispatcher resolve thousands of phones in chunked queries).

import { canContactLead, requiresDndScrub } from "./compliance";
import type { ConsentSource } from "@eynis/shared";

export interface GuardLead {
  consent: boolean;
  consentSource: string | null;
  optedOut: boolean;
  phone: string | null;
  email?: string | null;
}

export type GuardDecision = { ok: true } | { ok: false; reason: string };

export interface GuardOptions {
  channel: "voice" | "whatsapp" | "email";
  suppressed: boolean; // resolved against the durable DoNotContact list by caller
}

export function evaluateContact(lead: GuardLead, opts: GuardOptions): GuardDecision {
  if (opts.suppressed) return { ok: false, reason: "suppressed" };

  // Channel-aware identifier check: email needs a deliverable address, voice/
  // WhatsApp need a phone (F-5 — previously this always required a phone, so
  // email-only leads were silently skipped as "missing_phone").
  const consent = canContactLead({
    consent: { consent: lead.consent, consentSource: lead.consentSource as ConsentSource | null, consentAt: null },
    optedOut: lead.optedOut,
    phone: lead.phone,
    email: lead.email ?? null,
    channel: opts.channel,
  });
  if (!consent.allowed) return { ok: false, reason: consent.reason };

  // DND/TRAI scrub applies to outbound voice in India. Enforced only when
  // ENFORCE_DND_SCRUB=true (until the live registry integration lands), matching
  // the VERIFY_WEBHOOKS dev-friendly default.
  if (opts.channel === "voice" && requiresDndScrub(lead.phone) && process.env.ENFORCE_DND_SCRUB === "true") {
    return { ok: false, reason: "dnd_scrub_required" };
  }

  return { ok: true };
}
