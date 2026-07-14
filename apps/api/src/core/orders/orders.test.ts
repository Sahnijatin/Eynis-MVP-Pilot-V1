import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// Phase 7: fulfillment pipeline — accepted quotes become orders with stage history.

const uid = () => "otest-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
const createdTenants: string[] = [];

async function setup() {
  const tenantId = uid();
  createdTenants.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, name: "Order Co " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
  const email = `owner-${tenantId}@example.com`;
  await prisma.user.create({ data: { tenantId, fullName: "Owner", email, role: "owner", isActive: true } });
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const tokRes = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, role: "owner" }),
  });
  const { token } = (await tokRes.json()) as { token: string };
  const H = { authorization: "Bearer " + token, "content-type": "application/json" };
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { tenantId, base, H, close };
}

after(async () => {
  for (const id of createdTenants) await prisma.tenant.deleteMany({ where: { id } });
  await prisma.$disconnect();
});

async function makeAcceptedQuote(base: string, H: Record<string, string>, title: string, lines?: unknown[]) {
  const created = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
    title, marginPct: 50, marginFloorPct: 10,
    lines: lines ?? [{ name: "Body", groupName: title, costBasis: "fixed", quantity: 1, unitRatePaise: 2000000 }],
  }) });
  const { quote } = (await created.json()) as { quote: { id: string; totalPaise: number } };
  await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
  const acceptRes = await fetch(base + `/quotes/${quote.id}/accept`, { method: "POST", headers: H });
  assert.equal(acceptRes.status, 200);
  return quote;
}

test("accepting a quote auto-creates an order (idempotent), with numbering and stage history", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    const quote = await makeAcceptedQuote(base, H, "Boardroom Table");

    // Order exists, frozen at the quote's value, stage "new", with a birth transition.
    const listRes = await fetch(base + "/orders", { headers: H });
    assert.equal(listRes.status, 200);
    const list = (await listRes.json()) as { items: Array<{ id: string; number: string; stage: string; valuePaise: number; quoteNumber: string }>; summary: Array<{ stage: string; count: number }> };
    assert.equal(list.items.length, 1);
    const order = list.items[0];
    assert.match(order.number, /^O-\d{4}-\d{4}$/);
    assert.equal(order.stage, "new");
    assert.equal(order.valuePaise, quote.totalPaise);
    assert.equal(list.summary.find((s) => s.stage === "new")!.count, 1);

    // Idempotent: a duplicate create attempt returns the same order row.
    const { createOrderFromQuote } = await import("./service");
    const again = await createOrderFromQuote(tenantId, quote.id);
    assert.equal(again!.id, order.id);
    assert.equal(await prisma.order.count({ where: { tenantId } }), 1);

    // Stage moves record transitions; same-stage moves are no-ops.
    const move = await fetch(base + `/orders/${order.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ stage: "production" }) });
    assert.equal(move.status, 200);
    const detailRes = await fetch(base + `/orders/${order.id}`, { headers: H });
    const detail = (await detailRes.json()) as { order: { stage: string; transitions: Array<{ fromStage: string; toStage: string }> } };
    assert.equal(detail.order.stage, "production");
    assert.deepEqual(detail.order.transitions.map((t) => t.toStage), ["new", "production"]);

    // Invalid stage → 400.
    assert.equal((await fetch(base + `/orders/${order.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ stage: "shipped" }) })).status, 400);

    // A second accepted quote gets the next number.
    await makeAcceptedQuote(base, H, "Reception Desk");
    const two = (await (await fetch(base + "/orders", { headers: H })).json()) as { items: Array<{ number: string }> };
    assert.equal(two.items.length, 2);
    assert.ok(two.items.some((o) => o.number.endsWith("-0002")));
  } finally {
    await close();
  }
});

