// Quoting service — DB persistence + recompute-on-write for the costing engine.
//
// Pattern mirrors core/inventory/service.ts: every query is scoped to tenantId, and
// the pure math lives in ./costing (no Prisma there). A quote is immutable once it
// leaves `draft`: line rates are snapshotted at add-time and the routes reject edits
// on non-draft quotes. On every draft write we recompute each line + the quote and
// persist the frozen integers, so reads and the PDF are a pure read.

import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import {
  computeLine,
  computeQuote,
  type CostBasis,
  type LineResult,
  type QuoteResult,
} from "./costing";

export type QuoteStatus = "draft" | "sent" | "accepted" | "rejected" | "expired";

// One source of truth for the quote state machine, enforced by every lifecycle
// route. A draft can only be sent (send is the sole door that checks lines + the
// margin floor); a decision — accepted/rejected/expired — is only valid on a sent
// quote; decided states are terminal. Reopening a decided quote is deliberately
// impossible (re-quote instead) so an accept's committed deal value can never be
// silently unwound by a later reject.
const TRANSITIONS: Record<QuoteStatus, readonly QuoteStatus[]> = {
  draft: ["sent"],
  sent: ["accepted", "rejected", "expired"],
  accepted: [],
  rejected: [],
  expired: [],
};

export function canTransition(from: string, to: QuoteStatus): boolean {
  return (TRANSITIONS[from as QuoteStatus] ?? []).includes(to);
}
const KINDS = ["material", "labor", "hardware", "finish", "other"] as const;
const BASES: CostBasis[] = ["area", "length", "perimeter", "volume", "fixed", "hours"];

export function normalizeKind(v: unknown): string {
  const s = String(v ?? "").toLowerCase();
  return (KINDS as readonly string[]).includes(s) ? s : "material";
}
export function normalizeBasis(v: unknown): CostBasis {
  const s = String(v ?? "").toLowerCase() as CostBasis;
  return BASES.includes(s) ? s : "area";
}

// ── Serialization (money exposed as both paise and rupees for the client) ────────
const toRupees = (paise: number) => Math.round(paise) / 100;

export interface LineInputPayload {
  groupName?: string;
  name: string;
  kind?: string;
  costBasis?: string;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  quantity?: number;
  inventoryItemId?: string | null;
  materialUnit?: string;
  unitRatePaise?: number;
  wastagePct?: number;
  laborHours?: number;
  laborRatePaise?: number;
  sortOrder?: number;
}

interface StoredLine {
  id: string;
  groupName: string;
  name: string;
  kind: string;
  costBasis: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  quantity: number;
  inventoryItemId: string | null;
  materialUnit: string;
  unitRatePaise: number;
  wastagePct: number;
  laborHours: number;
  laborRatePaise: number;
  computedQty: number;
  materialCostPaise: number;
  laborCostPaise: number;
  lineCostPaise: number;
  sortOrder: number;
}

export function serializeLine(l: StoredLine) {
  return {
    id: l.id,
    groupName: l.groupName,
    name: l.name,
    kind: l.kind,
    costBasis: l.costBasis,
    lengthMm: l.lengthMm,
    widthMm: l.widthMm,
    heightMm: l.heightMm,
    quantity: l.quantity,
    inventoryItemId: l.inventoryItemId,
    materialUnit: l.materialUnit,
    unitRatePaise: l.unitRatePaise,
    unitRateInr: toRupees(l.unitRatePaise),
    wastagePct: l.wastagePct,
    laborHours: l.laborHours,
    laborRatePaise: l.laborRatePaise,
    computedQty: l.computedQty,
    materialCostPaise: l.materialCostPaise,
    laborCostPaise: l.laborCostPaise,
    lineCostPaise: l.lineCostPaise,
    lineCostInr: toRupees(l.lineCostPaise),
    sortOrder: l.sortOrder,
  };
}

type QuoteWithLines = Record<string, unknown> & { lineItems: StoredLine[] };

