// Inventory vertical — real persistence (F-19). Industry-neutral stock tracking:
// an "item" is F&B stock, a manufacturing material, a retail SKU, etc. All queries
// are scoped to tenantId. Status (ok/warning/critical) is derived, never stored.

import { prisma } from "../../db/prisma";

export type StockStatus = "ok" | "warning" | "critical";
export type MovementType = "received" | "used" | "waste";

export interface InventoryRow {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  reorderLevel: number;
  unitCostInr: number;
  status: StockStatus;
  updatedAt: Date;
}

export function deriveStatus(stock: number, reorderLevel: number): StockStatus {
  if (stock <= reorderLevel * 0.5) return "critical";
  if (stock <= reorderLevel) return "warning";
  return "ok";
}

const toRow = (i: {
  id: string; name: string; category: string; stock: number; unit: string;
  reorderLevel: number; unitCostInr: number; updatedAt: Date;
}): InventoryRow => ({
  id: i.id, name: i.name, category: i.category, stock: i.stock, unit: i.unit,
  reorderLevel: i.reorderLevel, unitCostInr: i.unitCostInr,
  status: deriveStatus(i.stock, i.reorderLevel), updatedAt: i.updatedAt,
});

export async function listInventory(tenantId: string): Promise<InventoryRow[]> {
  const items = await prisma.inventoryItem.findMany({ where: { tenantId }, orderBy: { name: "asc" } });
  return items.map(toRow);
}

export interface MovementInput {
  name: string;
  category?: string;
  txType: MovementType;
  qty: number;
  unit?: string;
  reorderLevel?: number;
  unitCostInr?: number;
}

// Applies a stock movement, upserting the item by (tenantId, name). "received"
// adds to stock; "used"/"waste" subtract (floored at 0). Creating via a non-receipt
// movement starts the item at 0.
export async function applyMovement(tenantId: string, input: MovementInput): Promise<InventoryRow> {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  if (!Number.isFinite(input.qty) || input.qty < 0) throw new Error("qty must be a non-negative number");

  const existing = await prisma.inventoryItem.findUnique({ where: { tenantId_name: { tenantId, name } } });
  const delta = input.txType === "received" ? input.qty : -input.qty;

  if (existing) {
    const nextStock = Math.max(0, existing.stock + delta);
    const updated = await prisma.inventoryItem.update({
      where: { id: existing.id },
      data: {
        stock: nextStock,
        ...(input.category ? { category: input.category } : {}),
        ...(input.unit ? { unit: input.unit } : {}),
        ...(input.reorderLevel != null ? { reorderLevel: input.reorderLevel } : {}),
        ...(input.unitCostInr != null ? { unitCostInr: input.unitCostInr } : {}),
      },
    });
    return toRow(updated);
  }

  const created = await prisma.inventoryItem.create({
    data: {
      tenantId, name,
      category: input.category ?? "Other",
      stock: Math.max(0, input.txType === "received" ? input.qty : 0),
      unit: input.unit ?? "units",
      reorderLevel: input.reorderLevel ?? 5,
      unitCostInr: input.unitCostInr ?? 0,
    },
  });
  return toRow(created);
}

export async function updateItem(
  tenantId: string,
  id: string,
  fields: Partial<{ name: string; category: string; stock: number; unit: string; reorderLevel: number; unitCostInr: number }>,
): Promise<InventoryRow | null> {
  const existing = await prisma.inventoryItem.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) return null;
  const updated = await prisma.inventoryItem.update({ where: { id }, data: fields });
  return toRow(updated);
}

export async function deleteItem(tenantId: string, id: string): Promise<boolean> {
  const r = await prisma.inventoryItem.deleteMany({ where: { id, tenantId } });
  return r.count > 0;
}
