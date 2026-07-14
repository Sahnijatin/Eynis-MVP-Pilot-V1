// Fulfillment pipeline (Phase 7). An accepted quote becomes an Order tracked
// through production stages with full transition history. Industry-agnostic by
// design (any tenant that accepts a quote gets one); the mfg/F&B navs surface
// the board. All queries tenant-scoped.

import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";

export const ORDER_STAGES = ["new", "production", "qc", "dispatch", "delivered"] as const;
export type OrderStage = (typeof ORDER_STAGES)[number];
export const isOrderStage = (v: unknown): v is OrderStage => ORDER_STAGES.includes(v as OrderStage);

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// max+1 per tenant/year with retry — same rationale as quote numbering (1.4).
async function nextOrderNumber(tenantId: string, year: number, bump = 0): Promise<string> {
  const prefix = `O-${year}-`;
  const last = await prisma.order.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1 + bump).padStart(4, "0")}`;
}

// Create the order for an accepted quote. Idempotent: the unique quoteId means a
// second call (double accept click, retried webhook) returns the existing order.
export async function createOrderFromQuote(tenantId: string, quoteId: string, actorId?: string | null) {
  const existing = await prisma.order.findUnique({ where: { quoteId } });
  if (existing) return existing.tenantId === tenantId ? existing : null;
  const quote = await prisma.quote.findFirst({
    where: { id: quoteId, tenantId },
    select: { id: true, contactId: true, companyId: true, totalPaise: true, validUntil: true },
  });
  if (!quote) return null;

  const year = new Date().getFullYear();
  for (let attempt = 0; attempt < 5; attempt++) {
    const number = await nextOrderNumber(tenantId, year, attempt);
    try {
      const order = await prisma.order.create({
        data: {
          tenantId, number, quoteId,
          contactId: quote.contactId, companyId: quote.companyId,
          valuePaise: quote.totalPaise, stage: "new",
        },
      });
      await prisma.orderTransition.create({
        data: { tenantId, orderId: order.id, fromStage: "", toStage: "new", actorId: actorId ?? null },
      });
      return order;
    } catch (err) {
      // A concurrent accept for the SAME quote loses on quoteId — return the winner.
      if (isUniqueViolation(err)) {
        const raced = await prisma.order.findUnique({ where: { quoteId } });
        if (raced) return raced;
        if (attempt === 4) throw err; // number collision — retry with a bump
        continue;
      }
      throw err;
    }
  }
  return null;
}

export interface OrderRow {
  id: string;
  number: string;
  stage: string;
  valuePaise: number;
  quoteNumber: string;
  title: string;
  contactName: string | null;
  companyName: string | null;
  promisedDate: Date | null;
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
}

async function toRows(orders: Array<Prisma.OrderGetPayload<{ include: { quote: { select: { number: true; title: true } } } }>>): Promise<OrderRow[]> {
  const contactIds = [...new Set(orders.map((o) => o.contactId).filter((v): v is string => Boolean(v)))];
  const companyIds = [...new Set(orders.map((o) => o.companyId).filter((v): v is string => Boolean(v)))];
  const [contacts, companies] = await Promise.all([
    contactIds.length ? prisma.contact.findMany({ where: { id: { in: contactIds } }, select: { id: true, fullName: true } }) : [],
    companyIds.length ? prisma.company.findMany({ where: { id: { in: companyIds } }, select: { id: true, name: true } }) : [],
  ]);
  const contactName = new Map(contacts.map((c) => [c.id, c.fullName]));
  const companyName = new Map(companies.map((c) => [c.id, c.name]));
  return orders.map((o) => ({
    id: o.id, number: o.number, stage: o.stage, valuePaise: o.valuePaise,
    quoteNumber: o.quote.number, title: o.quote.title,
    contactName: o.contactId ? contactName.get(o.contactId) ?? null : null,
    companyName: o.companyId ? companyName.get(o.companyId) ?? null : null,
    promisedDate: o.promisedDate, notes: o.notes, createdAt: o.createdAt, updatedAt: o.updatedAt,
  }));
}

export async function listOrders(tenantId: string, opts: { stage?: string; limit: number; offset: number }) {
  const where = { tenantId, ...(opts.stage && isOrderStage(opts.stage) ? { stage: opts.stage } : {}) };
  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where, orderBy: { createdAt: "desc" }, take: opts.limit, skip: opts.offset,
      include: { quote: { select: { number: true, title: true } } },
    }),
    prisma.order.count({ where }),
  ]);
  return { items: await toRows(orders), total };
}

export async function getOrder(tenantId: string, id: string) {
  const order = await prisma.order.findFirst({
    where: { id, tenantId },
    include: {
      quote: { select: { number: true, title: true } },
      transitions: { orderBy: { createdAt: "asc" }, select: { fromStage: true, toStage: true, actorId: true, createdAt: true } },
    },
  });
  if (!order) return null;
  const [row] = await toRows([order]);
  return { ...row, transitions: order.transitions };
}

// Stage board summary for the list page + the manufacturing Command Centre.
export async function orderSummary(tenantId: string) {
  const grouped = await prisma.order.groupBy({
    by: ["stage"],
    where: { tenantId },
    _count: { _all: true },
    _sum: { valuePaise: true },
  });
  const byStage = new Map(grouped.map((g) => [g.stage, { count: g._count._all, valuePaise: g._sum.valuePaise ?? 0 }]));
  return ORDER_STAGES.map((stage) => ({ stage, count: byStage.get(stage)?.count ?? 0, valuePaise: byStage.get(stage)?.valuePaise ?? 0 }));
}

// Move an order between stages, recording the transition. Any stage-to-stage
// move is allowed (shops legitimately pull work back from QC); history keeps it
// honest. Entering "production" logs planned material usage when enabled.
export async function moveOrderStage(tenantId: string, orderId: string, toStage: OrderStage, actorId?: string | null) {
  const order = await prisma.order.findFirst({ where: { id: orderId, tenantId } });
  if (!order) return null;
  if (order.stage === toStage) return getOrder(tenantId, orderId);
  await prisma.$transaction([
    prisma.order.update({ where: { id: order.id }, data: { stage: toStage } }),
    prisma.orderTransition.create({ data: { tenantId, orderId: order.id, fromStage: order.stage, toStage, actorId: actorId ?? null } }),
  ]);
  if (toStage === "production" && order.stage === "new") {
    await logPlannedConsumption(tenantId, order.id).catch((err) =>
      console.warn("[orders] planned-consumption logging failed:", err instanceof Error ? err.message : err));
  }
  return getOrder(tenantId, orderId);
}

// 7.5: when an order enters production, log the quote's inventory-linked line
// quantities (computedQty already includes the wastage allowance) as `used`
// stock movements — closing the loop the Materials yield page reports on.
// Opt-in via AUTO_DEDUCT_MATERIALS=true: shops that track consumption manually
// keep full control by default.
export async function logPlannedConsumption(tenantId: string, orderId: string): Promise<number> {
  if (String(process.env.AUTO_DEDUCT_MATERIALS ?? "").toLowerCase() !== "true") return 0;
  const order = await prisma.order.findFirst({
    where: { id: orderId, tenantId },
    select: { number: true, quote: { select: { lineItems: { select: { inventoryItemId: true, computedQty: true } } } } },
  });
  if (!order) return 0;
  const wanted = order.quote.lineItems.filter((l) => l.inventoryItemId && l.computedQty > 0);
  let logged = 0;
  for (const line of wanted) {
    const item = await prisma.inventoryItem.findFirst({ where: { id: line.inventoryItemId!, tenantId } });
    if (!item) continue;
    const nextStock = Math.max(0, item.stock - line.computedQty);
    const effectiveDelta = nextStock - item.stock; // ledger records the effective change (zero floor)
    await prisma.$transaction([
      prisma.inventoryItem.update({ where: { id: item.id }, data: { stock: nextStock } }),
      prisma.stockMovement.create({
        data: { tenantId, itemId: item.id, kind: "used", delta: effectiveDelta, ref: order.number, note: "Planned consumption on production start" },
      }),
    ]);
    logged++;
  }
  return logged;
}