export function serializeQuote(q: QuoteWithLines) {
  return {
    id: q.id,
    number: q.number,
    title: q.title,
    status: q.status,
    contactId: q.contactId,
    companyId: q.companyId,
    dealId: q.dealId,
    templateId: q.templateId,
    currency: q.currency,
    overheadPct: q.overheadPct,
    marginPct: q.marginPct,
    marginFloorPct: q.marginFloorPct,
    discountPaise: q.discountPaise,
    discountInr: toRupees(Number(q.discountPaise) || 0),
    materialCostPaise: q.materialCostPaise,
    laborCostPaise: q.laborCostPaise,
    overheadPaise: q.overheadPaise,
    subtotalCostPaise: q.subtotalCostPaise,
    marginPaise: q.marginPaise,
    totalPaise: q.totalPaise,
    totalInr: toRupees(Number(q.totalPaise) || 0),
    marginPctActual: q.marginPctActual,
    // GST is display-only on top of the taxable total (does not affect costing/margin).
    gstPercent: q.gstPercent ?? 0,
    gstPaise: gstOf(q),
    grandTotalPaise: (Number(q.totalPaise) || 0) + gstOf(q),
    grandTotalInr: toRupees((Number(q.totalPaise) || 0) + gstOf(q)),
    notes: q.notes,
    terms: q.terms,
    validUntil: q.validUntil,
    sentAt: q.sentAt,
    acceptedAt: q.acceptedAt,
    rejectedAt: q.rejectedAt,
    rejectedReason: q.rejectedReason,
    createdAt: q.createdAt,
    updatedAt: q.updatedAt,
    // Linked customer (if any) — surfaced so the list/PDF can show who the quote is for.
    contactName: contactField(q, "fullName"),
    contactPhone: contactField(q, "phoneE164"),
    contactEmail: contactField(q, "email"),
    lineItems: (q.lineItems ?? []).map(serializeLine),
  };
}

const gstOf = (q: QuoteWithLines): number =>
  Math.round((Number(q.totalPaise) || 0) * (Number(q.gstPercent) || 0) / 100);

const contactField = (q: QuoteWithLines, key: string): string | null => {
  const c = (q as Record<string, unknown>).contact as Record<string, unknown> | null | undefined;
  const v = c?.[key];
  return typeof v === "string" ? v : null;
};

const withLines = {
  lineItems: { orderBy: [{ sortOrder: "asc" as const }, { name: "asc" as const }] },
  contact: { select: { fullName: true, phoneE164: true, email: true } },
};

// ── Reads ────────────────────────────────────────────────────────────────────
export async function listQuotes(
  tenantId: string,
  opts: { status?: string; contactId?: string; dealId?: string; limit: number; offset: number },
) {
  const where: Record<string, unknown> = { tenantId };
  if (opts.status) where.status = opts.status;
  if (opts.contactId) where.contactId = opts.contactId;
  if (opts.dealId) where.dealId = opts.dealId;
  const [rows, total] = await Promise.all([
    prisma.quote.findMany({ where, include: withLines, orderBy: { createdAt: "desc" }, take: opts.limit, skip: opts.offset }),
    prisma.quote.count({ where }),
  ]);
  return { items: rows.map((r) => serializeQuote(r as unknown as QuoteWithLines)), total };
}

export async function getQuote(tenantId: string, id: string) {
  const q = await prisma.quote.findFirst({ where: { id, tenantId }, include: withLines });
  return q ? serializeQuote(q as unknown as QuoteWithLines) : null;
}

// Raw fetch (for lifecycle/PDF handlers that need the model, not the serialized shape).
export async function getQuoteRaw(tenantId: string, id: string) {
  return prisma.quote.findFirst({ where: { id, tenantId }, include: withLines });
}

// ── Number generation ──────────────────────────────────────────────────────────
// max+1 over the tenant's numbers for the year — NOT count+1, which collides as
// soon as a quote is deleted. The zero-padded fixed width makes the lexical max
// the numeric max (up to 9999 quotes/tenant/year); the unique (tenantId, number)
// index plus the caller's retry loop close the concurrent-create race.
async function nextQuoteNumber(tenantId: string, year: number, bump = 0): Promise<string> {
  const prefix = `Q-${year}-`;
  const last = await prisma.quote.findFirst({
    where: { tenantId, number: { startsWith: prefix } },
    orderBy: { number: "desc" },
    select: { number: true },
  });
  const lastSeq = last ? parseInt(last.number.slice(prefix.length), 10) || 0 : 0;
  return `${prefix}${String(lastSeq + 1 + bump).padStart(4, "0")}`;
}

