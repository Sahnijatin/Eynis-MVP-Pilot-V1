import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const tid = "notif-smoke-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@notif.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token };
}

after(async () => {
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.quote.deleteMany({ where: { tenantId: tid } });
  await prisma.inventoryItem.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("GET /notifications returns real tenant signals", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Notif Smoke", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: "owner@notif.test", role: "owner", isActive: true } });

  // Signal 1: an SLA-breached open request.
  const guest = await prisma.contact.create({
    data: { tenantId: tid, fullName: "Test Guest", phoneE164: "+919000000001" },
  });
  await prisma.serviceRequest.create({
    data: {
      tenantId: tid, guestId: guest.id, category: "maintenance", status: "open", summary: "AC not cooling",
      priority: "high", slaDueAt: new Date(Date.now() - 3600_000), slaBreachedAt: new Date(Date.now() - 1800_000),
    },
  });
  // Signal 2: a low-stock inventory item.
  await prisma.inventoryItem.create({
    data: { tenantId: tid, name: "Teak Plank", stock: 2, unit: "sheets", reorderLevel: 5 },
  });
  // A well-stocked item that must NOT appear.
  await prisma.inventoryItem.create({
    data: { tenantId: tid, name: "Screws", stock: 500, unit: "units", reorderLevel: 50 },
  });
  // Signal 3: a sent quote expiring within 3 days.
  await prisma.quote.create({
    data: {
      tenantId: tid, number: "Q-NOTIF-1", title: "Boardroom Table", status: "sent",
      validUntil: new Date(Date.now() + 2 * 24 * 3600_000),
    },
  });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const addr = server.address();
  const base = "http://127.0.0.1:" + (typeof addr === "object" && addr ? addr.port : 0);

  try {
    const headers = await auth(base);
    const res = await fetch(base + "/notifications", { headers });
    const body = (await res.json()) as { ok: boolean; items: { id: string; type: string; title: string; href: string }[] };

    assert.equal(res.status, 200);
    assert.equal(body.ok, true);
    const titles = body.items.map((i) => i.title).join(" | ");

    assert.ok(body.items.some((i) => i.id.startsWith("sr-breach-") && i.href === "/queue"), "expected breached request: " + titles);
    assert.ok(body.items.some((i) => i.id.startsWith("inv-") && i.title.includes("Teak Plank") && i.href === "/inventory"), "expected low-stock item: " + titles);
    assert.ok(body.items.some((i) => i.id.startsWith("quote-") && i.href === "/quotes"), "expected expiring quote: " + titles);
    assert.ok(!body.items.some((i) => i.title.includes("Screws")), "well-stocked item must not appear: " + titles);
    // Alerts sort before info.
    assert.equal(body.items[0].type, "alert");
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
