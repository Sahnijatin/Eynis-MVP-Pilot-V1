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