const isUniqueViolation = (err: unknown): boolean =>
  err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

// Resolve the frozen material rate for a line: an inventory link snapshots the
// current InventoryItem.unitCostInr (rupees → paise); otherwise the caller's rate.
async function snapshotRatePaise(
  tenantId: string,
  inventoryItemId: string | null | undefined,
  fallbackPaise: number,
): Promise<number> {
  if (inventoryItemId) {
    const item = await prisma.inventoryItem.findFirst({ where: { id: inventoryItemId, tenantId }, select: { unitCostInr: true } });
    if (item) return Math.max(0, Math.round(item.unitCostInr)) * 100;
  }
  return Math.max(0, Math.round(fallbackPaise || 0));
}

// ── Recompute + persist (the write path) ─────────────────────────────────────────
// Recompute every line from its stored snapshot fields and roll up to quote totals,
// persisting the frozen integers in one transaction. Called after any draft mutation.
export async function recomputeQuote(tenantId: string, quoteId: string) {
  const quote = await prisma.quote.findFirst({ where: { id: quoteId, tenantId }, include: withLines });
  if (!quote) return null;
  const results: Array<{ id: string; r: LineResult }> = quote.lineItems.map((l) => ({
    id: l.id,
    r: computeLine({
      costBasis: normalizeBasis(l.costBasis),
      lengthMm: l.lengthMm,
      widthMm: l.widthMm,
      heightMm: l.heightMm,
      quantity: l.quantity,
      unitRatePaise: l.unitRatePaise,
      wastagePct: l.wastagePct,
      laborHours: l.laborHours,
      laborRatePaise: l.laborRatePaise,
    }),
  }));
  const roll: QuoteResult = computeQuote(results.map((x) => x.r), {
    overheadPct: quote.overheadPct,
    marginPct: quote.marginPct,
    marginFloorPct: quote.marginFloorPct,
    discountPaise: quote.discountPaise,
  });
  await prisma.$transaction([
    ...results.map((x) =>
      prisma.quoteLineItem.update({
        where: { id: x.id },
        data: {
          computedQty: x.r.computedQty,
          materialCostPaise: x.r.materialCostPaise,
          laborCostPaise: x.r.laborCostPaise,
          lineCostPaise: x.r.lineCostPaise,
        },
      }),
    ),
    prisma.quote.update({
      where: { id: quoteId },
      data: {
        materialCostPaise: roll.materialCostPaise,
        laborCostPaise: roll.laborCostPaise,
        overheadPaise: roll.overheadPaise,
        subtotalCostPaise: roll.subtotalCostPaise,
        marginPaise: roll.marginPaise,
        totalPaise: roll.totalPaise,
        marginPctActual: roll.marginPctActual,
      },
    }),
  ]);
  return getQuote(tenantId, quoteId);
}

// ── Create ───────────────────────────────────────────────────────────────────
export interface CreateQuoteInput {
  title: string;
  contactId?: string | null;
  companyId?: string | null;
  dealId?: string | null;
  templateId?: string | null;
  overheadPct?: number;
  marginPct?: number;
  marginFloorPct?: number;
  discountPaise?: number;
  gstPercent?: number;
  validUntil?: Date | null;
  notes?: string | null;
  terms?: string | null;
  createdById?: string | null;
  lines?: LineInputPayload[]; // explicit lines (overrides template seeding when provided)
}

