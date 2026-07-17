import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const tid = "menu-smoke-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@menu.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token };
}

after(async () => {
  await prisma.menuItem.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("menu items CRUD with derived margin, tenant-scoped", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Menu Smoke", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: "owner@menu.test", role: "owner", isActive: true } });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  const base = "http://127.0.0.1:" + (typeof a === "object" && a ? a.port : 0);

  try {
    const headers = { ...(await auth(base)), "content-type": "application/json" };

    // Create — price 800, cost 200 → 75% margin.
    const createRes = await fetch(base + "/menu/items", { method: "POST", headers, body: JSON.stringify({ name: "Truffle Risotto", category: "Mains", priceInr: 800, costInr: 200 }) });
    assert.equal(createRes.status, 200);
    const created = (await createRes.json()) as { ok: boolean; item: { id: string; marginPct: number; pricePaise: number; isAvailable: boolean } };
    assert.equal(created.item.marginPct, 75);
    assert.equal(created.item.pricePaise, 80000);
    assert.equal(created.item.isAvailable, true);
    const id = created.item.id;

    // Duplicate name → 400.
    const dup = await fetch(base + "/menu/items", { method: "POST", headers, body: JSON.stringify({ name: "Truffle Risotto" }) });
    assert.equal(dup.status, 400);

    // List reflects it.
    const listRes = await fetch(base + "/menu/items", { headers });
    const list = (await listRes.json()) as { ok: boolean; items: { id: string }[] };
    assert.equal(list.items.length, 1);

    // Patch — mark unavailable + new price 1000 → margin recomputes to 80%.
    const patch = await fetch(base + "/menu/items/" + id, { method: "PATCH", headers, body: JSON.stringify({ isAvailable: false, priceInr: 1000 }) });
    assert.equal(patch.status, 200);
    const patched = (await patch.json()) as { item: { isAvailable: boolean; marginPct: number } };
    assert.equal(patched.item.isAvailable, false);
    assert.equal(patched.item.marginPct, 80);

    // Cross-tenant / unknown id → 404.
    const missing = await fetch(base + "/menu/items/nope", { method: "PATCH", headers, body: JSON.stringify({ name: "x" }) });
    assert.equal(missing.status, 404);

    // Delete.
    const del = await fetch(base + "/menu/items/" + id, { method: "DELETE", headers });
    assert.equal(del.status, 200);
    assert.equal(await prisma.menuItem.count({ where: { tenantId: tid } }), 0);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
