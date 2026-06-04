import test from "node:test";
import assert from "node:assert/strict";
import { normalizeWhatsappInbound } from "./whatsapp";

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