export async function createQuote(tenantId: string, input: CreateQuoteInput) {
  const year = new Date().getFullYear();
  // Knobs default from the template (if any), then from input overrides.
  let knobs = { overheadPct: 15, marginPct: 40, marginFloorPct: 30, laborRatePaise: 0 };
  let seededLines: LineInputPayload[] = [];
  if (input.templateId) {
    const tpl = await prisma.quoteTemplate.findFirst({
      where: { id: input.templateId, tenantId },
      include: { components: { orderBy: { sortOrder: "asc" } } },
    });
    if (tpl) {
      knobs = { overheadPct: tpl.overheadPct, marginPct: tpl.marginPct, marginFloorPct: tpl.marginFloorPct, laborRatePaise: tpl.laborRatePaise };
      seededLines = tpl.components.map((c) => ({
        groupName: input.title,
        name: c.name,
        kind: c.kind,
        costBasis: c.costBasis,
        lengthMm: c.defaultLengthMm,
        widthMm: c.defaultWidthMm,
        heightMm: c.defaultHeightMm,
        quantity: c.defaultQuantity,
        inventoryItemId: c.inventoryItemId,
        materialUnit: c.materialUnit,
        unitRatePaise: c.defaultRatePaise,
        wastagePct: c.wastagePct,
        laborHours: c.laborHours,
        laborRatePaise: tpl.laborRatePaise,
      }));
    }
  }
  const lines = input.lines && input.lines.length > 0 ? input.lines : seededLines;

  // Number allocation with a collision-retry: two concurrent creates can compute
  // the same max+1; the unique (tenantId, number) index rejects the loser, who
  // re-reads the max (bumped by the attempt count to step past a winner whose
  // commit it may not see yet) and tries again.
  let quote: { id: string } | null = null;
  for (let attempt = 0; attempt < 5 && !quote; attempt++) {
    const number = await nextQuoteNumber(tenantId, year, attempt);
    try {
      quote = await prisma.quote.create({
        data: {
          tenantId,
          number,
          title: input.title,
          status: "draft",
          contactId: input.contactId ?? null,
          companyId: input.companyId ?? null,
          dealId: input.dealId ?? null,
          templateId: input.templateId ?? null,
          overheadPct: input.overheadPct ?? knobs.overheadPct,
          marginPct: input.marginPct ?? knobs.marginPct,
          marginFloorPct: input.marginFloorPct ?? knobs.marginFloorPct,
          discountPaise: Math.max(0, Math.round(input.discountPaise ?? 0)),
          gstPercent: Math.max(0, input.gstPercent ?? 0),
          validUntil: input.validUntil ?? null,
          notes: input.notes ?? null,
          terms: input.terms ?? null,
          createdById: input.createdById ?? null,
        },
      });
    } catch (err) {
      if (!isUniqueViolation(err) || attempt === 4) throw err;
    }
  }
  if (!quote) throw new Error("Could not allocate a quote number");

  // Snapshot each line's rate and create it.
  for (let i = 0; i < lines.length; i++) {
    await addLineRaw(tenantId, quote.id, lines[i], i, knobs.laborRatePaise);
  }
  return recomputeQuote(tenantId, quote.id);
}

// Internal: create one line with a frozen rate snapshot (no recompute — caller does it).
async function addLineRaw(
  tenantId: string,
  quoteId: string,
  line: LineInputPayload,
  sortOrder: number,
  defaultLaborRatePaise: number,
) {
  const unitRatePaise = await snapshotRatePaise(tenantId, line.inventoryItemId, line.unitRatePaise ?? 0);
  return prisma.quoteLineItem.create({
    data: {
      quoteId,
      tenantId,
      groupName: (line.groupName ?? "General").trim() || "General",
      name: line.name.trim(),
      kind: normalizeKind(line.kind),
      costBasis: normalizeBasis(line.costBasis),
      lengthMm: intOrNull(line.lengthMm),
      widthMm: intOrNull(line.widthMm),
      heightMm: intOrNull(line.heightMm),
      quantity: numOr(line.quantity, 1),
      inventoryItemId: line.inventoryItemId ?? null,
      materialUnit: (line.materialUnit ?? "sqft").trim() || "sqft",
      unitRatePaise,
      wastagePct: Math.max(0, numOr(line.wastagePct, 0)),
      laborHours: Math.max(0, numOr(line.laborHours, 0)),
      laborRatePaise: Math.max(0, Math.round(line.laborRatePaise ?? defaultLaborRatePaise ?? 0)),
      computedQty: 0,
      materialCostPaise: 0,
      laborCostPaise: 0,
      lineCostPaise: 0,
      sortOrder: line.sortOrder ?? sortOrder,
    },
  });
}

