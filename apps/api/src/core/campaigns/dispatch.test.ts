import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { processCampaignChannel } from "./dispatch";
import type { ChannelSender } from "./senders";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

// Fake sender records every send and always succeeds — lets us exercise the
// dispatcher with no Twilio/Resend keys.
const sent: string[] = [];
const fakeSender = (channel: string): ChannelSender => ({
  channel,
  async send(ctx) { sent.push(ctx.lead.phone ?? ""); return { ok: true, providerId: "msg", renderedBody: "hi" }; },
});
const deps = { resolveSender: (c: string) => fakeSender(c), batchSize: 100 };

async function makeCampaign(opts: { spendCapCalls?: number } = {}) {
  const hotelId = "disp-" + uid();
  await prisma.hotel.create({ data: { id: hotelId, name: "Disp " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({
    data: {
      hotelId, name: "WA", status: "active", channels: JSON.stringify(["whatsapp"]),
      whatsappContentSid: "HXtest", whatsappVariables: JSON.stringify(["{lead.firstName}"]),
      spendCapCalls: opts.spendCapCalls ?? null,
    },
  });
  return { hotelId, campaignId: campaign.id };
}

const addLead = (campaignId: string, hotelId: string, phone: string, over: Record<string, unknown> = {}) =>
  prisma.campaignLead.create({
    data: { campaignId, hotelId, firstName: "L", phone, consent: true, consentSource: "csv_import", consentAt: new Date(), ...over },
  });

after(async () => { await prisma.$disconnect(); });

test("dispatch sends to consented leads and is idempotent across ticks", async () => {
  sent.length = 0;
  const { hotelId, campaignId } = await makeCampaign();
  await addLead(campaignId, hotelId, "+1415555" + uid().slice(0, 4));
  await addLead(campaignId, hotelId, "+1415556" + uid().slice(0, 4));

  const first = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(first.sent, 2);
  assert.equal(await prisma.messageDelivery.count({ where: { campaignId, status: "sent" } }), 2);

  // Second tick: both leads already have a delivery row → nothing re-sent.
  const second = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(second.sent, 0);
});

test("dispatch skips leads that fail the pre-send guard (no consent / suppressed)", async () => {
  const { hotelId, campaignId } = await makeCampaign();
  await addLead(campaignId, hotelId, "+1415557" + uid().slice(0, 4), { consent: false }); // no consent
  const suppPhone = "+1415558" + uid().slice(0, 4);
  await addLead(campaignId, hotelId, suppPhone, { consent: true });
  await prisma.doNotContact.create({ data: { hotelId, phone: suppPhone, reason: "opt_out" } });

  const r = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 2);
  const reasons = (await prisma.messageDelivery.findMany({ where: { campaignId }, select: { error: true } })).map((d) => d.error).sort();
  assert.deepEqual(reasons, ["no_consent", "suppressed"]);
});

test("dispatch enforces the spend cap and auto-pauses the campaign", async () => {
  const { hotelId, campaignId } = await makeCampaign({ spendCapCalls: 1 });
  await addLead(campaignId, hotelId, "+1415559" + uid().slice(0, 4));
  await addLead(campaignId, hotelId, "+1415560" + uid().slice(0, 4));

  const r1 = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(r1.sent, 1); // capped to remaining budget

  const r2 = await processCampaignChannel(campaignId, "whatsapp", deps);
  assert.equal(r2.sent, 0); // cap reached → no more
  const after = await prisma.voiceCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  assert.equal(after?.status, "paused");
});
