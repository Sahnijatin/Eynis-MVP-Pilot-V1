import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { getValueModel, unitFor } from "./value-model";
import { backfillValueEvents, recordServiceRequestResolution } from "./recorder";
import { computeAttributionAnalytics } from "./compute";

// #167 — the per-vertical value model + the persisted attribution pipeline.

test("getValueModel gives each vertical its own headline metric", () => {
  assert.equal(getValueModel("hospitality").headlineType, "revenue");
  assert.equal(getValueModel("manufacturing").headlineType, "downtime_avoided");
  assert.equal(getValueModel("it_services").headlineType, "time_saved");
  assert.equal(getValueModel("aerospace").headlineType, "time_saved"); // unknown -> generic
  assert.equal(unitFor("revenue"), "INR");
  assert.equal(unitFor("downtime_avoided"), "minutes");
});

const tid = "attr-mfg-" + Date.now();
let contactId = "";

after(async () => {
  await prisma.valueEvent.deleteMany({ where: { tenantId: tid } });
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("backfill + compute produce a defensible per-vertical attributed number", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Attr Plant", timezone: "Asia/Kolkata", industry: "manufacturing" } });
  const c = await prisma.contact.create({ data: { tenantId: tid, fullName: "Line 1", phoneE164: "ext:webhook:l1" } });
  contactId = c.id;
  // Two resolved downtime SRs + one still open.
  for (const s of [
    { category: "downtime", status: "resolved" },
    { category: "maintenance", status: "resolved" },
    { category: "downtime", status: "open" },
  ]) {
    await prisma.serviceRequest.create({
      data: { tenantId: tid, guestId: contactId, category: s.category, summary: s.category, status: s.status, priority: "high", source: "webhook", resolvedAt: s.status === "resolved" ? new Date() : null },
    });
  }

  const created = await backfillValueEvents(tid, "manufacturing");
  assert.equal(created, 2, "only the two resolved SRs produce value events");

  // Idempotent: re-running writes nothing new.
  assert.equal(await backfillValueEvents(tid, "manufacturing"), 0);

  const a = await computeAttributionAnalytics(tid);
  // manufacturing: 45 minutes downtime-avoided per resolved request × 2.
  assert.equal(a.headline.valueType, "downtime_avoided");
  assert.equal(a.headline.unit, "minutes");
  assert.equal(a.headline.amount, 90);
  assert.equal(a.headline.count, 2);
  assert.equal(a.totalEvents, 2);
});

test("recordServiceRequestResolution is idempotent per request", async () => {
  const sr = await prisma.serviceRequest.create({
    data: { tenantId: tid, guestId: contactId, category: "downtime", summary: "x", status: "resolved", priority: "high", source: "webhook", resolvedAt: new Date() },
  });
  await recordServiceRequestResolution({ tenantId: tid, industry: "manufacturing", serviceRequestId: sr.id, category: "downtime" });
  await recordServiceRequestResolution({ tenantId: tid, industry: "manufacturing", serviceRequestId: sr.id, category: "downtime" });
  const n = await prisma.valueEvent.count({ where: { tenantId: tid, sourceId: sr.id } });
  assert.equal(n, 1, "resolving the same request twice records one value event");
});
