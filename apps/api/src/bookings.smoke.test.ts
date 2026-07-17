import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const tid = "booking-smoke-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@bkg.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token };
}

after(async () => {
  await prisma.booking.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("bookings CRUD with derived paid%, tenant-scoped", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Booking Smoke", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: "owner@bkg.test", role: "owner", isActive: true } });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  const base = "http://127.0.0.1:" + (typeof a === "object" && a ? a.port : 0);

  try {
    const headers = { ...(await auth(base)), "content-type": "application/json" };

    // Create — value 100000, paid 30000 → 30% paid.
    const createRes = await fetch(base + "/bookings", { method: "POST", headers, body: JSON.stringify({ clientName: "Arora Family", destination: "Maldives", pax: 4, valueInr: 100000, paidInr: 30000, status: "confirmed", departureDate: "2026-08-01" }) });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { ok: boolean; item: { id: string; number: string; paidPct: number; valuePaise: number; pax: number } };
    assert.equal(created.item.paidPct, 30);
    assert.equal(created.item.valuePaise, 10000000);
    assert.equal(created.item.pax, 4);
    assert.match(created.item.number, /^BKG-\d+$/);
    const id = created.item.id;

    // Bad status → 400.
    const bad = await fetch(base + "/bookings/" + id, { method: "PATCH", headers, body: JSON.stringify({ status: "nonsense" }) });
    assert.equal(bad.status, 400);

    // Patch — full payment → 100%.
    const patch = await fetch(base + "/bookings/" + id, { method: "PATCH", headers, body: JSON.stringify({ paidInr: 100000 }) });
    assert.equal(patch.status, 200);
    assert.equal(((await patch.json()) as { item: { paidPct: number } }).item.paidPct, 100);

    // List reflects it.
    const list = (await (await fetch(base + "/bookings", { headers })).json()) as { items: unknown[] };
    assert.equal(list.items.length, 1);

    // Unknown id → 404.
    assert.equal((await fetch(base + "/bookings/nope", { method: "PATCH", headers, body: JSON.stringify({ pax: 2 }) })).status, 404);

    // Delete.
    assert.equal((await fetch(base + "/bookings/" + id, { method: "DELETE", headers })).status, 200);
    assert.equal(await prisma.booking.count({ where: { tenantId: tid } }), 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
