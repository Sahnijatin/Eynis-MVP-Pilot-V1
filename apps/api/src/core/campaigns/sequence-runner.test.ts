import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { processDueEnrollments } from "./sequence-runner";
import type { ChannelSender } from "./senders";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const fakeSender = (channel: string): ChannelSender => ({ channel, async send() { return { ok: true, providerId: "m", renderedBody: "hi" }; } });
const deps = { resolveSender: (c: string) => fakeSender(c), batchSize: 100 };

async function setup(opts: { steps: any[]; exitOn?: string[]; leadOver?: Record<string, unknown> }) {
  const tenantId = "seq-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Seq " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  const campaign = await prisma.voiceCampaign.create({ data: { tenantId, name: "C", status: "draft", channels: JSON.stringify(["whatsapp"]) } });
  const lead = await prisma.campaignLead.create({ data: { campaignId: campaign.id, tenantId, firstName: "L", phone: "+9190000" + uid().replace(/\D/g, "").slice(0, 5).padEnd(5, "0"), consent: true, consentSource: "csv_import", ...opts.leadOver } });
  const seq = await prisma.sequence.create({
    data: {
      tenantId, name: "Drip", status: "active", exitOn: JSON.stringify(opts.exitOn ?? ["opted_out", "replied"]),
      steps: { create: opts.steps },
    },
  });
  const enrollment = await prisma.sequenceEnrollment.create({ data: { sequenceId: seq.id, tenantId, leadId: lead.id, currentStepOrder: 0, nextRunAt: new Date(Date.now() - 1000) } });
  return { tenantId, seq, lead, enrollment };
}

const wa = (waitMinutes = 0) => ({ order: 0, waitMinutes, channel: "whatsapp", whatsappContentSid: "HX", whatsappVariables: "[]" });

after(async () => { await prisma.$disconnect(); });

test("runner: advances through steps with delay, logs events, completes", async () => {
  const { seq, enrollment } = await setup({
    steps: [
      { order: 0, waitMinutes: 0, channel: "whatsapp", whatsappContentSid: "HX", whatsappVariables: "[]" },
      { order: 1, waitMinutes: 1440, channel: "whatsapp", whatsappContentSid: "HX2", whatsappVariables: "[]" },
    ],
  });

  // Tick 1: step 0 sends, enrollment advances to step 1 with a future nextRunAt.
  const r1 = await processDueEnrollments(deps);
  assert.equal(r1.sent, 1);
  let e = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
  assert.equal(e!.currentStepOrder, 1);
  assert.equal(e!.status, "active");
  assert.ok(e!.nextRunAt.getTime() > Date.now()); // 1 day out
  assert.equal(await prisma.sequenceEvent.count({ where: { sequenceId: seq.id, status: "sent" } }), 1);

  // Not due yet → nothing happens.
  assert.equal((await processDueEnrollments(deps)).sent, 0);

  // Backdate → step 1 sends, enrollment completes.
  await prisma.sequenceEnrollment.update({ where: { id: enrollment.id }, data: { nextRunAt: new Date(Date.now() - 1000) } });
  const r2 = await processDueEnrollments(deps);
  assert.equal(r2.sent, 1);
  e = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
  assert.equal(e!.status, "completed");
});

test("runner: exits early when the lead has replied", async () => {
  const { tenantId, lead, enrollment } = await setup({ steps: [wa()], exitOn: ["replied"] });
  // an inbound WhatsApp message after enrollment
  const convo = await prisma.whatsappConversation.create({ data: { tenantId, campaignId: (await prisma.campaignLead.findUnique({ where: { id: lead.id }, select: { campaignId: true } }))!.campaignId, leadId: lead.id } });
  await prisma.whatsappMessage.create({ data: { tenantId, conversationId: convo.id, direction: "in", body: "stop emailing me" } });

  const r = await processDueEnrollments(deps);
  assert.equal(r.sent, 0);
  assert.equal(r.stopped, 1);
  const e = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
  assert.equal(e!.status, "stopped");
  assert.equal(e!.stoppedReason, "replied");
});

test("runner: compliance guard stops a non-consented lead", async () => {
  const { enrollment } = await setup({ steps: [wa()], leadOver: { consent: false, consentSource: null } });
  const r = await processDueEnrollments(deps);
  assert.equal(r.sent, 0);
  assert.equal(r.skipped, 1);
  const e = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
  assert.equal(e!.status, "stopped");
});

test("runner: only fires for active sequences", async () => {
  const { seq, enrollment } = await setup({ steps: [wa()] });
  await prisma.sequence.update({ where: { id: seq.id }, data: { status: "draft" } });
  const r = await processDueEnrollments(deps);
  assert.equal(r.sent, 0);
  const e = await prisma.sequenceEnrollment.findUnique({ where: { id: enrollment.id } });
  assert.equal(e!.currentStepOrder, 0); // untouched
});
