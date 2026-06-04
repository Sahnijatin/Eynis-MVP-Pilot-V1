// Lead segmentation (Tier-1 improvement).
//
// A SegmentRules object is a small, safe filter DSL stored as JSON on a
// LeadSegment. buildLeadWhere() compiles it to a Prisma CampaignLeadWhereInput
// (WITHOUT tenant/campaign scope — the caller ANDs that on) so one definition
// drives the leads list, the segment preview, and campaign targeting alike.
//
// Kept pure (no DB/HTTP) so the rule semantics are unit-testable in isolation.

import type { Prisma } from "@prisma/client";

export interface SegmentRules {
  status?: string[];   // lead.status in [...]
  consent?: boolean;   // exact match
  optedOut?: boolean;  // exact match
  tagsAny?: string[];  // has at least one of these tags
  tagsAll?: string[];  // has every one of these tags
  tagsNot?: string[];  // has none of these tags
  company?: string;    // case-insensitive contains
  jobTitle?: string;   // case-insensitive contains
  search?: string;     // case-insensitive contains across name/email/company
}

const cleanStrings = (v: unknown): string[] =>
  Array.isArray(v) ? Array.from(new Set(v.map((s) => String(s).trim()).filter((s) => s.length > 0))) : [];

const cleanStr = (v: unknown): string | undefined => {
  if (typeof v !== "string") return undefined;
  const s = v.trim();
  return s.length > 0 ? s : undefined;
};

// Parse/normalise untrusted JSON into SegmentRules. Unknown keys are dropped and
// malformed values ignored, so a bad rule never throws at query time.
export function parseSegmentRules(raw: unknown): SegmentRules {
  let obj: Record<string, unknown> = {};
  if (typeof raw === "string") { try { obj = JSON.parse(raw) ?? {}; } catch { obj = {}; } }
  else if (raw && typeof raw === "object") obj = raw as Record<string, unknown>;

  const rules: SegmentRules = {};
  const status = cleanStrings(obj.status); if (status.length) rules.status = status;
  if (typeof obj.consent === "boolean") rules.consent = obj.consent;
  if (typeof obj.optedOut === "boolean") rules.optedOut = obj.optedOut;
  const tagsAny = cleanStrings(obj.tagsAny); if (tagsAny.length) rules.tagsAny = tagsAny;
  const tagsAll = cleanStrings(obj.tagsAll); if (tagsAll.length) rules.tagsAll = tagsAll;
  const tagsNot = cleanStrings(obj.tagsNot); if (tagsNot.length) rules.tagsNot = tagsNot;
  const company = cleanStr(obj.company); if (company) rules.company = company;
  const jobTitle = cleanStr(obj.jobTitle); if (jobTitle) rules.jobTitle = jobTitle;
  const search = cleanStr(obj.search); if (search) rules.search = search;
  return rules;
}

// Compile rules to a Prisma where-clause. Returns {} for an empty rule set
// (matches everything within the caller's scope). The caller MUST AND this with
// the tenant/campaign scope — these rules never include tenantId/campaignId.
export function buildLeadWhere(rules: SegmentRules): Prisma.CampaignLeadWhereInput {
  const and: Prisma.CampaignLeadWhereInput[] = [];
  if (rules.status?.length) and.push({ status: { in: rules.status } });
  if (rules.consent !== undefined) and.push({ consent: rules.consent });
  if (rules.optedOut !== undefined) and.push({ optedOut: rules.optedOut });
  if (rules.tagsAny?.length) and.push({ tags: { hasSome: rules.tagsAny } });
  if (rules.tagsAll?.length) and.push({ tags: { hasEvery: rules.tagsAll } });
  if (rules.tagsNot?.length) and.push({ NOT: { tags: { hasSome: rules.tagsNot } } });
  if (rules.company) and.push({ company: { contains: rules.company, mode: "insensitive" } });
  if (rules.jobTitle) and.push({ jobTitle: { contains: rules.jobTitle, mode: "insensitive" } });
  if (rules.search) {
    const s = rules.search;
    and.push({
      OR: [
        { firstName: { contains: s, mode: "insensitive" } },
        { lastName: { contains: s, mode: "insensitive" } },
        { email: { contains: s, mode: "insensitive" } },
        { company: { contains: s, mode: "insensitive" } },
      ],
    });
  }
  return and.length ? { AND: and } : {};
}

// Normalise a free-form tag list from API input.
export const normalizeTags = (v: unknown): string[] => cleanStrings(v);
