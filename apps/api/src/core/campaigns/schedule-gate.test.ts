import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { processCampaignChannel } from "./dispatch";
import { localParts } from "./schedule";
import type { ChannelSender } from "./senders";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const fakeSender = (channel: string): ChannelSender => ({ channel, async send() { return { ok: true, providerId: "m", renderedBody: "hi" }; } });
const deps = { resolveSender: (c: string) => fakeSender(c), batchSize: 100 };
const TZ = "Asia/Kolkata";

async function campaignWithLeads(extra: Record<string, unknown>) {
  const tenantId = "sch-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Sch " + tenantId.slice(-4), timezone: TZ } });
  const campaign = await prisma.voiceCampaign.create({
    data: { tenantId, name: "Sch", status: "active", channels: JSON.stringify(["whatsapp"]), whatsappContentSid: "HX", sendTimeZone: TZ, ...extra },
  });
  await prisma.campaignLead.create({ data: { campaignId: campaign.id, tenantId, firstName: "A", phone: "+919000010001", consent: true, consentSource: "csv_import" } });
  await prisma.campaignLead.create({ data: { campaignId: campaign.id, tenantId, firstName: "B", phone: "+919000010002", consent: true, consentSource: "csv_import" } });
  return campaign.id;
}

after(async () => { await prisma.$disconnect(); });

test("schedule gate: no schedule → sends (control)", async () => {
  const id = await campaignWithLeads({});
  const r = await processCampaignChannel(id, "whatsapp", deps);
  assert.equal(r.sent, 2);
});

test("schedule gate: future scheduledStartAt blocks all sends", async () => {
  const id = await campaignWithLeads({ scheduledStartAt: new Date(Date.now() + 3_600_000) });
  const r = await processCampaignChannel(id, "whatsapp", deps);
  assert.equal(r.sent, 0);
  assert.equal(await prisma.messageDelivery.count({ where: { campaignId: id } }), 0);
});

test("schedule gate: a day-of-week that excludes today blocks sends", async () => {
  const today = localParts(new Date(), TZ).weekday;
  const everyDayButToday = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== today);
  const id = await campaignWithLeads({ sendDays: JSON.stringify(everyDayButToday) });
  const r = await processCampaignChannel(id, "whatsapp", deps);
  assert.equal(r.sent, 0);
});

test("schedule gate: a 1-minute window not covering now blocks sends", async () => {
  const nowMin = localParts(new Date(), TZ).minuteOfDay;
  // pick a window two hours away (deterministically not "now")
  const start = (nowMin + 120) % 1440;
  const end = (start + 1) % 1440;
  const id = await campaignWithLeads({ sendWindowStartMin: start, sendWindowEndMin: end });
  const r = await processCampaignChannel(id, "whatsapp", deps);
  assert.equal(r.sent, 0);
});
