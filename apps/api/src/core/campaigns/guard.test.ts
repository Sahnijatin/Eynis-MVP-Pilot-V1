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
