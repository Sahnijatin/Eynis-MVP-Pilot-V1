import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { channelsForOutcome, handlePostCallFollowUp } from "./followup";
import type { ChannelSender } from "./senders";

// F-14: post-call follow-up was untested and had diverged from the dispatcher —
// missing the WhatsApp approved-template gate, suppression checks, and idempotency.
const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const sentLog: string[] = [];
const okSender = (channel: string): ChannelSender => ({
  channel,
  async send() { sentLog.push(channel); return { ok: true, providerId: "m", renderedBody: "hi" }; },
});
const deps = { resolveSender: okSender };

async function setup(opts: { followUpRules: Record<string, string[]>; leadOver?: Record<string, unknown>; callOver?: Record<string, unknown> } = { followUpRules: { interested: ["whatsapp"] } }) {
  const tenantId = "fu-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "FU " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({
    data: { tenantId, name: "C", status: "active", channels: JSON.stringify(["voice"]), whatsappContentSid: "HXtest", followUpRules: JSON.stringify(opts.followUpRules) },
  });
  const lead = await prisma.campaignLead.create({
    data: { campaignId: campaign.id, tenantId, firstName: "L", phone: "+1415550" + uid().slice(0, 4), email: `${uid()}@ex.com`, consent: true, consentSource: "csv_import", ...opts.leadOver },
  });
  const call = await prisma.callRecord.create({
    data: { tenantId, campaignId: campaign.id, leadId: lead.id, abVariant: "A", status: "ended", outcome: "interested", ...opts.callOver },
  });
  return { tenantId, campaign, lead, call };
}

after(async () => { await prisma.$disconnect(); });

test("channelsForOutcome maps outcome → channels and filters unknowns", () => {
  assert.deepEqual(channelsForOutcome('{"interested":["whatsapp","email","carrier-pigeon"]}', "interested"), ["whatsapp", "email"]);
  assert.deepEqual(channelsForOutcome("{}", "interested"), []);
  assert.deepEqual(channelsForOutcome('{"interested":["whatsapp"]}', null), []);
});

test("sends the configured channel and records a delivery", async () => {
  sentLog.length = 0;
  const { call, campaign, lead } = await setup({ followUpRules: { interested: ["whatsapp"] } });
  const r = await handlePostCallFollowUp(call.id, deps);
  assert.deepEqual(r.sent, ["whatsapp"]);
  assert.equal(await prisma.messageDelivery.count({ where: { campaignId: campaign.id, leadId: lead.id, channel: "whatsapp", status: "sent" } }), 1);
});

test("is idempotent — a re-delivered end-of-call does not re-send (F-14)", async () => {
  sentLog.length = 0;
  const { call } = await setup({ followUpRules: { interested: ["whatsapp"] } });
  await handlePostCallFollowUp(call.id, deps);
  await handlePostCallFollowUp(call.id, deps); // re-delivery
  assert.equal(sentLog.filter((c) => c === "whatsapp").length, 1, "whatsapp must be sent only once");
});

test("skips a whatsapp follow-up to a phone on the DoNotContact list (F-14)", async () => {
  sentLog.length = 0;
  const { call, lead, tenantId } = await setup({ followUpRules: { interested: ["whatsapp"] } });
  await prisma.doNotContact.create({ data: { tenantId, phone: lead.phone!, reason: "opt_out" } });
  const r = await handlePostCallFollowUp(call.id, deps);
  assert.deepEqual(r.sent, [], "suppressed phone must not receive a follow-up");
});

test("never follows up an opted-out lead", async () => {
  sentLog.length = 0;
  const { call } = await setup({ followUpRules: { interested: ["whatsapp"] }, leadOver: { optedOut: true } });
  const r = await handlePostCallFollowUp(call.id, deps);
  assert.deepEqual(r.sent, []);
});

test("skips whatsapp when the campaign's template is no longer approved (F-14)", async () => {
  sentLog.length = 0;
  const tenantId = "fu-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "FU " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  // A template that is NOT approved → resolveApprovedWhatsappTemplate returns null.
  const tmpl = await prisma.messageTemplate.create({
    data: { tenantId, name: "T", channel: "whatsapp", body: "Hi {{1}}", status: "submitted" },
  });
  const campaign = await prisma.voiceCampaign.create({
    data: { tenantId, name: "C", status: "active", channels: JSON.stringify(["voice"]), whatsappTemplateId: tmpl.id, followUpRules: JSON.stringify({ interested: ["whatsapp"] }) },
  });
  const lead = await prisma.campaignLead.create({
    data: { campaignId: campaign.id, tenantId, firstName: "L", phone: "+1415559" + uid().slice(0, 4), consent: true, consentSource: "csv_import" },
  });
  const call = await prisma.callRecord.create({
    data: { tenantId, campaignId: campaign.id, leadId: lead.id, abVariant: "A", status: "ended", outcome: "interested" },
  });
  const r = await handlePostCallFollowUp(call.id, deps);
  assert.deepEqual(r.sent, [], "un-approved template must block the WhatsApp follow-up");
});