// ── Draft mutations (routes enforce draft-only before calling) ───────────────────
export async function updateQuoteFields(
  tenantId: string,
  id: string,
  fields: Partial<{
    title: string; contactId: string | null; companyId: string | null; dealId: string | null;
    overheadPct: number; marginPct: number; marginFloorPct: number; discountPaise: number;
    gstPercent: number; validUntil: Date | null; notes: string | null; terms: string | null;
  }>,
) {
  await prisma.quote.update({ where: { id }, data: fields });
  return recomputeQuote(tenantId, id);
}

// Replace all line items on a draft quote (used by the builder's Edit flow). Deletes
// existing lines and re-creates them with fresh rate snapshots, then recomputes.
export async function replaceQuoteLines(tenantId: string, quoteId: string, lines: LineInputPayload[], defaultLaborRatePaise = 0) {
  await prisma.quoteLineItem.deleteMany({ where: { quoteId, tenantId } });
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i]?.name?.trim()) continue;
    await addLineRaw(tenantId, quoteId, lines[i], i, defaultLaborRatePaise);
  }
  return recomputeQuote(tenantId, quoteId);
}

export async function addLine(tenantId: string, quoteId: string, line: LineInputPayload) {
  const count = await prisma.quoteLineItem.count({ where: { quoteId } });
  await addLineRaw(tenantId, quoteId, line, count, 0);
  return recomputeQuote(tenantId, quoteId);
}

export async function updateLine(tenantId: string, quoteId: string, lineId: string, patch: LineInputPayload) {
  const existing = await prisma.quoteLineItem.findFirst({ where: { id: lineId, quoteId, tenantId } });
  if (!existing) return null;
  // If the inventory link or explicit rate changed, re-snapshot the rate.
  let unitRatePaise = existing.unitRatePaise;
  if (patch.inventoryItemId !== undefined || patch.unitRatePaise !== undefined) {
    unitRatePaise = await snapshotRatePaise(
      tenantId,
      patch.inventoryItemId !== undefined ? patch.inventoryItemId : existing.inventoryItemId,
      patch.unitRatePaise ?? Math.round(existing.unitRatePaise),
    );
  }
  await prisma.quoteLineItem.update({
    where: { id: lineId },
    data: {
      ...(patch.groupName !== undefined ? { groupName: (patch.groupName ?? "General").trim() || "General" } : {}),
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.kind !== undefined ? { kind: normalizeKind(patch.kind) } : {}),
      ...(patch.costBasis !== undefined ? { costBasis: normalizeBasis(patch.costBasis) } : {}),
      ...(patch.lengthMm !== undefined ? { lengthMm: intOrNull(patch.lengthMm) } : {}),
      ...(patch.widthMm !== undefined ? { widthMm: intOrNull(patch.widthMm) } : {}),
      ...(patch.heightMm !== undefined ? { heightMm: intOrNull(patch.heightMm) } : {}),
      ...(patch.quantity !== undefined ? { quantity: numOr(patch.quantity, 1) } : {}),
      ...(patch.inventoryItemId !== undefined ? { inventoryItemId: patch.inventoryItemId ?? null } : {}),
      ...(patch.materialUnit !== undefined ? { materialUnit: (patch.materialUnit ?? "sqft").trim() || "sqft" } : {}),
      unitRatePaise,
      ...(patch.wastagePct !== undefined ? { wastagePct: Math.max(0, numOr(patch.wastagePct, 0)) } : {}),
      ...(patch.laborHours !== undefined ? { laborHours: Math.max(0, numOr(patch.laborHours, 0)) } : {}),
      ...(patch.laborRatePaise !== undefined ? { laborRatePaise: Math.max(0, Math.round(patch.laborRatePaise)) } : {}),
      ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
    },
  });
  return recomputeQuote(tenantId, quoteId);
}

