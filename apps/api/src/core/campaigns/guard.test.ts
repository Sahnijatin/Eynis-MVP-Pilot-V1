import test from "node:test";
import assert from "node:assert/strict";
import { evaluateContact, type GuardLead } from "./guard";

const consented: GuardLead = { consent: true, consentSource: "csv_import", optedOut: false, phone: "+14155550100" };

test("evaluateContact allows a consented, non-suppressed lead", () => {
  assert.deepEqual(evaluateContact(consented, { channel: "whatsapp", suppressed: false }), { ok: true });
});

test("evaluateContact blocks suppressed leads first", () => {
  assert.deepEqual(evaluateContact(consented, { channel: "email", suppressed: true }), { ok: false, reason: "suppressed" });
});

test("evaluateContact blocks no-consent and opted-out", () => {
  assert.equal(evaluateContact({ ...consented, consent: false }, { channel: "email", suppressed: false }).ok, false);
  assert.equal(evaluateContact({ ...consented, optedOut: true }, { channel: "email", suppressed: false }).ok, false);
});

// F-5: email-only leads (a valid email, no phone) used to be silently skipped as
// "missing_phone". The guard is now channel-aware.
test("evaluateContact allows an email-only lead on the email channel (F-5)", () => {
  const emailOnly: GuardLead = { consent: true, consentSource: "csv_import", optedOut: false, phone: null, email: "lead@example.com" };
  assert.deepEqual(evaluateContact(emailOnly, { channel: "email", suppressed: false }), { ok: true });
});

test("evaluateContact blocks an email-only lead on phone channels (missing_phone)", () => {
  const emailOnly: GuardLead = { consent: true, consentSource: "csv_import", optedOut: false, phone: null, email: "lead@example.com" };
  assert.deepEqual(evaluateContact(emailOnly, { channel: "whatsapp", suppressed: false }), { ok: false, reason: "missing_phone" });
  assert.deepEqual(evaluateContact(emailOnly, { channel: "voice", suppressed: false }), { ok: false, reason: "missing_phone" });
});

test("evaluateContact blocks the email channel when there is no deliverable address (missing_email)", () => {
  const noEmail: GuardLead = { consent: true, consentSource: "csv_import", optedOut: false, phone: "+14155550100", email: null };
  assert.deepEqual(evaluateContact(noEmail, { channel: "email", suppressed: false }), { ok: false, reason: "missing_email" });
  const badEmail: GuardLead = { consent: true, consentSource: "csv_import", optedOut: false, phone: null, email: "not-an-email" };
  assert.deepEqual(evaluateContact(badEmail, { channel: "email", suppressed: false }), { ok: false, reason: "missing_email" });
});

test("DND scrub only blocks voice for +91 and only when enforced", () => {
  const india: GuardLead = { consent: true, consentSource: "csv_import", optedOut: false, phone: "+919876543210" };
  // not enforced (dev default) → allowed
  delete process.env.ENFORCE_DND_SCRUB;
  assert.equal(evaluateContact(india, { channel: "voice", suppressed: false }).ok, true);
  // enforced → voice blocked, but messaging channels still allowed
  process.env.ENFORCE_DND_SCRUB = "true";
  assert.equal(evaluateContact(india, { channel: "voice", suppressed: false }).ok, false);
  assert.equal(evaluateContact(india, { channel: "whatsapp", suppressed: false }).ok, true);
  delete process.env.ENFORCE_DND_SCRUB;
});
