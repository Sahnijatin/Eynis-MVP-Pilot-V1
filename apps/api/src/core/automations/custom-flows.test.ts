import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { evaluateCustomFlows, resolveTriggerEntities } from "./custom-flows";
import { buildFlowConfig } from "./flow";

const uid = () => "cflow-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 8);
const created: string[] = [];

async function newTenant() {
  const tenantId = uid();
  created.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, name: "Flow Co", timezone: "Asia/Kolkata" } });
  return tenantId;
}
async function newFlow(tenantId: string, opts: { trigger: string; action: string; detail?: string; createdAt?: Date }) {
  const cfg = buildFlowConfig({ name: "f", trigger: opts.trigger, action: opts.action, channels: [], delayHours: 0, detail: opts.detail ?? null, sequenceId: null, isActive: true });
  return prisma.automationRule.create({ data: { tenantId, code: "flow_" + uid(), name: "Test flow", isActive: true, configJson: cfg, ...(opts.createdAt ? { createdAt: opts.createdAt } : {}) } });
}

after(async () => {
  for (const id of created) await prisma.tenant.deleteMany({ where: { id } });
  await prisma.$disconnect();
});

test("create_task flow: a new lead created after the flow → a follow-up task + a success execution", async () => {
  const tenantId = await newTenant();
  const flow = await newFlow(tenantId, { trigger: "new_lead", action: "create_task", detail: "Reach out within a day" });
  // A contact that lands AFTER the flow exists.
  const contact = await prisma.contact.create({ data: { tenantId, fullName: "Lead One", phoneE164: "+910000000001" } });

  await evaluateCustomFlows();

  // The action ran: a task activity exists for the contact.
  const tasks = await prisma.activity.findMany({ where: { tenantId, contactId: contact.id, type: "task" } });
  assert.equal(tasks.length, 1, "one follow-up task created");
  assert.match(tasks[0].title, /Lead One/);

  // The execution was recorded as a success (this is what GET /automations counts).
  const execs = await prisma.automationExecution.findMany({ where: { ruleId: flow.id } });
  assert.equal(execs.length, 1);
  assert.equal(execs[0].actionResult, "success");
  assert.equal(execs[0].triggerType, "new_lead");
  assert.equal(execs[0].actionType, "create_task");

  // Idempotent: a second cycle does not re-fire for the same contact.
  await evaluateCustomFlows();
  assert.equal(await prisma.activity.count({ where: { tenantId, contactId: contact.id, type: "task" } }), 1, "no duplicate task");
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: flow.id } }), 1, "no duplicate execution");
});

test("event triggers only fire for entities created AFTER the flow (no retroactive blast)", async () => {
  const tenantId = await newTenant();
  // A contact that existed BEFORE the flow.
  const old = await prisma.contact.create({ data: { tenantId, fullName: "Old Lead", phoneE164: "+910000000002", createdAt: new Date(Date.now() - 7 * 24 * 3600_000) } });
  const flow = await newFlow(tenantId, { trigger: "new_lead", action: "create_task" });

  await evaluateCustomFlows();
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: flow.id } }), 0, "pre-existing lead is not actioned");
  assert.equal(await prisma.activity.count({ where: { tenantId, contactId: old.id, type: "task" } }), 0);
});

test("send_whatsapp with no phone on the contact is skipped (not failed)", async () => {
  const tenantId = await newTenant();
  const flow = await newFlow(tenantId, { trigger: "new_lead", action: "send_whatsapp" });
  // phoneE164 is required on Contact, but resolveTriggerEntities/action guard on empty.
  const contact = await prisma.contact.create({ data: { tenantId, fullName: "No Phone", phoneE164: "" } });

  await evaluateCustomFlows();
  const execs = await prisma.automationExecution.findMany({ where: { ruleId: flow.id } });
  assert.equal(execs.length, 1, "one execution recorded");
  assert.equal(execs[0].actionResult, "skipped");
  assert.match(execs[0].resultDetail ?? "", /phone/i);
  assert.equal(await prisma.contact.findFirst({ where: { id: contact.id } }) !== null, true);
});

test("multi_touch_followup: a new lead is enrolled into the tenant's active sequence", async () => {
  const tenantId = await newTenant();
  // An active sequence with one step for the tenant to enroll into.
  const seq = await prisma.sequence.create({ data: { tenantId, name: "Re-engage", status: "active" } });
  await prisma.sequenceStep.create({ data: { sequenceId: seq.id, order: 0, waitMinutes: 0, channel: "whatsapp" } });
  const flow = await newFlow(tenantId, { trigger: "new_lead", action: "multi_touch_followup" });
  const contact = await prisma.contact.create({ data: { tenantId, fullName: "Enroll Me", phoneE164: "+910000000009", email: "e@x.test" } });

  await evaluateCustomFlows();

  // The contact is enrolled (via a find-or-created CampaignLead) and the execution succeeded.
  const lead = await prisma.campaignLead.findFirst({ where: { tenantId, contactId: contact.id } });
  assert.ok(lead, "a campaign lead was created for the contact");
  const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { tenantId, sequenceId: seq.id, leadId: lead!.id } });
  assert.ok(enrollment, "the contact is enrolled in the sequence");
  const execs = await prisma.automationExecution.findMany({ where: { ruleId: flow.id } });
  assert.equal(execs.length, 1);
  assert.equal(execs[0].actionResult, "success");
  assert.match(execs[0].resultDetail ?? "", /Enrolled/);

  // Idempotent — no duplicate enrollment on a second cycle.
  await evaluateCustomFlows();
  assert.equal(await prisma.sequenceEnrollment.count({ where: { tenantId, sequenceId: seq.id, leadId: lead!.id } }), 1);
});

test("multi_touch_followup with no active sequence falls back to a follow-up task", async () => {
  const tenantId = await newTenant();
  const flow = await newFlow(tenantId, { trigger: "new_lead", action: "multi_touch_followup" });
  const contact = await prisma.contact.create({ data: { tenantId, fullName: "No Seq", phoneE164: "+910000000010" } });

  await evaluateCustomFlows();
  assert.equal(await prisma.activity.count({ where: { tenantId, contactId: contact.id, type: "task" } }), 1, "fallback task created");
  const execs = await prisma.automationExecution.findMany({ where: { ruleId: flow.id } });
  assert.equal(execs[0].actionResult, "success");
  assert.match(execs[0].resultDetail ?? "", /no active sequence/i);
});

test("resolveTriggerEntities: unknown trigger resolves to no entities", async () => {
  const tenantId = await newTenant();
  const rows = await resolveTriggerEntities(tenantId, "not_a_trigger", 0, new Date(0));
  assert.deepEqual(rows, []);
});