export async function deleteLine(tenantId: string, quoteId: string, lineId: string) {
  const r = await prisma.quoteLineItem.deleteMany({ where: { id: lineId, quoteId, tenantId } });
  if (r.count === 0) return null;
  return recomputeQuote(tenantId, quoteId);
}

export async function deleteQuote(tenantId: string, id: string) {
  const r = await prisma.quote.deleteMany({ where: { id, tenantId } });
  return r.count > 0;
}

// Recompute the margin-floor status from the quote's stored line costs. Used by the
// send/accept guard so a hand-crafted request cannot commit a below-floor price.
export async function quoteFloorStatus(tenantId: string, id: string) {
  const quote = await prisma.quote.findFirst({ where: { id, tenantId }, include: withLines });
  if (!quote) return null;
  const roll = computeQuote(
    quote.lineItems.map((l) => ({
      computedQty: l.computedQty,
      materialCostPaise: l.materialCostPaise,
      laborCostPaise: l.laborCostPaise,
      lineCostPaise: l.lineCostPaise,
    })),
    { overheadPct: quote.overheadPct, marginPct: quote.marginPct, marginFloorPct: quote.marginFloorPct, discountPaise: quote.discountPaise },
  );
  return {
    floorViolation: roll.floorViolation,
    minTotalPaise: roll.minTotalPaise,
    marginFloorPct: quote.marginFloorPct,
    totalPaise: roll.totalPaise,
    status: quote.status as QuoteStatus,
    hasLines: quote.lineItems.length > 0,
  };
}

// ── Lifecycle transitions ────────────────────────────────────────────────────
export async function markSent(tenantId: string, id: string) {
  await prisma.quote.update({ where: { id }, data: { status: "sent", sentAt: new Date() } });
  return getQuote(tenantId, id);
}
export async function markAccepted(tenantId: string, id: string) {
  await prisma.quote.update({ where: { id }, data: { status: "accepted", acceptedAt: new Date() } });
  return getQuote(tenantId, id);
}
export async function markRejected(tenantId: string, id: string, reason: string | null) {
  await prisma.quote.update({ where: { id }, data: { status: "rejected", rejectedAt: new Date(), rejectedReason: reason } });
  return getQuote(tenantId, id);
}
export async function markExpired(tenantId: string, id: string) {
  await prisma.quote.update({ where: { id }, data: { status: "expired" } });
  return getQuote(tenantId, id);
}

// ── Expiry sweep ─────────────────────────────────────────────────────────────
// Flip sent quotes past their validUntil to expired. Naturally idempotent (the
// status filter means each quote transitions at most once), so the automation
// cycle can call it every tick without claim records. Deliberately global: the
// where clause only touches rows that are due, whatever their tenant.
export async function expireOverdueQuotes(now = new Date()): Promise<number> {
  const r = await prisma.quote.updateMany({
    where: { status: "sent", validUntil: { lt: now } },
    data: { status: "expired" },
  });
  return r.count;
}

// ── Templates ──────────────────────────────────────────────────────────────────
export interface TemplateComponentPayload {
  name: string;
  kind?: string;
  costBasis?: string;
  inventoryItemId?: string | null;
  materialUnit?: string;
  defaultRatePaise?: number;
  defaultLengthMm?: number | null;
  defaultWidthMm?: number | null;
  defaultHeightMm?: number | null;
  defaultQuantity?: number;
  wastagePct?: number;
  laborHours?: number;
  sortOrder?: number;
}
export interface TemplatePayload {
  name: string;
  category?: string;
  description?: string | null;
  isActive?: boolean;
  overheadPct?: number;
  marginPct?: number;
  marginFloorPct?: number;
  laborRatePaise?: number;
  components?: TemplateComponentPayload[];
}

