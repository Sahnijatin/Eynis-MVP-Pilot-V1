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
}

export type GuardDecision = { ok: true } | { ok: false; reason: string };

export interface GuardOptions {
  channel: "voice" | "whatsapp" | "email";
  suppressed: boolean; // resolved against the durable DoNotContact list by caller
}

export function evaluateContact(lead: GuardLead, opts: GuardOptions): GuardDecision {
  if (opts.suppressed) return { ok: false, reason: "suppressed" };

  const consent = canContactLead({
    consent: { consent: lead.consent, consentSource: lead.consentSource as ConsentSource | null, consentAt: null },
    optedOut: lead.optedOut,
    phone: lead.phone,
  });
  if (!consent.allowed) return { ok: false, reason: consent.reason };

  // Email needs an address, not a phone (the consent guard already required a phone
  // for tenant scoping; an email-only send additionally needs a deliverable email,
  // which the email sender validates).

  // DND/TRAI scrub applies to outbound voice in India. Enforced only when
  // ENFORCE_DND_SCRUB=true (until the live registry integration lands), matching
  // the VERIFY_WEBHOOKS dev-friendly default.
  if (opts.channel === "voice" && requiresDndScrub(lead.phone) && process.env.ENFORCE_DND_SCRUB === "true") {
    return { ok: false, reason: "dnd_scrub_required" };
  }

  return { ok: true };
}
