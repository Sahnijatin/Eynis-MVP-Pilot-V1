import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { verifySharedWebhookSecret, verifyTwilioSignature } from "./webhook-verify";

test("verifyTwilioSignature matches Twilio's algorithm (url + sorted params, HMAC-SHA1)", () => {
  const authToken = "test_auth_token";
  const url = "https://api.eynis.app/connectors/webhook";
  const params = { To: "whatsapp:+14155238886", From: "whatsapp:+919812300099", Body: "Hi" };
  // Twilio: sort params by key, concat url + key+value pairs, HMAC-SHA1, base64.
  const sorted = Object.entries(params).sort(([a], [b]) => a.localeCompare(b));
  const expected = createHmac("sha1", authToken).update(url + sorted.map(([k, v]) => k + v).join("")).digest("base64");
  assert.equal(verifyTwilioSignature(url, params, authToken, expected), true, "valid signature accepted");
  assert.equal(verifyTwilioSignature(url, params, authToken, "wrongsig"), false, "forged signature rejected");
  // Param order in the object must not matter (verifier sorts).
  const reordered = { Body: "Hi", From: "whatsapp:+919812300099", To: "whatsapp:+14155238886" };
  assert.equal(verifyTwilioSignature(url, reordered, authToken, expected), true);
  // A tampered body param must fail.
  assert.equal(verifyTwilioSignature(url, { ...params, Body: "evil" }, authToken, expected), false);
});

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
