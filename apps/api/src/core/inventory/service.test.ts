import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { listInventory, applyMovement, updateItem, deleteItem, deriveStatus } from "./service";

// F-19: the inventory vertical persists for real (no frontend mock).
const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const makeTenant = async () => {
  const tenantId = "inv-" + uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Inv " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  return tenantId;
};
after(async () => { await prisma.$disconnect(); });

test("deriveStatus thresholds", () => {
  assert.equal(deriveStatus(2, 6), "critical"); // <= 50% of reorder
  assert.equal(deriveStatus(5, 6), "warning");  // <= reorder
  assert.equal(deriveStatus(10, 6), "ok");
});

test("applyMovement creates then adjusts stock and is tenant-scoped", async () => {
  const tenantId = await makeTenant();
  const created = await applyMovement(tenantId, { name: "Truffle Oil", category: "Specialty", txType: "received", qty: 10, unit: "bottles", reorderLevel: 6 });
  assert.equal(created.stock, 10);
  assert.equal(created.status, "ok");

  const used = await applyMovement(tenantId, { name: "Truffle Oil", txType: "used", qty: 7 });
  assert.equal(used.stock, 3);
  assert.equal(used.status, "critical"); // 3 <= 6*0.5

  // never goes negative
  const waste = await applyMovement(tenantId, { name: "Truffle Oil", txType: "waste", qty: 99 });
  assert.equal(waste.stock, 0);

  const list = await listInventory(tenantId);
  assert.equal(list.length, 1);
  assert.equal(list[0].name, "Truffle Oil");
});

test("a movement upserts by (tenant, name) — same name in another tenant is separate", async () => {
  const tenantA = await makeTenant();
  const tenantB = await makeTenant();
  await applyMovement(tenantA, { name: "Flour", txType: "received", qty: 5 });
  await applyMovement(tenantB, { name: "Flour", txType: "received", qty: 50 });
  const a = await listInventory(tenantA);
  const b = await listInventory(tenantB);
  assert.equal(a.find((i) => i.name === "Flour")!.stock, 5);
  assert.equal(b.find((i) => i.name === "Flour")!.stock, 50);
});

test("updateItem and deleteItem respect tenant ownership", async () => {
  const tenantId = await makeTenant();
  const other = await makeTenant();
  const item = await applyMovement(tenantId, { name: "Cream", txType: "received", qty: 8, reorderLevel: 10 });
  assert.equal(item.status, "warning");

  const updated = await updateItem(tenantId, item.id, { reorderLevel: 4 });
  assert.equal(updated!.status, "ok"); // 8 > 4

  // wrong tenant can't update or delete
  assert.equal(await updateItem(other, item.id, { stock: 0 }), null);
  assert.equal(await deleteItem(other, item.id), false);

  assert.equal(await deleteItem(tenantId, item.id), true);
  assert.equal((await listInventory(tenantId)).length, 0);
});

test("every stock change writes a ledger row; deltas reconstruct the balance (4.2)", async () => {
  const { listMovements } = await import("./service");
  const tenantId = await makeTenant();
  const item = await applyMovement(tenantId, { name: "Teak Plank", txType: "received", qty: 20, ref: "PO-77" });
  await applyMovement(tenantId, { name: "Teak Plank", txType: "used", qty: 6, ref: "Q-2026-0001" });
  await applyMovement(tenantId, { name: "Teak Plank", txType: "waste", qty: 2 });
  // Direct stock edit records an adjustment.
  await updateItem(tenantId, item.id, { stock: 15 });

  const moves = await listMovements(tenantId, { itemId: item.id });
  assert.equal(moves.length, 4);
  const kinds = moves.map((m) => m.kind).sort();
  assert.deepEqual(kinds, ["adjustment", "received", "used", "waste"]);
  // Sum of signed deltas equals the stored balance.
  const sum = moves.reduce((s, m) => s + m.delta, 0);
  const current = (await listInventory(tenantId)).find((i) => i.id === item.id)!;
  assert.equal(Math.round(sum * 1000) / 1000, current.stock);
  assert.equal(current.stock, 15);
  // Refs are preserved.
  assert.ok(moves.some((m) => m.ref === "Q-2026-0001"));

  // The zero floor is reflected in the ledger: over-consuming 99 from 15
  // records an effective delta of -15, keeping the ledger reconstructable.
  await applyMovement(tenantId, { name: "Teak Plank", txType: "waste", qty: 99 });
  const after = await listMovements(tenantId, { itemId: item.id });
  const sum2 = after.reduce((s, m) => s + m.delta, 0);
  assert.equal(Math.round(sum2 * 1000) / 1000, 0);
});

test("yieldSummary aggregates ledger movement and waste ratio (4.3)", async () => {
  const { yieldSummary } = await import("./service");
  const tenantId = await makeTenant();
  await applyMovement(tenantId, { name: "Marine Ply", txType: "received", qty: 100 });
  await applyMovement(tenantId, { name: "Marine Ply", txType: "used", qty: 30 });
  await applyMovement(tenantId, { name: "Marine Ply", txType: "waste", qty: 10 });

  const rows = await yieldSummary(tenantId);
  const ply = rows.find((r) => r.name === "Marine Ply")!;
  assert.equal(ply.receivedQty, 100);
  assert.equal(ply.usedQty, 30);
  assert.equal(ply.wasteQty, 10);
  assert.equal(ply.wasteRatioPct, 25); // 10 / (30 + 10)
  assert.equal(ply.stock, 60);
  assert.equal(ply.committedQty, 0); // no accepted quotes reference it
});