function serializeTemplate(t: Record<string, unknown> & { components: unknown[] }) {
  return {
    id: t.id, name: t.name, category: t.category, description: t.description, isActive: t.isActive,
    overheadPct: t.overheadPct, marginPct: t.marginPct, marginFloorPct: t.marginFloorPct,
    laborRatePaise: t.laborRatePaise, createdAt: t.createdAt, updatedAt: t.updatedAt,
    components: (t.components as Array<Record<string, unknown>>).map((c) => ({
      id: c.id, name: c.name, kind: c.kind, costBasis: c.costBasis, inventoryItemId: c.inventoryItemId,
      materialUnit: c.materialUnit, defaultRatePaise: c.defaultRatePaise,
      defaultLengthMm: c.defaultLengthMm, defaultWidthMm: c.defaultWidthMm, defaultHeightMm: c.defaultHeightMm,
      defaultQuantity: c.defaultQuantity, wastagePct: c.wastagePct, laborHours: c.laborHours, sortOrder: c.sortOrder,
    })),
  };
}

const tplInclude = { components: { orderBy: { sortOrder: "asc" as const } } };

export async function listTemplates(tenantId: string) {
  const rows = await prisma.quoteTemplate.findMany({ where: { tenantId }, include: tplInclude, orderBy: { name: "asc" } });
  return rows.map((r) => serializeTemplate(r as never));
}
export async function getTemplate(tenantId: string, id: string) {
  const t = await prisma.quoteTemplate.findFirst({ where: { id, tenantId }, include: tplInclude });
  return t ? serializeTemplate(t as never) : null;
}
function componentData(tenantId: string, c: TemplateComponentPayload, i: number) {
  return {
    tenantId,
    name: c.name.trim(),
    kind: normalizeKind(c.kind),
    costBasis: normalizeBasis(c.costBasis),
    inventoryItemId: c.inventoryItemId ?? null,
    materialUnit: (c.materialUnit ?? "sqft").trim() || "sqft",
    defaultRatePaise: Math.max(0, Math.round(c.defaultRatePaise ?? 0)),
    defaultLengthMm: intOrNull(c.defaultLengthMm),
    defaultWidthMm: intOrNull(c.defaultWidthMm),
    defaultHeightMm: intOrNull(c.defaultHeightMm),
    defaultQuantity: numOr(c.defaultQuantity, 1),
    wastagePct: Math.max(0, numOr(c.wastagePct, 0)),
    laborHours: Math.max(0, numOr(c.laborHours, 0)),
    sortOrder: c.sortOrder ?? i,
  };
}
export async function createTemplate(tenantId: string, p: TemplatePayload) {
  const t = await prisma.quoteTemplate.create({
    data: {
      tenantId,
      name: p.name.trim(),
      category: (p.category ?? "Furniture").trim() || "Furniture",
      description: p.description ?? null,
      isActive: p.isActive ?? true,
      overheadPct: numOr(p.overheadPct, 15),
      marginPct: numOr(p.marginPct, 40),
      marginFloorPct: numOr(p.marginFloorPct, 30),
      laborRatePaise: Math.max(0, Math.round(p.laborRatePaise ?? 0)),
      components: { create: (p.components ?? []).map((c, i) => componentData(tenantId, c, i)) },
    },
    include: tplInclude,
  });
  return serializeTemplate(t as never);
}
export async function updateTemplate(tenantId: string, id: string, p: TemplatePayload) {
  const existing = await prisma.quoteTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
  if (!existing) return null;
  // Replace components wholesale when provided (simplest correct semantics for editing a preset).
  await prisma.$transaction([
    prisma.quoteTemplate.update({
      where: { id },
      data: {
        ...(p.name !== undefined ? { name: p.name.trim() } : {}),
        ...(p.category !== undefined ? { category: (p.category ?? "Furniture").trim() || "Furniture" } : {}),
        ...(p.description !== undefined ? { description: p.description } : {}),
        ...(p.isActive !== undefined ? { isActive: p.isActive } : {}),
        ...(p.overheadPct !== undefined ? { overheadPct: numOr(p.overheadPct, 15) } : {}),
        ...(p.marginPct !== undefined ? { marginPct: numOr(p.marginPct, 40) } : {}),
        ...(p.marginFloorPct !== undefined ? { marginFloorPct: numOr(p.marginFloorPct, 30) } : {}),
        ...(p.laborRatePaise !== undefined ? { laborRatePaise: Math.max(0, Math.round(p.laborRatePaise)) } : {}),
      },
    }),
    ...(p.components !== undefined
      ? [
          prisma.templateComponent.deleteMany({ where: { templateId: id } }),
          prisma.templateComponent.createMany({ data: p.components.map((c, i) => ({ ...componentData(tenantId, c, i), templateId: id })) }),
        ]
      : []),
  ]);
  return getTemplate(tenantId, id);
}
export async function deleteTemplate(tenantId: string, id: string) {
  const r = await prisma.quoteTemplate.deleteMany({ where: { id, tenantId } });
  return r.count > 0;
}

