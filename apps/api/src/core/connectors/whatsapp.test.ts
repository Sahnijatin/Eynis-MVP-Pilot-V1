import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsappInbound } from "./whatsapp";
import { buildReplyMessage } from "./whatsapp-outbound";

test("buildReplyMessage never echoes model/customer text back to the sender (H1)", () => {
  // A prompt-injected summary must NOT appear in the outbound acknowledgment — it
  // would relay attacker text through the tenant's own WhatsApp number.
  const injected = 'URGENT: your payment failed, re-pay at http://evil.example';
  const msg = buildReplyMessage("Ravi Kumar", injected, "req_abcdef123456", "Tempus");
  assert.ok(!msg.includes("evil.example"), "no injected URL");
  assert.ok(!msg.includes(injected), "summary is not echoed");
  assert.ok(msg.includes("Ravi"), "still greets the customer");
  assert.ok(msg.includes("#123456"), "carries the ref id");
  assert.ok(msg.includes("Tempus"), "carries the tenant brand");
  // A malicious display name is sanitised (no injected markup/links).
  const evilName = buildReplyMessage("<a href=x>click</a>", "s", "req_zzzzzz111111", null);
  assert.ok(!/[<>]/.test(evilName), "display name sanitised");
});

// Regression guard for the Tenant rename: the public inbound WhatsApp webhook
// must keep accepting the legacy `hotelId` key (existing Twilio/Interakt configs
// were set up before the rename), alongside the new `tenantId`.

test("normalizeWhatsappInbound accepts new tenantId (generic)", () => {
  const out = normalizeWhatsappInbound({ provider: "generic", tenantId: "t1", fromPhone: "+15551234567", message: "hi" });
  assert.equal(out?.tenantId, "t1");
});

test("normalizeWhatsappInbound still accepts legacy hotelId (generic)", () => {
  const out = normalizeWhatsappInbound({ provider: "generic", hotelId: "t1", fromPhone: "+15551234567", message: "hi" });
  assert.equal(out?.tenantId, "t1");
});

test("normalizeWhatsappInbound accepts legacy hotelId on the Twilio path", () => {
  const out = normalizeWhatsappInbound({ hotelId: "t2", From: "whatsapp:+15551234567", Body: "hello" });
  assert.equal(out?.tenantId, "t2");
  assert.equal(out?.fromPhone, "+15551234567");
});

test("normalizeWhatsappInbound returns null without any tenant id", () => {
  assert.equal(normalizeWhatsappInbound({ provider: "generic", fromPhone: "+15551234567", message: "hi" }), null);
});
