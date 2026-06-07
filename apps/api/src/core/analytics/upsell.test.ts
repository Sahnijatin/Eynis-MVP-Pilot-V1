import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { computeUpsellAnalytics } from "./upsell";

// F-17: upsell analytics are computed from real OfferEvent rows, not hard-coded.
const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const makeTenant = async () => {
  const tenantId = "ups-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "U " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  return tenantId;
};
after(async () => { await prisma.$disconnect(); });

test("empty tenant yields no items and a zeroed 7-day series", async () => {
  const tenantId = await makeTenant();
  const r = await computeUpsellAnalytics(tenantId);
  assert.equal(r.total, 0);
  assert.equal(r.items.length, 0);
  assert.equal(r.weeklyData.length, 7);
  assert.ok(r.weeklyData.every((d) => d.executions === 0 && d.conversions === 0));
});

test("groups offers by type with real conversion rate + revenue (F-17)", async () => {
  const tenantId = await makeTenant();
  await prisma.offerEvent.createMany({
    data: [
      { tenantId, offerType: "room_upgrade", status: "accepted", revenueInr: 2000, contextJson: "{}" },
      { tenantId, offerType: "room_upgrade", status: "pending", revenueInr: 0, contextJson: "{}" },
      { tenantId, offerType: "fnb_offer", status: "accepted", revenueInr: 500, contextJson: "{}" },
    ],
  });

  const r = await computeUpsellAnalytics(tenantId);

  assert.equal(r.total, 2);
  const upgrade = r.items.find((i) => i.id === "room_upgrade")!;
  assert.equal(upgrade.name, "Room Upgrade");
  assert.equal(upgrade.recipients, 2);
  assert.equal(upgrade.conversions, 1);
  assert.equal(upgrade.conversionRate, 50);
  assert.equal(upgrade.revenueInr, 2000);
  // highest revenue first
  assert.equal(r.items[0].id, "room_upgrade");
});

test("filters offers to an explicit date range (E-15)", async () => {
  const DAY = 24 * 60 * 60 * 1000;
  const tenantId = await makeTenant();
  const now = new Date();
  await prisma.offerEvent.createMany({
    data: [
      { tenantId, offerType: "room_upgrade", status: "accepted", revenueInr: 2000, contextJson: "{}", createdAt: new Date(now.getTime() - 2 * DAY) },
      { tenantId, offerType: "fnb_offer", status: "accepted", revenueInr: 500, contextJson: "{}", createdAt: new Date(now.getTime() - 50 * DAY) },
    ],
  });

  // No range → all-time (prior behaviour): both offers counted.
  const all = await computeUpsellAnalytics(tenantId);
  assert.equal(all.total, 2);

  // 7-day window → only the recent offer.
  const wk = await computeUpsellAnalytics(tenantId, { from: new Date(now.getTime() - 7 * DAY), to: now });
  assert.equal(wk.total, 1);
  assert.equal(wk.items[0].id, "room_upgrade");
});
