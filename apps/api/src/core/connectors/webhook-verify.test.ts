import { test } from "node:test";
import assert from "node:assert/strict";
import { verifySharedWebhookSecret } from "./webhook-verify";

// F-2: the PMS webhook writes data for a body-supplied tenantId, so it must be
// authenticated with a shared secret. These tests lock the fail-closed posture.
test("verifySharedWebhookSecret: matching secret passes", () => {
  const r = verifySharedWebhookSecret({ expected: "s3cret", provided: "s3cret", isProduction: true });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
});

test("verifySharedWebhookSecret: wrong secret is rejected (401)", () => {
  const r = verifySharedWebhookSecret({ expected: "s3cret", provided: "nope", isProduction: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("verifySharedWebhookSecret: missing provided secret is rejected when one is configured", () => {
  const r = verifySharedWebhookSecret({ expected: "s3cret", provided: null, isProduction: false });
  assert.equal(r.ok, false);
  assert.equal(r.status, 401);
});

test("verifySharedWebhookSecret: fails CLOSED in production when no secret is configured (503)", () => {
  const r = verifySharedWebhookSecret({ expected: undefined, provided: "anything", isProduction: true });
  assert.equal(r.ok, false);
  assert.equal(r.status, 503);
});

test("verifySharedWebhookSecret: open in development when no secret is configured", () => {
  const r = verifySharedWebhookSecret({ expected: "", provided: null, isProduction: false });
  assert.equal(r.ok, true);
  assert.equal(r.status, 200);
});
