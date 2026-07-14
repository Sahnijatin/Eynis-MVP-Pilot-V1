// Inventory vertical — real persistence (F-19). Industry-neutral stock tracking:
// an "item" is F&B stock, a manufacturing material, a retail SKU, etc. All queries
// are scoped to tenantId. Status (ok/warning/critical) is derived, never stored.
//
// Money: unit cost is a PAISE integer (4.1) so sub-rupee rates survive into the
// quote engine's paise math. The API keeps accepting/serving `unitCostInr` as a
// (possibly fractional) rupee number for callers and the UI.
//
// Ledger (4.2): every stock change writes an immutable StockMovement row in the
// same transaction as the balance update, so stock history is auditable and
// used-vs-waste yield is computable. InventoryItem.stock stays the derived
// running balance for cheap list reads.

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
  unitCostPaise: number;
  unitCostInr: number; // rupees (may be fractional) — kept for API/UI compat
  status: StockStatus;
  updatedAt: Date;
}

export function deriveStatus(stock: number, reorderLevel: number): StockStatus {
  if (stock <= reorderLevel * 0.5) return "critical";
  if (stock <= reorderLevel) return "warning";
  return "ok";
}

// Accept either paise (preferred) or rupees from callers; store paise.
export function toPaise(opts: { unitCostPaise?: number | null; unitCostInr?: number | null }): number | undefined {
  if (opts.unitCostPaise != null && Number.isFinite(Number(opts.unitCostPaise))) {
    return Math.max(0, Math.round(Number(opts.unitCostPaise)));
  }
  if (opts.unitCostInr != null && Number.isFinite(Number(opts.unitCostInr))) {
    return Math.max(0, Math.round(Number(opts.unitCostInr) * 100));
  }
  return undefined;
}

const toRow = (i: {
  id: string; name: string; category: string; stock: number; unit: string;
  reorderLevel: number; unitCostPaise: number; updatedAt: Date;
}): InventoryRow => ({
  id: i.id, name: i.name, category: i.category, stock: i.stock, unit: i.unit,
  reorderLevel: i.reorderLevel, unitCostPaise: i.unitCostPaise,
  unitCostInr: Math.round(i.unitCostPaise) / 100,
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
  unitCostPaise?: number;
  ref?: string | null;
  note?: string | null;
  actorId?: string | null;
}

// Applies a stock movement, upserting the item by (tenantId, name). "received"
// adds to stock; "used"/"waste" subtract (floored at 0). Creating via a non-receipt
// movement starts the item at 0. The ledger row records the EFFECTIVE delta (after
// the zero floor), so summing deltas always reconstructs the stored stock.
export async function applyMovement(tenantId: string, input: MovementInput): Promise<InventoryRow> {
  const name = input.name.trim();
  if (!name) throw new Error("name is required");
  if (!Number.isFinite(input.qty) || input.qty < 0) throw new Error("qty must be a non-negative number");

  const existing = await prisma.inventoryItem.findUnique({ where: { tenantId_name: { tenantId, name } } });
  const requestedDelta = input.txType === "received" ? input.qty : -input.qty;

  const ledger = (itemId: string, delta: number) =>
    prisma.stockMovement.create({
      data: {
        tenantId, itemId, kind: input.txType, delta,
        ref: input.ref ?? null, note: input.note ?? null, actorId: input.actorId ?? null,
      },
    });

  if (existing) {
    const nextStock = Math.max(0, existing.stock + requestedDelta);
    const effectiveDelta = nextStock - existing.stock;
    const [updated] = await prisma.$transaction([
      prisma.inventoryItem.update({
        where: { id: existing.id },
        data: {
          stock: nextStock,
          ...(input.category ? { category: input.category } : {}),
          ...(input.unit ? { unit: input.unit } : {}),
          ...(input.reorderLevel != null ? { reorderLevel: input.reorderLevel } : {}),
          ...(input.unitCostPaise != null ? { unitCostPaise: Math.max(0, Math.round(input.unitCostPaise)) } : {}),
        },
      }),
      ledger(existing.id, effectiveDelta),
    ]);
    return toRow(updated);
  }

  const initialStock = Math.max(0, input.txType === "received" ? input.qty : 0);
  const created = await prisma.inventoryItem.create({
    data: {
      tenantId, name,
      category: input.category ?? "Other",
      stock: initialStock,
      unit: input.unit ?? "units",
      reorderLevel: input.reorderLevel ?? 5,
      unitCostPaise: input.unitCostPaise != null ? Math.max(0, Math.round(input.unitCostPaise)) : 0,
    },
  });
  await ledger(created.id, initialStock);
  return toRow(created);
}

export async function updateItem(
  tenantId: string,
  id: string,
  fields: Partial<{ name: string; category: string; stock: number; unit: string; reorderLevel: number; unitCostPaise: number }>,
  actorId?: string | null,
): Promise<InventoryRow | null> {
  const existing = await prisma.inventoryItem.findFirst({ where: { id, tenantId } });
  if (!existing) return null;
  // A direct stock edit is still a ledger event — recorded as an "adjustment"
  // so history reconstructs (used/waste stay distinguishable from corrections).
  const stockDelta = fields.stock != null ? fields.stock - existing.stock : 0;
  const [updated] = await prisma.$transaction([
    prisma.inventoryItem.update({ where: { id }, data: fields }),
    ...(stockDelta !== 0
      ? [prisma.stockMovement.create({ data: { tenantId, itemId: id, kind: "adjustment", delta: stockDelta, actorId: actorId ?? null } })]
      : []),
  ]);
  return toRow(updated);
}

export async function deleteItem(tenantId: string, id: string): Promise<boolean> {
  const r = await prisma.inventoryItem.deleteMany({ where: { id, tenantId } });
  return r.count > 0;
}

// ── Ledger reads ───────────────────────────────────────────────────────────────

export interface MovementRow {
  id: string;
  itemId: string;
  itemName: string;
  kind: string;
  delta: number;
  unit: string;
  ref: string | null;
  note: string | null;
  createdAt: Date;
}

export async function listMovements(
  tenantId: string,
  opts: { itemId?: string; limit?: number } = {},
): Promise<MovementRow[]> {
  const rows = await prisma.stockMovement.findMany({
    where: { tenantId, ...(opts.itemId ? { itemId: opts.itemId } : {}) },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(opts.limit ?? 50, 1), 200),
    include: { item: { select: { name: true, unit: true } } },
  });
  return rows.map((m) => ({
    id: m.id, itemId: m.itemId, itemName: m.item.name, kind: m.kind, delta: m.delta,
    unit: m.item.unit, ref: m.ref, note: m.note, createdAt: m.createdAt,
  }));
}

