import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { processCampaignChannel } from "./dispatch";
import { isApprovedWhatsappTemplate } from "./whatsapp-template";
import type { ChannelSender } from "./senders";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "VC " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
const createUser = (tenantId: string, email: string) => prisma.user.create({ data: { tenantId, fullName: "U", email, role: "owner", isActive: true } });
async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
const authH = async (base: string, tenantId: string, email: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, role: "owner" }) });
  return "Bearer " + ((await r.json()) as { token: string }).token;
};
const approvedTpl = (tenantId: string, sid = "HXAPPROVED") =>
  prisma.messageTemplate.create({ data: { tenantId, name: "T", channel: "whatsapp", body: "Hi", status: "approved", providerTemplateId: sid, variables: "[]" } });

after(async () => { await prisma.$disconnect(); });

test("isApprovedWhatsappTemplate: only approved whatsapp with a provider id passes", () => {
  assert.equal(isApprovedWhatsappTemplate({ channel: "whatsapp", status: "approved", providerTemplateId: "HX" }), true);
  assert.equal(isApprovedWhatsappTemplate({ channel: "whatsapp", status: "submitted", providerTemplateId: "HX" }), false);
  assert.equal(isApprovedWhatsappTemplate({ channel: "whatsapp", status: "approved", providerTemplateId: null }), false);
  assert.equal(isApprovedWhatsappTemplate({ channel: "email", status: "approved", providerTemplateId: "HX" }), false);
  assert.equal(isApprovedWhatsappTemplate(null), false);
});

test("activation: a WhatsApp campaign cannot activate without an approved template", async () => {
  const tenantId = "wae-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, email);
  const { server, base } = await startServer();
  try {
    const token = await authH(base, tenantId, email);
    const campaign = await prisma.voiceCampaign.create({ data: { tenantId, name: "WA", status: "draft", channels: JSON.stringify(["whatsapp"]) } });

    // no template → blocked
    const blocked = await fetch(base + `/campaigns/${campaign.id}/activate`, { method: "POST", headers: { authorization: token } });
    assert.equal(blocked.status, 400);
    assert.match(((await blocked.json()) as any).error, /approved template/i);

    // attach an approved template → activates
    const tpl = await approvedTpl(tenantId);
    await prisma.voiceCampaign.update({ where: { id: campaign.id }, data: { whatsappTemplateId: tpl.id } });
    const ok = await fetch(base + `/campaigns/${campaign.id}/activate`, { method: "POST", headers: { authorization: token } });
    assert.equal(ok.status, 200);
    assert.equal(((await ok.json()) as any).campaign.status, "active");
  } finally {
    await stop(server);
  }
});

test("dispatch: WhatsApp send uses the approved template's Content SID", async () => {
  const tenantId = "wae-" + uid();
  await createHotel(tenantId);
  const tpl = await approvedTpl(tenantId, "HXLIVE");
  const campaign = await prisma.voiceCampaign.create({ data: { tenantId, name: "WA", status: "active", channels: JSON.stringify(["whatsapp"]), whatsappContentSid: "HXLEGACY", whatsappTemplateId: tpl.id } });
  await prisma.campaignLead.create({ data: { campaignId: campaign.id, tenantId, firstName: "A", phone: "+919000030001", consent: true, consentSource: "csv_import" } });

  let usedSid: string | null = null;
  const capturing: ChannelSender = { channel: "whatsapp", async send(ctx) { usedSid = ctx.campaign.whatsappContentSid; return { ok: true, providerId: "m" }; } };
  const r = await processCampaignChannel(campaign.id, "whatsapp", { resolveSender: () => capturing, batchSize: 10 });
  assert.equal(r.sent, 1);
  assert.equal(usedSid, "HXLIVE"); // approved template wins over the legacy SID
});

test("dispatch: sends nothing when the referenced template is not approved", async () => {
  const tenantId = "wae-" + uid();
  await createHotel(tenantId);
  const tpl = await prisma.messageTemplate.create({ data: { tenantId, name: "T", channel: "whatsapp", body: "Hi", status: "submitted", variables: "[]" } });
  const campaign = await prisma.voiceCampaign.create({ data: { tenantId, name: "WA", status: "active", channels: JSON.stringify(["whatsapp"]), whatsappTemplateId: tpl.id } });
  await prisma.campaignLead.create({ data: { campaignId: campaign.id, tenantId, firstName: "A", phone: "+919000030002", consent: true, consentSource: "csv_import" } });

  let called = false;
  const capturing: ChannelSender = { channel: "whatsapp", async send() { called = true; return { ok: true }; } };
  const r = await processCampaignChannel(campaign.id, "whatsapp", { resolveSender: () => capturing, batchSize: 10 });
  assert.equal(r.sent, 0);
  assert.equal(called, false);
});

test("sequence activation: a WhatsApp step needs an approved template", async () => {
  const tenantId = "wae-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, email);
  const { server, base } = await startServer();
  try {
    const token = await authH(base, tenantId, email);
    const seq = await prisma.sequence.create({ data: { tenantId, name: "S", status: "draft", steps: { create: [{ order: 0, waitMinutes: 0, channel: "whatsapp", whatsappContentSid: "HXraw" }] } } });

    // raw SID but no approved template → cannot activate
    const blocked = await fetch(base + `/sequences/${seq.id}`, { method: "PATCH", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) });
    assert.equal(blocked.status, 400);

    // attach approved template to the step → activates
    const tpl = await approvedTpl(tenantId);
    await prisma.sequenceStep.updateMany({ where: { sequenceId: seq.id }, data: { whatsappTemplateId: tpl.id } });
    const ok = await fetch(base + `/sequences/${seq.id}`, { method: "PATCH", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ status: "active" }) });
    assert.equal(ok.status, 200);
  } finally {
    await stop(server);
  }
});
