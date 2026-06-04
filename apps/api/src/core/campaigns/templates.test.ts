import test from "node:test";
import assert from "node:assert/strict";
import { validateTemplateCreate, validateStatusChange } from "./templates";

test("validateTemplateCreate: whatsapp ok, email needs subject, bad inputs rejected", () => {
  const wa = validateTemplateCreate({ name: "Welcome", channel: "whatsapp", body: "Hi {{1}}", variables: ["{lead.firstName}"] });
  assert.ok(wa.ok);
  if (wa.ok) { assert.equal(wa.value.category, "marketing"); assert.equal(wa.value.language, "en"); }

  assert.equal(validateTemplateCreate({ name: "x", channel: "email", body: "hi" }).ok, false); // no subject
  assert.ok(validateTemplateCreate({ name: "x", channel: "email", subject: "S", body: "hi" }).ok);
  assert.equal(validateTemplateCreate({ name: "x", channel: "sms", body: "hi" }).ok, false);
  assert.equal(validateTemplateCreate({ channel: "whatsapp", body: "hi" }).ok, false); // no name
  assert.equal(validateTemplateCreate({ name: "x", channel: "whatsapp" }).ok, false); // no body
  assert.equal(validateTemplateCreate({ name: "x", channel: "whatsapp", body: "hi", category: "spam" }).ok, false);
});

test("validateStatusChange: approval rules", () => {
  // approving a whatsapp template requires a provider id
  assert.equal(validateStatusChange("whatsapp", "approved", {}).ok, false);
  const ok = validateStatusChange("whatsapp", "approved", { providerTemplateId: "HX123" });
  assert.ok(ok.ok);
  if (ok.ok) assert.equal(ok.value.providerTemplateId, "HX123");

  // email can be approved with no provider id
  assert.ok(validateStatusChange("email", "approved", {}).ok);

  // submitted stamps submittedAt
  const sub = validateStatusChange("whatsapp", "submitted", {});
  assert.ok(sub.ok && sub.value.submittedAt instanceof Date);

  // rejected keeps the reason, clears provider id
  const rej = validateStatusChange("whatsapp", "rejected", { rejectionReason: "policy" });
  assert.ok(rej.ok);
  if (rej.ok) { assert.equal(rej.value.rejectionReason, "policy"); assert.equal(rej.value.providerTemplateId, null); }

  assert.equal(validateStatusChange("whatsapp", "bogus", {}).ok, false);
});