// ── PDF blocks ───────────────────────────────────────────────────────────────
// Build ReportBlock[] (report-html/report-pdf schema) for a quote. One table per
// piece (groupName) + a totals table. Money is rendered as "Rs. x,xx,xxx" (pdfSafe
// maps ₹→Rs.). Returns blocks; the route wraps them with renderBrandedReportPdf.
export function quotePdfBlocks(q: ReturnType<typeof serializeQuote>) {
  const money = (paise: number) => `Rs. ${(Math.round(paise) / 100).toLocaleString("en-IN")}`;
  const dims = (l: ReturnType<typeof serializeLine>) => {
    const parts = [l.lengthMm, l.widthMm, l.heightMm].filter((v): v is number => typeof v === "number" && v > 0);
    return parts.length ? parts.join(" × ") + " mm" : "—";
  };
  const blocks: Array<
    | { kind: "headline"; text: string }
    | { kind: "section"; heading: string; body: string }
    | { kind: "table"; heading?: string; header: string[]; rows: Array<Array<string | number>> }
  > = [];
  const total = Number(q.totalPaise) || 0;
  const gstPct = Number(q.gstPercent) || 0;
  const gst = Math.round((total * gstPct) / 100);
  blocks.push({ kind: "headline", text: `${String(q.title)} — ${money(total + gst)}` });

  // "Prepared for" — the linked customer, if any.
  if (q.contactName) {
    const contact = q.contactPhone ? `${q.contactName} · ${q.contactPhone}` : String(q.contactName);
    blocks.push({ kind: "section", heading: "Prepared for", body: contact });
  }

  // Customer-facing line items: one row per PIECE at its selling price (the total
  // allocated across pieces by cost share) — the customer never sees the internal
  // material/labor/overhead/margin breakdown. Components are listed as a spec only.
  const groups = new Map<string, ReturnType<typeof serializeLine>[]>();
  for (const l of q.lineItems) {
    const arr = groups.get(l.groupName) ?? [];
    arr.push(l);
    groups.set(l.groupName, arr);
  }
  const entries = [...groups.entries()];
  const costByGroup = entries.map(([, lines]) => lines.reduce((s, l) => s + l.lineCostPaise, 0));
  const totalCost = costByGroup.reduce((s, c) => s + c, 0);
  let allocated = 0;
  const rows: Array<Array<string | number>> = entries.map(([group, lines], i) => {
    const selling = i === entries.length - 1 || totalCost <= 0
      ? total - allocated
      : Math.round((total * costByGroup[i]) / totalCost);
    allocated += selling;
    const spec = lines.map((l) => (dims(l) !== "—" ? `${l.name} (${dims(l)})` : l.name)).join(", ");
    return [group, spec, money(selling)];
  });
  blocks.push({ kind: "table", heading: "Quotation", header: ["Item", "Specification", "Amount"], rows });

  blocks.push({
    kind: "table",
    heading: "Summary",
    header: ["", "Amount"],
    rows: [
      ["Subtotal", money(total)],
      ...(gstPct > 0 ? [[`GST @ ${gstPct}%`, money(gst)] as [string, string]] : []),
      ["Grand Total", money(total + gst)],
    ],
  });

  if (q.terms) blocks.push({ kind: "section", heading: "Terms", body: String(q.terms) });
  if (q.validUntil) {
    const d = new Date(q.validUntil as unknown as string);
    blocks.push({ kind: "section", heading: "Validity", body: `Valid until ${d.toISOString().slice(0, 10)}` });
  }
  return blocks;
}

// ── helpers ────────────────────────────────────────────────────────────────────
function intOrNull(v: number | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n) : null;
}
function numOr(v: number | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}
