import test from "node:test";
import assert from "node:assert/strict";
import {
  MANDATORY_DISCLOSURE,
  hasDisclosure,
  ensureDisclosure,
  detectOptOut,
  canContactLead,
  consentFromImport,
  gdprErase,
  requiresDndScrub,
  dndScrub,
} from "./compliance";
import type { LeadConsent } from "@eynis/shared";

// ── Disclosure ──────────────────────────────────────────────────────────────

test("hasDisclosure detects an AI disclosure in the script opening", () => {
  assert.equal(hasDisclosure("This is an AI assistant calling about your booking."), true);
  assert.equal(hasDisclosure("Hello, this is an automated call from the hotel."), true);
  assert.equal(hasDisclosure("Hi Sarah, I'm calling about your stay."), false);
});

test("ensureDisclosure prepends the mandatory line when missing", () => {
  const script = "Hi {lead.firstName}, want to upgrade your room?";
  const result = ensureDisclosure(script);
  assert.ok(result.startsWith(MANDATORY_DISCLOSURE));
  assert.ok(result.includes(script));
});

test("ensureDisclosure is idempotent for compliant scripts", () => {
  const compliant = "Just so you know, this is an AI assistant. Want to upgrade?";
  assert.equal(ensureDisclosure(compliant), compliant);
});

// ── Opt-out detection ─────────────────────────────────────────────────────────

test("detectOptOut catches common opt-out phrases", () => {
  assert.equal(detectOptOut("Please stop calling me"), true);
  assert.equal(detectOptOut("Do not call this number again"), true);
  assert.equal(detectOptOut("remove me from your list"), true);
  assert.equal(detectOptOut("STOP"), true);
  assert.equal(detectOptOut("unsubscribe"), true);
});

test("detectOptOut does not false-positive on benign text", () => {
  assert.equal(detectOptOut("I took a non-stop flight yesterday"), false);
  assert.equal(detectOptOut("Yes, I'm interested, tell me more"), false);
  assert.equal(detectOptOut(""), false);
});

// ── Consent enforcement ───────────────────────────────────────────────────────

const consented: LeadConsent = {
  consent: true,
  consentSource: "csv_import",
  consentAt: "2026-06-01T00:00:00.000Z",
};

test("canContactLead allows a consented, non-opted-out lead with a phone", () => {
  assert.deepEqual(
    canContactLead({ consent: consented, optedOut: false, phone: "+919876543210" }),
    { allowed: true },
  );
});

test("canContactLead blocks opted-out leads first", () => {
  const decision = canContactLead({ consent: consented, optedOut: true, phone: "+911111111111" });
  assert.deepEqual(decision, { allowed: false, reason: "lead_opted_out" });
});

test("canContactLead blocks leads without consent", () => {
  const noConsent: LeadConsent = { consent: false, consentSource: null, consentAt: null };
  const decision = canContactLead({ consent: noConsent, optedOut: false, phone: "+911111111111" });
  assert.deepEqual(decision, { allowed: false, reason: "no_consent" });
});

test("canContactLead blocks leads missing a phone", () => {
  const decision = canContactLead({ consent: consented, optedOut: false, phone: null });
  assert.deepEqual(decision, { allowed: false, reason: "missing_phone" });
});

// ── Consent from import ───────────────────────────────────────────────────────

test("consentFromImport grants consent only on affirmative values", () => {
  const now = new Date("2026-06-03T00:00:00.000Z");
  const yes = consentFromImport({ consentValue: "yes", source: "csv_import", now });
  assert.equal(yes.consent, true);
  assert.equal(yes.consentSource, "csv_import");
  assert.equal(yes.consentAt, now.toISOString());

  const no = consentFromImport({ consentValue: "no", source: "csv_import", now });
  assert.deepEqual(no, { consent: false, consentSource: null, consentAt: null });

  const blank = consentFromImport({ consentValue: "", source: "csv_import", now });
  assert.equal(blank.consent, false);
});

// ── GDPR erasure ──────────────────────────────────────────────────────────────

test("gdprErase nulls identifiers but keeps structure for anonymised analytics", () => {
  const erased = gdprErase({
    phone: "+919876543210",
    email: "guest@example.com",
    firstName: "Sarah",
    lastName: "Khan",
    rawData: '{"annualRevenue":"1M"}',
  });
  assert.equal(erased.phone, null);
  assert.equal(erased.email, null);
  assert.equal(erased.firstName, "[erased]");
  assert.equal(erased.lastName, null);
  assert.equal(erased.rawData, "{}");
});

// ── DND / TRAI scrub ──────────────────────────────────────────────────────────

test("requiresDndScrub flags Indian numbers only", () => {
  assert.equal(requiresDndScrub("+919876543210"), true);
  assert.equal(requiresDndScrub("+14155550100"), false);
  assert.equal(requiresDndScrub(null), false);
});

test("dndScrub passes non-Indian numbers and defers Indian numbers to Phase 2", () => {
  assert.deepEqual(dndScrub("+14155550100"), { status: "clear" });
  const india = dndScrub("+919876543210");
  assert.equal(india.status, "pending_integration");
});