test("orders are tenant-isolated and planned consumption is opt-in via AUTO_DEDUCT_MATERIALS", async () => {
  const a = await setup();
  const b = await setup();
  try {
    // Consumption OFF (default): production move must not touch stock.
    const item = await prisma.inventoryItem.create({
      data: { tenantId: a.tenantId, name: "Ply " + a.tenantId.slice(-4), category: "Wood", stock: 100, unit: "sqft", unitCostPaise: 10000 },
    });
    const quote = await makeAcceptedQuote(a.base, a.H, "Wardrobe", [
      { name: "Carcass", groupName: "Wardrobe", costBasis: "area", lengthMm: 1800, widthMm: 600, quantity: 1, inventoryItemId: item.id },
      { name: "Assembly", groupName: "Wardrobe", costBasis: "fixed", quantity: 1, unitRatePaise: 500000 },
    ]);
    const order = (await prisma.order.findUnique({ where: { quoteId: quote.id } }))!;

    // Cross-tenant: tenant B sees nothing and cannot move A's order.
    const crossList = (await (await fetch(b.base + "/orders", { headers: b.H })).json()) as { items: unknown[] };
    assert.equal(crossList.items.length, 0);
    assert.equal((await fetch(b.base + `/orders/${order.id}`, { method: "PATCH", headers: b.H, body: JSON.stringify({ stage: "production" }) })).status, 404);

    await fetch(a.base + `/orders/${order.id}`, { method: "PATCH", headers: a.H, body: JSON.stringify({ stage: "production" }) });
    const untouched = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
    assert.equal(untouched!.stock, 100, "stock untouched with the flag off");

    // Consumption ON: entering production logs `used` ledger movements from the
    // quote's inventory-linked line quantities.
    process.env.AUTO_DEDUCT_MATERIALS = "true";
    try {
      const quote2 = await makeAcceptedQuote(a.base, a.H, "Bookcase", [
        { name: "Sides", groupName: "Bookcase", costBasis: "area", lengthMm: 2000, widthMm: 900, quantity: 2, inventoryItemId: item.id },
      ]);
      const order2 = (await prisma.order.findUnique({ where: { quoteId: quote2.id } }))!;
      await fetch(a.base + `/orders/${order2.id}`, { method: "PATCH", headers: a.H, body: JSON.stringify({ stage: "production" }) });

      const after2 = await prisma.inventoryItem.findUnique({ where: { id: item.id } });
      assert.ok(after2!.stock < 100, `stock deducted, got ${after2!.stock}`);
      const move = await prisma.stockMovement.findFirst({ where: { tenantId: a.tenantId, itemId: item.id, kind: "used", ref: order2.number } });
      assert.ok(move, "ledger row carries the order number as ref");
      assert.ok(move!.delta < 0);
    } finally {
      delete process.env.AUTO_DEDUCT_MATERIALS;
    }
  } finally {
    await a.close();
    await b.close();
  }
});

test("GET /contacts/intel aggregates accepted value, pending quotes and open orders per contact", async () => {
  const { base, H, close } = await setup();
  try {
    // Customer with one accepted (→ open order) and one pending quote.
    const created = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Dining Set", marginPct: 50, marginFloorPct: 10,
      customer: { fullName: "Asha Rao", phoneE164: "+919812301111" },
      lines: [{ name: "Table", costBasis: "fixed", quantity: 1, unitRatePaise: 4000000 }],
    }) });
    const q1 = ((await created.json()) as { quote: { id: string; contactId: string; totalPaise: number } }).quote;
    await fetch(base + `/quotes/${q1.id}/send`, { method: "POST", headers: H });
    await fetch(base + `/quotes/${q1.id}/accept`, { method: "POST", headers: H });

    const pending = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Side Table", marginPct: 50, marginFloorPct: 10, contactId: q1.contactId,
      lines: [{ name: "Top", costBasis: "fixed", quantity: 1, unitRatePaise: 800000 }],
    }) });
    const q2 = ((await pending.json()) as { quote: { id: string } }).quote;
    await fetch(base + `/quotes/${q2.id}/send`, { method: "POST", headers: H });

    const intelRes = await fetch(base + "/contacts/intel", { headers: H });
    assert.equal(intelRes.status, 200);
    const intel = (await intelRes.json()) as { items: Array<{ fullName: string; acceptedTotalPaise: number; acceptedCount: number; pendingQuotes: number; openOrders: number }> };
    const asha = intel.items.find((i) => i.fullName === "Asha Rao")!;
    assert.equal(asha.acceptedCount, 1);
    assert.equal(asha.acceptedTotalPaise, q1.totalPaise);
    assert.equal(asha.pendingQuotes, 1);
    assert.equal(asha.openOrders, 1);
  } finally {
    await close();
  }
});
