import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { createHmac } from "node:crypto";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { processResendEvent, verifyResendSignature } from "./resend-webhook";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

async function seedDelivery(opts: { providerId: string; to: string }) {
  const hotelId = "rw-" + uid();
  await prisma.hotel.create({ data: { id: hotelId, name: "RW " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({ data: { hotelId, name: "C", status: "active", channels: JSON.stringify(["email"]) } });
  const lead = await prisma.campaignLead.create({ data: { campaignId: campaign.id, hotelId, firstName: "A", email: opts.to, phone: "+919" + Date.now().toString().slice(-9), consent: true } });
  const delivery = await prisma.messageDelivery.create({ data: { hotelId, campaignId: campaign.id, leadId: lead.id, channel: "email", status: "sent", providerId: opts.providerId } });
  return { hotelId, leadId: lead.id, deliveryId: delivery.id };
}

after(async () => { await prisma.$disconnect(); });

test("processResendEvent: hard bounce suppresses the recipient and fails the delivery", async () => {
  const providerId = "re_" + uid();
  const to = `bounce+${uid()}@example.com`;
  const { hotelId, deliveryId } = await seedDelivery({ providerId, to });

  const r = await processResendEvent({ type: "email.bounced", data: { email_id: providerId, to: [to], bounce: { type: "Permanent" } } });
  assert.equal(r.action, "suppressed_bounce");

  const supp = await prisma.emailSuppression.findUnique({ where: { hotelId_email: { hotelId, email: to.toLowerCase() } } });
  assert.ok(supp, "suppression row created");
  assert.equal(supp?.reason, "bounced");
  const d = await prisma.messageDelivery.findUnique({ where: { id: deliveryId } });
  assert.equal(d?.status, "failed");
  assert.equal(d?.error, "bounced");
});

test("processResendEvent: transient bounce does NOT suppress", async () => {
  const providerId = "re_" + uid();
  const to = `soft+${uid()}@example.com`;
  const { hotelId } = await seedDelivery({ providerId, to });

  const r = await processResendEvent({ type: "email.bounced", data: { email_id: providerId, to: [to], bounce: { type: "Transient" } } });
  assert.equal(r.action, "transient_bounce");
  const supp = await prisma.emailSuppression.findUnique({ where: { hotelId_email: { hotelId, email: to.toLowerCase() } } });
  assert.equal(supp, null);
});

test("processResendEvent: complaint suppresses and opts the lead out", async () => {
  const providerId = "re_" + uid();
  const to = `spam+${uid()}@example.com`;
  const { hotelId, leadId } = await seedDelivery({ providerId, to });

  const r = await processResendEvent({ type: "email.complained", data: { email_id: providerId, to: [to] } });
  assert.equal(r.action, "suppressed_complaint");
  const supp = await prisma.emailSuppression.findUnique({ where: { hotelId_email: { hotelId, email: to.toLowerCase() } } });
  assert.equal(supp?.reason, "complained");
  const lead = await prisma.campaignLead.findUnique({ where: { id: leadId } });
  assert.equal(lead?.optedOut, true);
});

test("processResendEvent: delivered marks the delivery delivered", async () => {
  const providerId = "re_" + uid();
  const to = `ok+${uid()}@example.com`;
  const { deliveryId } = await seedDelivery({ providerId, to });
  const r = await processResendEvent({ type: "email.delivered", data: { email_id: providerId, to: [to] } });
  assert.equal(r.action, "delivered");
  const d = await prisma.messageDelivery.findUnique({ where: { id: deliveryId } });
  assert.equal(d?.status, "delivered");
});

test("verifyResendSignature validates a Svix-style signature", () => {
  const secret = "whsec_" + Buffer.from("super-secret-key").toString("base64");
  const id = "msg_123";
  const timestamp = "1700000000";
  const body = JSON.stringify({ type: "email.delivered" });
  const key = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");

  assert.equal(verifyResendSignature(secret, { id, timestamp, signature: `v1,${sig}` }, body), true);
  assert.equal(verifyResendSignature(secret, { id, timestamp, signature: "v1,bogus" }, body), false);
  assert.equal(verifyResendSignature(secret, { id: null, timestamp, signature: `v1,${sig}` }, body), false);
});

test("POST /webhooks/resend processes an event end-to-end", async () => {
  const providerId = "re_" + uid();
  const to = `e2e+${uid()}@example.com`;
  const { hotelId } = await seedDelivery({ providerId, to });

  const server: Server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  const base = "http://127.0.0.1:" + addr.port;
  try {
    const r = await fetch(base + "/webhooks/resend", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ type: "email.bounced", data: { email_id: providerId, to: [to], bounce: { type: "Permanent" } } }),
    });
    assert.equal(r.status, 200);
    const supp = await prisma.emailSuppression.findUnique({ where: { hotelId_email: { hotelId, email: to.toLowerCase() } } });
    assert.ok(supp, "suppression created via webhook");
  } finally {
    await new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
  }
});
