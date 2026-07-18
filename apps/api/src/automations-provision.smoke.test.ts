import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "./db/prisma";
import { seedAutomationRulesForTenant } from "./core/automations/provision";

// #160 — a newly created tenant gets the operational automation rules its industry
// pack declares, seeded idempotently and without clobbering the tenant's own toggles.

const hotelTid = "auto-prov-hotel-" + Date.now();
const mfgTid = "auto-prov-mfg-" + Date.now();

after(async () => {
  await prisma.automationRule.deleteMany({ where: { tenantId: { in: [hotelTid, mfgTid] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [hotelTid, mfgTid] } } });
  await prisma.$disconnect();
});

test("seeds the hospitality pack's four operational rules, idempotently", async () => {
  await prisma.tenant.create({ data: { id: hotelTid, name: "Prov Hotel", timezone: "Asia/Kolkata", industry: "hospitality" } });

  const created = await seedAutomationRulesForTenant(hotelTid, "hospitality");
  assert.equal(created, 4);

  const codes = (await prisma.automationRule.findMany({ where: { tenantId: hotelTid }, select: { code: true } }))
    .map((r) => r.code)
    .sort();
  assert.deepEqual(codes, ["checkin_welcome", "sentiment_low_flag", "sla_breach_escalate", "upsell_followup"]);

  // Re-run creates nothing and preserves a tenant's own toggle.
  await prisma.automationRule.updateMany({ where: { tenantId: hotelTid, code: "upsell_followup" }, data: { isActive: false } });
  const createdAgain = await seedAutomationRulesForTenant(hotelTid, "hospitality");
  assert.equal(createdAgain, 0);
  const paused = await prisma.automationRule.findUnique({ where: { tenantId_code: { tenantId: hotelTid, code: "upsell_followup" } }, select: { isActive: true } });
  assert.equal(paused?.isActive, false, "existing rule toggle must be preserved");
});

test("a non-hospitality pack seeds only its declared subset", async () => {
  await prisma.tenant.create({ data: { id: mfgTid, name: "Prov Plant", timezone: "Asia/Kolkata", industry: "manufacturing" } });

  const created = await seedAutomationRulesForTenant(mfgTid, "manufacturing");
  assert.equal(created, 2);

  const codes = (await prisma.automationRule.findMany({ where: { tenantId: mfgTid }, select: { code: true } }))
    .map((r) => r.code)
    .sort();
  assert.deepEqual(codes, ["sentiment_low_flag", "sla_breach_escalate"]);
});
