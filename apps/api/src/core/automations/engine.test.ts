import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import {
  evaluateSlaBreachEscalate,
  evaluateSentimentLowFlag,
  evaluateCheckinWelcome,
  evaluateUpsellFollowup,
} from "./engine";

// F-6: the automation engine previously had ZERO test coverage despite being one of
// the highest-risk subsystems. These integration tests run each rule against the
// real Postgres test DB and assert the action + idempotency + tenant scoping.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

async function makeTenant() {
  const tenantId = "auto-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Auto " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  return tenantId;
}

const makeRule = (tenantId: string, code: string) =>
  prisma.automationRule.create({ data: { tenantId, code, name: code, isActive: true, configJson: "{}" } });

const makeContact = (tenantId: string) =>
  prisma.contact.create({ data: { tenantId, fullName: "Guest " + uid(), phoneE164: "+91990000" + uid().slice(0, 4) } });

after(async () => { await prisma.$disconnect(); });

test("Rule 1 (sla_breach_escalate): escalates a breached SR once and is idempotent", async () => {
  const tenantId = await makeTenant();
  const rule = await makeRule(tenantId, "sla_breach_escalate");
  const guest = await makeContact(tenantId);
  const sr = await prisma.serviceRequest.create({
    data: {
      tenantId, guestId: guest.id, category: "housekeeping", status: "open", summary: "Towels please",
      slaDueAt: new Date(Date.now() - 60_000), // already breached
    },
  });

  await evaluateSlaBreachEscalate();

  const after1 = await prisma.serviceRequest.findUnique({ where: { id: sr.id } });
  assert.equal(after1?.status, "escalated");
  assert.ok(after1?.slaBreachedAt, "slaBreachedAt should be set");
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: rule.id, triggerEntityId: sr.id } }), 1);

  // Second cycle must not re-escalate or double-record.
  await evaluateSlaBreachEscalate();
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: rule.id, triggerEntityId: sr.id } }), 1);
});

test("Rule 2 (sentiment_low_flag): creates one front_desk SR per negative event, idempotent", async () => {
  const tenantId = await makeTenant();
  const rule = await makeRule(tenantId, "sentiment_low_flag");
  const guest = await makeContact(tenantId);
  const event = await prisma.connectorEvent.create({
    data: { tenantId, connectorKey: "whatsapp_twilio", rawPayload: "{}", guestId: guest.id, guestName: "Angry Guest", aiSentiment: "negative", aiSummary: "Room was dirty" },
  });

  await evaluateSentimentLowFlag();

  const srs = await prisma.serviceRequest.findMany({ where: { tenantId, source: "automation", guestId: guest.id } });
  assert.equal(srs.length, 1);
  assert.equal(srs[0].category, "front_desk");
  assert.equal(srs[0].priority, "high");

  await evaluateSentimentLowFlag();
  assert.equal(await prisma.serviceRequest.count({ where: { tenantId, source: "automation", guestId: guest.id } }), 1);
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: rule.id, triggerEntityId: event.id } }), 1);
});

test("Rule 4 (upsell_followup): queues an offer matching the resolved category, idempotent", async () => {
  const tenantId = await makeTenant();
  const rule = await makeRule(tenantId, "upsell_followup");
  const guest = await makeContact(tenantId);
  const sr = await prisma.serviceRequest.create({
    data: { tenantId, guestId: guest.id, category: "fnb", status: "resolved", summary: "Dinner order", resolvedAt: new Date() },
  });

  await evaluateUpsellFollowup();

  const offers = await prisma.offerEvent.findMany({ where: { tenantId, guestId: guest.id } });
  assert.equal(offers.length, 1);
  assert.equal(offers[0].offerType, "fnb_offer");

  await evaluateUpsellFollowup();
  assert.equal(await prisma.offerEvent.count({ where: { tenantId, guestId: guest.id } }), 1);
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: rule.id, triggerEntityId: sr.id } }), 1);
});

test("Rule 3 (checkin_welcome): records exactly one execution per recent check-in", async () => {
  const tenantId = await makeTenant();
  const rule = await makeRule(tenantId, "checkin_welcome");
  const guest = await makeContact(tenantId);
  const stay = await prisma.stay.create({
    data: { tenantId, guestId: guest.id, roomNumber: "204", checkInAt: new Date(), checkOutAt: new Date(Date.now() + 86_400_000) },
  });

  // No WhatsApp keys in test → the send returns sent:false, but an execution row is
  // still recorded so the welcome is never retried (idempotency is what we assert).
  await evaluateCheckinWelcome();
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: rule.id, triggerEntityId: stay.id } }), 1);

  await evaluateCheckinWelcome();
  assert.equal(await prisma.automationExecution.count({ where: { ruleId: rule.id, triggerEntityId: stay.id } }), 1);
});

test("multi-tenant: a rule only acts on its own tenant's entities", async () => {
  const tenantA = await makeTenant();
  const tenantB = await makeTenant();
  await makeRule(tenantA, "sla_breach_escalate"); // only A has the rule
  const guestA = await makeContact(tenantA);
  const guestB = await makeContact(tenantB);
  const srA = await prisma.serviceRequest.create({
    data: { tenantId: tenantA, guestId: guestA.id, category: "maintenance", status: "open", summary: "AC broken", slaDueAt: new Date(Date.now() - 60_000) },
  });
  const srB = await prisma.serviceRequest.create({
    data: { tenantId: tenantB, guestId: guestB.id, category: "maintenance", status: "open", summary: "AC broken", slaDueAt: new Date(Date.now() - 60_000) },
  });

  await evaluateSlaBreachEscalate();

  assert.equal((await prisma.serviceRequest.findUnique({ where: { id: srA.id } }))?.status, "escalated");
  assert.equal((await prisma.serviceRequest.findUnique({ where: { id: srB.id } }))?.status, "open", "tenant B has no rule → its SR must be untouched");
});
