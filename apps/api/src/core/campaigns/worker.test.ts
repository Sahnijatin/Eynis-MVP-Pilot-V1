import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { processVoiceCampaign } from "./worker";
import type { VapiCredentials, VapiResult, CallParams } from "./vapi";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
let phoneSeq = 5000000000;
const phone = () => "+1" + String(phoneSeq++); // unique, valid-length E.164
const creds: VapiCredentials = { apiKey: "k", phoneNumberId: "pn_1", webhookSecret: "s" };

const okCall = async (): Promise<VapiResult<{ id: string }>> => ({ ok: true, data: { id: "vapi_" + uid() } });
const baseDeps = { resolveCreds: async () => creds, initiateCall: okCall };

async function makeVoiceCampaign(opts: { maxConcurrent?: number; spendCapCalls?: number } = {}) {
  const tenantId = "dial-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Dial " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({
    data: {
      tenantId, name: "Calls", status: "active", channels: JSON.stringify(["voice"]),
      scriptTemplate: "Hi {lead.firstName}", voiceA: "Rachel", voiceB: "Aria", personaA: "E", personaB: "S",
      vapiAssistantIdA: "asstA", vapiAssistantIdB: "asstB",
      maxConcurrent: opts.maxConcurrent ?? 5, spendCapCalls: opts.spendCapCalls ?? null,
    },
  });
  return { tenantId, campaignId: campaign.id };
}
const addLead = (campaignId: string, tenantId: string, phone: string, over: Record<string, unknown> = {}) =>
  prisma.campaignLead.create({ data: { campaignId, tenantId, firstName: "L", phone, consent: true, consentSource: "csv_import", consentAt: new Date(), ...over } });

after(async () => { await prisma.$disconnect(); });

test("dials consented leads, records in_progress calls, and balances A/B", async () => {
  const { tenantId, campaignId } = await makeVoiceCampaign();
  for (let i = 0; i < 4; i++) await addLead(campaignId, tenantId, phone());

  const r = await processVoiceCampaign(campaignId, baseDeps);
  assert.equal(r.dialed, 4);
  const calls = await prisma.callRecord.findMany({ where: { campaignId } });
  assert.equal(calls.length, 4);
  assert.ok(calls.every((c) => c.status === "in_progress" && c.vapiCallId));
  const a = calls.filter((c) => c.abVariant === "A").length;
  const b = calls.filter((c) => c.abVariant === "B").length;
  assert.deepEqual([a, b].sort(), [2, 2]); // balanced alternation
});

test("respects maxConcurrent and does not re-dial calling leads (atomic lock)", async () => {
  const { tenantId, campaignId } = await makeVoiceCampaign({ maxConcurrent: 2 });
  for (let i = 0; i < 5; i++) await addLead(campaignId, tenantId, phone());

  const first = await processVoiceCampaign(campaignId, baseDeps);
  assert.equal(first.dialed, 2); // only 2 slots

  // In-flight calls occupy slots → next tick dials nothing more.
  const second = await processVoiceCampaign(campaignId, baseDeps);
  assert.equal(second.dialed, 0);
  assert.equal(await prisma.callRecord.count({ where: { campaignId, status: "in_progress" } }), 2);
});

test("skips guard failures (no consent / suppressed)", async () => {
  const { tenantId, campaignId } = await makeVoiceCampaign();
  await addLead(campaignId, tenantId, phone(), { consent: false });
  const supp = phone();
  await addLead(campaignId, tenantId, supp);
  await prisma.doNotContact.create({ data: { tenantId, phone: supp, reason: "opt_out" } });

  const r = await processVoiceCampaign(campaignId, baseDeps);
  assert.equal(r.dialed, 0);
  assert.equal(r.skipped, 2);
  const statuses = (await prisma.campaignLead.findMany({ where: { campaignId }, select: { status: true } })).map((l) => l.status).sort();
  assert.deepEqual(statuses, ["failed", "opted_out"]); // no_consent→failed, suppressed→opted_out
});

test("failed initiation returns the lead to the queue (no silent failure)", async () => {
  const { tenantId, campaignId } = await makeVoiceCampaign();
  await addLead(campaignId, tenantId, phone());
  const failCall = async (): Promise<VapiResult<{ id: string }>> => ({ ok: false, error: "Vapi API error 400: bad" });

  const r = await processVoiceCampaign(campaignId, { resolveCreds: async () => creds, initiateCall: failCall });
  assert.equal(r.failed, 1);
  const lead = await prisma.campaignLead.findFirst({ where: { campaignId } });
  assert.equal(lead?.status, "pending"); // back in the queue
  assert.equal(await prisma.callRecord.count({ where: { campaignId, status: "failed" } }), 1);
});

test("provider 5xx auto-pauses the campaign", async () => {
  const { tenantId, campaignId } = await makeVoiceCampaign();
  await addLead(campaignId, tenantId, phone());
  const err5xx = async (): Promise<VapiResult<{ id: string }>> => ({ ok: false, error: "Vapi API error 503: down" });

  await processVoiceCampaign(campaignId, { resolveCreds: async () => creds, initiateCall: err5xx });
  const c = await prisma.voiceCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  assert.equal(c?.status, "paused");
});

test("spend cap auto-pauses when exhausted", async () => {
  const { tenantId, campaignId } = await makeVoiceCampaign({ spendCapCalls: 1 });
  await addLead(campaignId, tenantId, phone());
  await addLead(campaignId, tenantId, phone());

  const r1 = await processVoiceCampaign(campaignId, baseDeps);
  assert.equal(r1.dialed, 1); // capped
  const r2 = await processVoiceCampaign(campaignId, baseDeps);
  assert.equal(r2.dialed, 0);
  const c = await prisma.voiceCampaign.findUnique({ where: { id: campaignId }, select: { status: true } });
  assert.equal(c?.status, "paused");
});

test("recovers a stuck in-flight call and re-dials the lead", async () => {
  const { tenantId, campaignId } = await makeVoiceCampaign();
  const lead = await addLead(campaignId, tenantId, phone(), { status: "calling", abVariant: "A" });
  // A call stuck in-flight for 20 minutes.
  await prisma.callRecord.create({
    data: { tenantId, campaignId, leadId: lead.id, abVariant: "A", status: "in_progress", createdAt: new Date(Date.now() - 20 * 60_000) },
  });

  const r = await processVoiceCampaign(campaignId, baseDeps);
  // stuck call failed, lead reset to pending then re-dialled this tick
  assert.equal(await prisma.callRecord.count({ where: { campaignId, status: "failed", error: "stuck_timeout" } }), 1);
  assert.equal(r.dialed, 1);
});
