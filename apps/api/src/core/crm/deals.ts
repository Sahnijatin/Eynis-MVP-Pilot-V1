// CRM deal service helpers (Increment A).
//
// Pure, testable validation + serialization behind the /deals endpoints. Keeps
// the HTTP handler in server.ts thin. Prisma's Decimal is serialized to a number
// (or null) so the API/web never leak a Decimal object.

import { DEFAULT_CURRENCY } from "./pipeline";

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

const INVALID_DATE = Symbol("invalid_date");
function parseOptionalDate(v: unknown): Date | null | typeof INVALID_DATE {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return INVALID_DATE;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? INVALID_DATE : d;
}

// Accept number or numeric string; null/"" → null; anything else / negative → error.
const INVALID_NUMBER = Symbol("invalid_number");
function parseOptionalAmount(v: unknown): number | null | typeof INVALID_NUMBER {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : typeof v === "string" ? Number(v) : NaN;
  if (!Number.isFinite(n) || n < 0) return INVALID_NUMBER;
  return n;
}

function optString(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export interface DealCreateValue {
  title: string;
  value: number | null;
  currency: string;
  pipelineId: string | null;
  stageId: string | null;
  contactId: string | null;
  companyId: string | null;
  ownerId: string | null;
  expectedCloseAt: Date | null;
  source: string;
}

export function validateDealCreate(body: Record<string, unknown>): Result<DealCreateValue> {
  const title = optString(body.title);
  if (!title) return { ok: false, error: "Deal title is required" };
  if (title.length > 200) return { ok: false, error: "Deal title is too long (max 200)" };

  const value = parseOptionalAmount(body.value);
  if (value === INVALID_NUMBER) return { ok: false, error: "Deal value must be a non-negative number" };

  const expectedCloseAt = parseOptionalDate(body.expectedCloseAt);
  if (expectedCloseAt === INVALID_DATE) return { ok: false, error: "expectedCloseAt must be a valid date" };

  return {
    ok: true,
    value: {
      title,
      value,
      currency: optString(body.currency) ?? DEFAULT_CURRENCY,
      pipelineId: optString(body.pipelineId),
      stageId: optString(body.stageId),
      contactId: optString(body.contactId),
      companyId: optString(body.companyId),
      ownerId: optString(body.ownerId),
      expectedCloseAt,
      source: optString(body.source) ?? "manual",
    },
  };
}

// Allow-listed update builder — only these fields are mutable via PATCH. Stage
// changes go through the dedicated /deals/:id/move route (which logs a transition).
export interface DealUpdate {
  title?: string;
  value?: number | null;
  currency?: string;
  contactId?: string | null;
  companyId?: string | null;
  ownerId?: string | null;
  expectedCloseAt?: Date | null;
  lostReason?: string | null;
}

export function buildDealUpdate(body: Record<string, unknown>): Result<DealUpdate> {
  const update: DealUpdate = {};

  if ("title" in body) {
    const title = optString(body.title);
    if (!title) return { ok: false, error: "Deal title cannot be empty" };
    if (title.length > 200) return { ok: false, error: "Deal title is too long (max 200)" };
    update.title = title;
  }
  if ("value" in body) {
    const value = parseOptionalAmount(body.value);
    if (value === INVALID_NUMBER) return { ok: false, error: "Deal value must be a non-negative number" };
    update.value = value;
  }
  if ("currency" in body) {
    update.currency = optString(body.currency) ?? DEFAULT_CURRENCY;
  }
  if ("contactId" in body) update.contactId = optString(body.contactId);
  if ("companyId" in body) update.companyId = optString(body.companyId);
  if ("ownerId" in body) update.ownerId = optString(body.ownerId);
  if ("expectedCloseAt" in body) {
    const d = parseOptionalDate(body.expectedCloseAt);
    if (d === INVALID_DATE) return { ok: false, error: "expectedCloseAt must be a valid date" };
    update.expectedCloseAt = d;
  }
  if ("lostReason" in body) update.lostReason = optString(body.lostReason);

  if (Object.keys(update).length === 0) {
    return { ok: false, error: "No updatable fields provided" };
  }
  return { ok: true, value: update };
}

// Serialize a Deal row (with optional includes) to a plain JSON object.
// `value` (Prisma Decimal) → number | null.
export function serializeDeal(d: {
  id: string;
  title: string;
  value: unknown;
  currency: string;
  pipelineId: string;
  stageId: string;
  contactId: string | null;
  companyId?: string | null;
  ownerId: string | null;
  status: string;
  expectedCloseAt: Date | null;
  closedAt: Date | null;
  lostReason: string | null;
  source: string | null;
  createdAt: Date;
  updatedAt: Date;
  stage?: { id: string; name: string; probability: number; isWon: boolean; isLost: boolean } | null;
  contact?: { id: string; fullName: string } | null;
  company?: { id: string; name: string } | null;
  owner?: { id: string; fullName: string } | null;
}) {
  return {
    id: d.id,
    title: d.title,
    value: d.value === null || d.value === undefined ? null : Number(d.value),
    currency: d.currency,
    pipelineId: d.pipelineId,
    stageId: d.stageId,
    stageName: d.stage?.name ?? null,
    contactId: d.contactId,
    contactName: d.contact?.fullName ?? null,
    companyId: d.companyId ?? null,
    companyName: d.company?.name ?? null,
    ownerId: d.ownerId,
    ownerName: d.owner?.fullName ?? null,
    status: d.status,
    expectedCloseAt: d.expectedCloseAt ? d.expectedCloseAt.toISOString() : null,
    closedAt: d.closedAt ? d.closedAt.toISOString() : null,
    lostReason: d.lostReason,
    source: d.source,
    createdAt: d.createdAt.toISOString(),
    updatedAt: d.updatedAt.toISOString(),
  };
}