// ── Yield analytics (4.3) ──────────────────────────────────────────────────────
// Per material: what the ledger says moved (received/used/waste + waste ratio)
// over the window, plus the quantity committed by ACCEPTED quotes whose lines
// reference the item (computedQty already includes wastage allowance). This is
// read-only — accepting a quote does not auto-deduct stock.

export interface YieldRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  reorderLevel: number;
  unitCostPaise: number;
  status: StockStatus;
  receivedQty: number;
  usedQty: number;
  wasteQty: number;
  wasteRatioPct: number; // waste / (used + waste), 0 when nothing consumed
  committedQty: number; // accepted-quote demand referencing this item
}

export async function yieldSummary(tenantId: string, windowDays = 90): Promise<YieldRow[]> {
  const since = new Date(Date.now() - windowDays * 24 * 3600_000);
  const [items, ledger, committed] = await Promise.all([
    prisma.inventoryItem.findMany({ where: { tenantId }, orderBy: { name: "asc" } }),
    prisma.stockMovement.groupBy({
      by: ["itemId", "kind"],
      where: { tenantId, createdAt: { gte: since } },
      _sum: { delta: true },
    }),
    prisma.quoteLineItem.groupBy({
      by: ["inventoryItemId"],
      where: { tenantId, inventoryItemId: { not: null }, quote: { status: "accepted" } },
      _sum: { computedQty: true },
    }),
  ]);

  const byItem = new Map<string, { received: number; used: number; waste: number }>();
  for (const g of ledger) {
    const agg = byItem.get(g.itemId) ?? { received: 0, used: 0, waste: 0 };
    const qty = Math.abs(g._sum.delta ?? 0);
    if (g.kind === "received") agg.received += qty;
    else if (g.kind === "used") agg.used += qty;
    else if (g.kind === "waste") agg.waste += qty;
    byItem.set(g.itemId, agg);
  }
  const committedByItem = new Map<string, number>(
    committed.filter((c) => c.inventoryItemId).map((c) => [c.inventoryItemId as string, c._sum.computedQty ?? 0]),
  );

  return items.map((i) => {
    const agg = byItem.get(i.id) ?? { received: 0, used: 0, waste: 0 };
    const consumed = agg.used + agg.waste;
    return {
      id: i.id, name: i.name, category: i.category, unit: i.unit, stock: i.stock,
      reorderLevel: i.reorderLevel, unitCostPaise: i.unitCostPaise,
      status: deriveStatus(i.stock, i.reorderLevel),
      receivedQty: agg.received, usedQty: agg.used, wasteQty: agg.waste,
      wasteRatioPct: consumed > 0 ? Math.round((agg.waste / consumed) * 1000) / 10 : 0,
      committedQty: Math.round((committedByItem.get(i.id) ?? 0) * 10000) / 10000,
    };
  });
}
