import test from "node:test";
import assert from "node:assert/strict";
import { resolveSubject } from "./intake-routes";

// #162 — subject resolution: real phones dedupe by E.164, other identities get a
// namespaced key that can never collide with a real number, and a no-identity
// signal folds onto one per-source subject.

test("resolveSubject prefers a real phone (E.164 normalised)", () => {
  const r = resolveSubject({ name: "Ravi", phone: "+91 98765 43210" }, "webhook");
  assert.equal(r.key, "+919876543210");
  assert.equal(r.name, "Ravi");
});

test("resolveSubject keys by email when no phone, lowercased and namespaced", () => {
  const r = resolveSubject({ email: "Alice@Acme.com" }, "email_inbound");
  assert.equal(r.key, "email:alice@acme.com");
  assert.equal(r.name, "alice@acme.com"); // falls back to email as display name
});

test("resolveSubject keys by external id when no phone/email", () => {
  const r = resolveSubject({ externalId: "TICKET-42", name: "Line 3 Sensor" }, "webhook");
  assert.equal(r.key, "ext:webhook:TICKET-42");
  assert.equal(r.name, "Line 3 Sensor");
});

test("resolveSubject folds anonymous signals onto one per-source subject", () => {
  const a = resolveSubject({}, "webhook");
  const b = resolveSubject({}, "webhook");
  assert.equal(a.key, "src:webhook");
  assert.equal(a.key, b.key); // dedupe: all anonymous webhook signals share a subject
  assert.equal(a.name, "Webhook Intake");
});

test("resolveSubject namespaced keys never collide with real phone space", () => {
  assert.ok(!resolveSubject({ email: "x@y.com" }, "webhook").key.startsWith("+"));
  assert.ok(!resolveSubject({ externalId: "1" }, "csv_import").key.startsWith("+"));
});
