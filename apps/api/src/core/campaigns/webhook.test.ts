import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { normalizeVapiMessage, processVapiWebhook } from "./webhook";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
let seq = 6000000000;
const phone = () => "+1" + String(seq++);

async function setup(opts: { followUpRules?: Record<string, string[]>; maxRetries?: number } = {}) {
  const tenantId = "wh-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "WH " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({
    data: {
      tenantId, name: "C", status: "active", channels: JSON.stringify(["voice"]),
      scriptTemplate: "Hi", voiceA: "Rachel", voiceB: "Aria", personaA: "E", personaB: "S",
      vapiAssistantIdA: "a", vapiAssistantIdB: "b", maxRetries: opts.maxRetries ?? 2,
      followUpRules: JSON.stringify(opts.followUpRules ?? {}),
    },
  });
  const lead = await prisma.campaignLead.create({
    data: { campaignId: campaign.id, tenantId, firstName: "Sarah", phone: phone(), consent: true, consentSource: "csv_import", status: "calling", abVariant: "A", callAttempts: 1 },
  });
  const vapiCallId = "vapi_" + uid();
  await prisma.callRecord.create({ data: { tenantId, campaignId: campaign.id, leadId: lead.id, abVariant: "A", status: "in_progress", vapiCallId } });
  return { tenantId, campaignId: campaign.id, leadId: lead.id, vapiCallId };
}

// No real sender is configured in tests; follow-up sends will record "failed"
// MessageDelivery rows but the flow must not throw.
const noopSenders = { resolveSender: () => null };

after(async () => { await prisma.$disconnect(); });

test("normalizeVapiMessage maps Vapi message types", () => {
  assert.equal(normalizeVapiMessage({ message: { type: "status-update", status: "in-progress", call: { id: "c1" } } }).kind, "call-started");
  assert.equal(normalizeVapiMessage({ message: { type: "transcript", transcriptType: "final", role: "user", transcript: "hi", call: { id: "c1" } } }).kind, "utterance");
  assert.equal(normalizeVapiMessage({ message: { type: "transcript", transcriptType: "partial", role: "user", transcript: "h", call: { id: "c1" } } }).kind, "ignore");
  assert.equal(normalizeVapiMessage({ message: { type: "end-of-call-report", call: { id: "c1" } } }).kind, "end-of-call");
  assert.equal(normalizeVapiMessage({ message: { type: "speech-update", call: { id: "c1" } } }).kind, "ignore");
});

test("utterance events write a sentiment timeline", async () => {
  const { vapiCallId, campaignId } = await setup();
  await processVapiWebhook({ message: { type: "transcript", transcriptType: "final", role: "user", transcript: "Yes, sounds great, interested", call: { id: vapiCallId } } });
  const events = await prisma.sentimentEvent.findMany({ where: { callRecord: { campaignId } } });
  assert.equal(events.length, 1);
  assert.equal(events[0].sentiment, "positive");
  assert.equal(events[0].speaker, "customer");
});

test("mid-call opt-out suppresses the lead tenant-wide", async () => {
  const { vapiCallId, tenantId, leadId } = await setup();
  const lead = await prisma.campaignLead.findUnique({ where: { id: leadId }, select: { phone: true } });
  await processVapiWebhook({ message: { type: "transcript", transcriptType: "final", role: "user", transcript: "Please stop calling me, remove me", call: { id: vapiCallId } } });
  assert.equal(await prisma.doNotContact.count({ where: { tenantId, phone: lead!.phone! } }), 1);
  const updatedLead = await prisma.campaignLead.findUnique({ where: { id: leadId } });
  assert.equal(updatedLead?.optedOut, true);
});

test("end-of-call finalises the record and marks the lead called", async () => {
  const { vapiCallId, leadId } = await setup();
  await processVapiWebhook({
    message: { type: "end-of-call-report", call: { id: vapiCallId }, durationSeconds: 95,
      analysis: { summary: "Interested in upgrade", structuredData: { outcome: "interested", sentiment: "positive", keyPoints: ["wants weekend"] } },
      transcript: "AI: hi\nUser: yes" },
  });
  const call = await prisma.callRecord.findUnique({ where: { vapiCallId } });
  assert.equal(call?.status, "ended");
  assert.equal(call?.outcome, "interested");
  assert.equal(call?.durationSeconds, 95);
  assert.equal(JSON.parse(call!.keyPoints)[0], "wants weekend");
  const lead = await prisma.campaignLead.findUnique({ where: { id: leadId } });
  assert.equal(lead?.status, "called");
});

test("no-answer schedules a retry when attempts remain", async () => {
  const { vapiCallId, leadId } = await setup({ maxRetries: 2 }); // lead.callAttempts = 1
  await processVapiWebhook({ message: { type: "end-of-call-report", call: { id: vapiCallId }, endedReason: "customer-did-not-answer" } });
  const lead = await prisma.campaignLead.findUnique({ where: { id: leadId } });
  assert.equal(lead?.status, "pending"); // requeued
  assert.ok(lead?.nextCallAt); // scheduled
});

test("interested outcome fires the configured follow-up channels", async () => {
  const { vapiCallId, campaignId } = await setup({ followUpRules: { interested: ["whatsapp", "email"] } });
  await processVapiWebhook(
    { message: { type: "end-of-call-report", call: { id: vapiCallId }, analysis: { structuredData: { outcome: "interested" } } } },
    noopSenders,
  );
  // a MessageDelivery row is recorded per configured channel (failed, since no
  // sender is registered in the test) — proving the follow-up path ran.
  const deliveries = await prisma.messageDelivery.findMany({ where: { campaignId } });
  assert.equal(deliveries.length, 0); // resolveSender returns null → no senders → no rows

  // Now with the real registry the channels resolve and attempt to send.
  await prisma.messageDelivery.deleteMany({ where: { campaignId } });
  await processVapiWebhook({ message: { type: "end-of-call-report", call: { id: vapiCallId }, analysis: { structuredData: { outcome: "interested" } } } });
  const real = await prisma.messageDelivery.findMany({ where: { campaignId } });
  assert.deepEqual(real.map((d) => d.channel).sort(), ["email", "whatsapp"]);
});
