// Voice Campaign — Compliance Foundation (Phase 1)
//
// This module is the single source of truth for the regulatory rules the
// outbound voice / WhatsApp agent must obey BEFORE it can ever contact a real
// person. It is intentionally pure and schema-agnostic so it can be unit-tested
// in full without a database, real API keys, or a live call. Later phases wire
// these helpers into the CampaignLead model (Phase 2), the dialler worker
// (Phase 6), the call webhook (Phase 7) and the WhatsApp agent (Phase 8).
//
// Covered regulations: TCPA (US disclosure + consent), GDPR/PDPA (lawful basis,
// erasure), TRAI (India DND scrub), CASL (Canada express consent).

import type { ConsentSource, LeadConsent } from "@eynis/shared";

// ── 1. Mandatory AI disclosure (TCPA) ───────────────────────────────────────
// Every outbound script MUST open by disclosing that the caller is automated.
// The disclosure is non-removable: ensureDisclosure() prepends it if missing.

export const MANDATORY_DISCLOSURE =
  "Hi, just so you know, this is an AI assistant calling on behalf of {tenant.name}.";

// A script "has" disclosure if its first non-empty line states it is an AI/
// automated/virtual/recorded assistant. Kept deliberately broad so reworded —
// but still compliant — openings are accepted.
const DISCLOSURE_SIGNALS = [
  "ai assistant",
  "ai agent",
  "automated assistant",
  "automated call",
  "virtual assistant",
  "automated voice",
  "artificial intelligence",
  "recorded",
];

export function hasDisclosure(scriptTemplate: string): boolean {
  const head = scriptTemplate.toLowerCase().slice(0, 400);
  return DISCLOSURE_SIGNALS.some((signal) => head.includes(signal));
}

// Returns a script guaranteed to carry the AI disclosure. Idempotent: a script
// that already discloses is returned unchanged.
export function ensureDisclosure(scriptTemplate: string): string {
  const trimmed = scriptTemplate.trim();
  if (hasDisclosure(trimmed)) return trimmed;
  return `${MANDATORY_DISCLOSURE}\n\n${trimmed}`;
}

// ── 2. Opt-out detection (all jurisdictions) ────────────────────────────────
// If a prospect signals opt-out — by voice (Phase 7) or WhatsApp (Phase 8) —
// the agent ends the interaction and the lead is excluded tenant-wide.

// Multi-word phrases are matched as substrings anywhere in the text — they are
// unambiguous enough not to fire on benign content.
export const OPT_OUT_PHRASES = [
  "stop calling",
  "stop messaging",
  "stop texting",
  "do not call",
  "don't call",
  "dont call",
  "do not contact",
  "don't contact",
  "remove me",
  "take me off",
  "unsubscribe",
  "opt out",
  "opt me out",
  "leave me alone",
  "not interested ever",
];

// Single-word SMS/WhatsApp keywords only count when they are the WHOLE message
// (the standard "reply STOP" convention) — so a bare "STOP" opts out but
// "non-stop flight" does not. "cancel" is deliberately excluded: on a booking
// follow-up it usually means "cancel that slot", not "opt out of all campaigns".
export const OPT_OUT_KEYWORDS = ["stop", "unstop", "stopall"];

// Detects an opt-out intent in free text (call transcript line or WhatsApp msg).
export function detectOptOut(text: string): boolean {
  if (!text) return false;
  const normalized = text.toLowerCase().replace(/[^a-z\s]/g, " ").replace(/\s+/g, " ").trim();
  if (!normalized) return false;
  if (OPT_OUT_PHRASES.some((phrase) => normalized.includes(phrase))) return true;
  return OPT_OUT_KEYWORDS.includes(normalized);
}

// ── 3. Consent enforcement (TCPA / CASL / GDPR) ─────────────────────────────
// No lead may be dialled or messaged without recorded consent and without being
// opted out. canContactLead() is the guard the import step, dialler worker and
// WhatsApp agent all call before any outbound action.

export type ContactDecision = { allowed: true } | { allowed: false; reason: string };

export interface ContactCandidate {
  consent: LeadConsent;
  optedOut: boolean; // tenant-wide opt-out flag resolved by the caller
  phone: string | null;
}

export function canContactLead(candidate: ContactCandidate): ContactDecision {
  if (candidate.optedOut) return { allowed: false, reason: "lead_opted_out" };
  if (!candidate.consent.consent) return { allowed: false, reason: "no_consent" };
  if (!candidate.consent.consentSource) return { allowed: false, reason: "consent_source_missing" };
  if (!candidate.phone || candidate.phone.trim().length === 0) {
    return { allowed: false, reason: "missing_phone" };
  }
  return { allowed: true };
}

// Builds a LeadConsent record from a CSV import row. Defaults to NO consent —
// a lead is only contactable when the source explicitly affirms it.
export function consentFromImport(opts: {
  consentValue: unknown;
  source: ConsentSource;
  now?: Date;
}): LeadConsent {
  const granted = isAffirmative(opts.consentValue);
  return {
    consent: granted,
    consentSource: granted ? opts.source : null,
    consentAt: granted ? (opts.now ?? new Date()).toISOString() : null,
  };
}

function isAffirmative(value: unknown): boolean {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value === 1;
  if (typeof value !== "string") return false;
  return ["true", "yes", "y", "1", "consented", "opt_in", "opt-in", "granted"].includes(
    value.trim().toLowerCase(),
  );
}

// ── 4. GDPR / PDPA erasure ──────────────────────────────────────────────────
// On an erasure request we null direct identifiers but RETAIN the anonymised
// outcome so campaign analytics stay correct. This describes the field changes;
// Phase 2/11 apply them to the persisted CampaignLead row.

export interface ErasableLead {
  phone: string | null;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  rawData: string; // original CSV JSON blob — wiped, identifiers may live here
}

export function gdprErase(lead: ErasableLead): ErasableLead {
  return {
    phone: null,
    email: null,
    firstName: "[erased]",
    lastName: null,
    rawData: "{}",
  };
}

// ── 5. DND / TRAI pre-flight scrub strategy ─────────────────────────────────
// India's TRAI rules require scrubbing numbers against the DND registry before
// dialling. The live registry API is a Phase 2 integration; Phase 1 establishes
// the decision boundary so Indian numbers are flagged as requiring a scrub and
// non-Indian numbers pass through. requiresDndScrub() lets the dialler short-
// circuit until the registry connector exists.

export function requiresDndScrub(phoneE164: string | null): boolean {
  if (!phoneE164) return false;
  return phoneE164.replace(/[^+\d]/g, "").startsWith("+91");
}

export type DndScrubResult =
  | { status: "clear" }
  | { status: "pending_integration"; reason: string };

// Phase 1 stub: never claims a number is "clear" for India, so the dialler must
// treat Indian numbers as un-scrubbed until the Phase 2 registry check lands.
export function dndScrub(phoneE164: string | null): DndScrubResult {
  if (!requiresDndScrub(phoneE164)) return { status: "clear" };
  return {
    status: "pending_integration",
    reason: "TRAI DND registry check not yet integrated (Phase 2)",
  };
}
