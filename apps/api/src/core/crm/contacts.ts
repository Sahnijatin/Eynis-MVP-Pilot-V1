// CRM contact service helpers (Increment B).
//
// Validation, the allow-listed update builder, serialization, and the idempotent
// backfill that turns campaign leads into durable, deduplicated Contact records.

import { prisma } from "../../db/prisma";

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

function optString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
function optStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  return v.filter((x): x is string => typeof x === "string").map((s) => s.trim()).filter(Boolean);
}
function optInt(v: unknown): number | null | undefined {
  if (v === null) return null;
  if (v === undefined || v === "") return undefined;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? Math.round(n) : undefined;
}

export const LIFECYCLE_STAGES = ["subscriber", "lead", "mql", "sql", "opportunity", "customer"] as const;

export interface ContactCreateValue {
  fullName: string;
  phoneE164: string;
  email: string | null;
  lifecycleStage: string;
  leadStatus: string | null;
  companyId: string | null;
  ownerId: string | null;
  tags: string[];
  source: string;
  notes: string | null;
}

export function validateContactCreate(body: Record<string, unknown>): Result<ContactCreateValue> {
  const fullName = optString(body.fullName);
  if (!fullName) return { ok: false, error: "Contact name is required" };
  if (fullName.length > 200) return { ok: false, error: "Contact name is too long (max 200)" };
  // Phone is the dedupe key but optional for B2B/email-only contacts; default to "".
  const phoneE164 = optString(body.phoneE164) ?? optString(body.phone) ?? "";
  return {
    ok: true,
    value: {
      fullName,
      phoneE164,
      email: optString(body.email),
      lifecycleStage: optString(body.lifecycleStage) ?? "lead",
      leadStatus: optString(body.leadStatus),
      companyId: optString(body.companyId),
      ownerId: optString(body.ownerId),
      tags: optStringArray(body.tags) ?? [],
      source: optString(body.source) ?? "manual",
      notes: optString(body.notes),
    },
  };
}

export interface ContactUpdate {
  fullName?: string;
  phoneE164?: string;
  email?: string | null;
  lifecycleStage?: string;
  leadStatus?: string | null;
  leadScore?: number | null;
  companyId?: string | null;
  ownerId?: string | null;
  tags?: string[];
  source?: string | null;
  notes?: string | null;
}

export function buildContactUpdate(body: Record<string, unknown>): Result<ContactUpdate> {
  const update: ContactUpdate = {};
  if ("fullName" in body) {
    const fullName = optString(body.fullName);
    if (!fullName) return { ok: false, error: "Contact name cannot be empty" };
    update.fullName = fullName;
  }
  if ("phoneE164" in body || "phone" in body) update.phoneE164 = optString(body.phoneE164) ?? optString(body.phone) ?? "";
  if ("email" in body) update.email = optString(body.email);
  if ("lifecycleStage" in body) update.lifecycleStage = optString(body.lifecycleStage) ?? "lead";
  if ("leadStatus" in body) update.leadStatus = optString(body.leadStatus);
  if ("leadScore" in body) {
    const n = optInt(body.leadScore);
    if (n !== undefined) update.leadScore = n;
  }
  if ("companyId" in body) update.companyId = optString(body.companyId);
  if ("ownerId" in body) update.ownerId = optString(body.ownerId);
  if ("tags" in body) update.tags = optStringArray(body.tags) ?? [];
  if ("source" in body) update.source = optString(body.source);
  if ("notes" in body) update.notes = optString(body.notes);
  if (Object.keys(update).length === 0) return { ok: false, error: "No updatable fields provided" };
  return { ok: true, value: update };
}

type ContactRow = {
  id: string;
  fullName: string;
  phoneE164: string;
  email: string | null;
  visitCount: number;
  companyId: string | null;
  ownerId: string | null;
  lifecycleStage: string;
  leadStatus: string | null;
  leadScore: number | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  company?: { id: string; name: string } | null;
  owner?: { id: string; fullName: string } | null;
  _count?: { deals: number } | null;
};

export function serializeContact(c: ContactRow) {
  return {
    id: c.id,
    fullName: c.fullName,
    phoneE164: c.phoneE164,
    email: c.email,
    visitCount: c.visitCount,
    companyId: c.companyId,
    companyName: c.company?.name ?? null,
    ownerId: c.ownerId,
    ownerName: c.owner?.fullName ?? null,
    lifecycleStage: c.lifecycleStage,
    leadStatus: c.leadStatus,
    leadScore: c.leadScore,
    source: c.source,
    tags: c.tags,
    notes: c.notes,
    dealCount: c._count?.deals ?? undefined,
    lastActivityAt: c.lastActivityAt ? c.lastActivityAt.toISOString() : null,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

// Idempotent: turn unlinked campaign leads (with a phone) into durable Contacts,
// deduping by (tenantId, phone). Re-running only processes still-unlinked leads.
export async function backfillContactsFromLeads(tenantId: string): Promise<{ linked: number; created: number }> {
  const leads = await prisma.campaignLead.findMany({
    where: { tenantId, contactId: null, phone: { not: null } },
    select: { id: true, phone: true, firstName: true, lastName: true, email: true },
  });
  let created = 0;
  let linked = 0;
  const byPhone = new Map<string, string>();
  for (const lead of leads) {
    const phone = lead.phone as string;
    let contactId = byPhone.get(phone);
    if (!contactId) {
      const existing = await prisma.contact.findFirst({ where: { tenantId, phoneE164: phone }, select: { id: true } });
      if (existing) {
        contactId = existing.id;
      } else {
        const fullName = [lead.firstName, lead.lastName].filter(Boolean).join(" ").trim() || lead.email || phone;
        const c = await prisma.contact.create({
          data: { tenantId, fullName, phoneE164: phone, email: lead.email ?? null, source: "campaign", lifecycleStage: "lead" },
          select: { id: true },
        });
        contactId = c.id;
        created += 1;
      }
      byPhone.set(phone, contactId);
    }
    await prisma.campaignLead.update({ where: { id: lead.id }, data: { contactId } });
    linked += 1;
  }
  return { linked, created };
}
