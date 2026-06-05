// CRM company / account service helpers (Increment B).

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

export interface CompanyCreateValue {
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  ownerId: string | null;
  tags: string[];
  notes: string | null;
}

export function validateCompanyCreate(body: Record<string, unknown>): Result<CompanyCreateValue> {
  const name = optString(body.name);
  if (!name) return { ok: false, error: "Company name is required" };
  if (name.length > 200) return { ok: false, error: "Company name is too long (max 200)" };
  return {
    ok: true,
    value: {
      name,
      domain: optString(body.domain),
      industry: optString(body.industry),
      size: optString(body.size),
      ownerId: optString(body.ownerId),
      tags: optStringArray(body.tags) ?? [],
      notes: optString(body.notes),
    },
  };
}

export interface CompanyUpdate {
  name?: string;
  domain?: string | null;
  industry?: string | null;
  size?: string | null;
  ownerId?: string | null;
  tags?: string[];
  notes?: string | null;
}

export function buildCompanyUpdate(body: Record<string, unknown>): Result<CompanyUpdate> {
  const update: CompanyUpdate = {};
  if ("name" in body) {
    const name = optString(body.name);
    if (!name) return { ok: false, error: "Company name cannot be empty" };
    update.name = name;
  }
  if ("domain" in body) update.domain = optString(body.domain);
  if ("industry" in body) update.industry = optString(body.industry);
  if ("size" in body) update.size = optString(body.size);
  if ("ownerId" in body) update.ownerId = optString(body.ownerId);
  if ("tags" in body) update.tags = optStringArray(body.tags) ?? [];
  if ("notes" in body) update.notes = optString(body.notes);
  if (Object.keys(update).length === 0) return { ok: false, error: "No updatable fields provided" };
  return { ok: true, value: update };
}

type CompanyRow = {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  ownerId: string | null;
  tags: string[];
  notes: string | null;
  createdAt: Date;
  updatedAt: Date;
  owner?: { id: string; fullName: string } | null;
  _count?: { contacts: number; deals: number } | null;
};

export function serializeCompany(c: CompanyRow) {
  return {
    id: c.id,
    name: c.name,
    domain: c.domain,
    industry: c.industry,
    size: c.size,
    ownerId: c.ownerId,
    ownerName: c.owner?.fullName ?? null,
    tags: c.tags,
    notes: c.notes,
    contactCount: c._count?.contacts ?? undefined,
    dealCount: c._count?.deals ?? undefined,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}
