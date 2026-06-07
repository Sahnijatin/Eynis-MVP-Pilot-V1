// Custom report builder (E-16, Phase A). A report is a saved *definition* (data
// source + columns + filters + date range + group-by + sort) that is executed
// against tenant-scoped data at run time. Everything here is allow-listed: only
// the columns/sources declared in REPORT_SOURCES can be queried, so a definition
// can never reach a field/table it shouldn't (and every query is tenant-scoped).

import { prisma } from "../../db/prisma";

export type ColumnType = "text" | "number" | "date" | "badge";

export interface ReportColumn {
  key: string;
  label: string;
  type: ColumnType;
}

export interface ReportSource {
  key: string;
  label: string;
  // Permission a user must hold to query this source (per-source RBAC, E-16). The
  // module itself is gated by view_reports; this is the extra check so a report
  // can't surface data the user otherwise can't see.
  permission: string;
  dateField: string; // column the date-range filter applies to
  columns: ReportColumn[];
  metric?: { key: string; label: string }; // numeric column summed in group-by
}

// ── Source registry (Phase A: 3 core sources) ───────────────────────────────────
export const REPORT_SOURCES: ReportSource[] = [
  {
    key: "service_requests",
    label: "Service Requests",
    permission: "view_requests",
    dateField: "createdAt",
    columns: [
      { key: "category", label: "Category", type: "text" },
      { key: "status", label: "Status", type: "badge" },
      { key: "priority", label: "Priority", type: "badge" },
      { key: "source", label: "Source", type: "text" },
      { key: "summary", label: "Summary", type: "text" },
      { key: "createdAt", label: "Created", type: "date" },
      { key: "resolvedAt", label: "Resolved", type: "date" },
    ],
  },
  {
    key: "deals",
    label: "Deals",
    permission: "view_crm",
    dateField: "createdAt",
    metric: { key: "value", label: "Total value" },
    columns: [
      { key: "title", label: "Title", type: "text" },
      { key: "value", label: "Value", type: "number" },
      { key: "currency", label: "Currency", type: "text" },
      { key: "status", label: "Status", type: "badge" },
      { key: "source", label: "Source", type: "text" },
      { key: "expectedCloseAt", label: "Expected close", type: "date" },
      { key: "closedAt", label: "Closed", type: "date" },
      { key: "createdAt", label: "Created", type: "date" },
    ],
  },
  {
    key: "contacts",
    label: "Contacts",
    permission: "view_crm",
    dateField: "createdAt",
    columns: [
      { key: "fullName", label: "Name", type: "text" },
      { key: "phoneE164", label: "Phone", type: "text" },
      { key: "email", label: "Email", type: "text" },
      { key: "lifecycleStage", label: "Lifecycle", type: "badge" },
      { key: "leadStatus", label: "Lead status", type: "badge" },
      { key: "leadScore", label: "Lead score", type: "number" },
      { key: "source", label: "Source", type: "text" },
      { key: "visitCount", label: "Visits", type: "number" },
      { key: "createdAt", label: "Created", type: "date" },
      { key: "lastActivityAt", label: "Last activity", type: "date" },
    ],
  },
];

export const getReportSource = (key: string): ReportSource | undefined =>
  REPORT_SOURCES.find((s) => s.key === key);

// ── Definition shape (stored as JSON on Report.definitionJson) ───────────────────
export interface ReportFilter { field: string; op: "eq" | "contains"; value: string }
export interface ReportDefinition {
  source: string;
  columns: string[];
  filters?: ReportFilter[];
  from?: string | null; // YYYY-MM-DD or ISO; applies to the source dateField
  to?: string | null;
  groupBy?: string | null;
  sort?: { field: string; dir: "asc" | "desc" } | null;
  visualization?: "table" | "bar" | "line" | "pie" | "number";
  limit?: number;
}

export interface ReportRunResult {
  ok: true;
  source: string;
  visualization: string;
  // For a plain (ungrouped) run: the selected columns + matching rows.
  columns: ReportColumn[];
  rows: Array<Record<string, unknown>>;
  // For a grouped run: one row per group with a count (and metric sum if any).
  grouped: Array<{ group: string; count: number; sum: number | null }> | null;
  total: number;
}

// Minimal structural view of a Prisma delegate — confines the dynamic-query cast
// to one boundary instead of sprinkling `any` through the executor.
interface Delegate {
  findMany: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  groupBy: (args: unknown) => Promise<Array<Record<string, unknown>>>;
  count: (args: unknown) => Promise<number>;
}

function delegateFor(sourceKey: string): Delegate | null {
  switch (sourceKey) {
    case "service_requests": return prisma.serviceRequest as unknown as Delegate;
    case "deals": return prisma.deal as unknown as Delegate;
    case "contacts": return prisma.contact as unknown as Delegate;
    default: return null;
  }
}

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
function parseBoundary(v: string | null | undefined, endOfDay: boolean): Date | null {
  if (!v) return null;
  const iso = DATE_ONLY_RE.test(v) ? `${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : v;
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? null : d;
}

// Serialize a Prisma row value to a JSON-safe primitive (Date → ISO, Decimal →
// number) so the response is stable for the table/CSV/chart renderers.
function serializeValue(v: unknown): unknown {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && v !== null && "toNumber" in v && typeof (v as { toNumber: unknown }).toNumber === "function") {
    return (v as { toNumber: () => number }).toNumber(); // Prisma Decimal
  }
  return v;
}

// Validation result used by both run and save so a bad definition is rejected
// with a clear message before it ever hits the DB.
export function validateDefinition(def: ReportDefinition): { ok: true; source: ReportSource; columns: string[] } | { ok: false; error: string } {
  const source = getReportSource(def.source);
  if (!source) return { ok: false, error: `Unknown data source: ${def.source}` };
  const allowed = new Set(source.columns.map((c) => c.key));

  const columns = Array.isArray(def.columns) ? def.columns.filter((c) => allowed.has(c)) : [];
  if (columns.length === 0) return { ok: false, error: "Select at least one valid column" };

  for (const f of def.filters ?? []) {
    if (!allowed.has(f.field)) return { ok: false, error: `Unknown filter field: ${f.field}` };
    if (f.op !== "eq" && f.op !== "contains") return { ok: false, error: `Unknown filter operator: ${f.op}` };
  }
  if (def.groupBy && !allowed.has(def.groupBy)) return { ok: false, error: `Unknown group-by field: ${def.groupBy}` };
  if (def.sort && !allowed.has(def.sort.field)) return { ok: false, error: `Unknown sort field: ${def.sort.field}` };
  return { ok: true, source, columns };
}

// Execute a definition against tenant-scoped data. Caller MUST have already
// checked the user holds `source.permission` (per-source RBAC).
export async function runReportDefinition(tenantId: string, def: ReportDefinition): Promise<ReportRunResult | { ok: false; error: string }> {
  const valid = validateDefinition(def);
  if (!valid.ok) return valid;
  const { source, columns } = valid;
  // The selected columns as full {key,label,type} defs (for the result/renderers).
  const colDefs = source.columns.filter((c) => columns.includes(c.key));
  const delegate = delegateFor(source.key);
  if (!delegate) return { ok: false, error: `Unsupported source: ${source.key}` };

  // Build a tenant-scoped where clause from the allow-listed filters + date range.
  const where: Record<string, unknown> = { tenantId };
  for (const f of def.filters ?? []) {
    if (!f.value) continue;
    where[f.field] = f.op === "contains" ? { contains: f.value, mode: "insensitive" } : f.value;
  }
  const from = parseBoundary(def.from, false);
  const to = parseBoundary(def.to, true);
  if (from || to) {
    where[source.dateField] = { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) };
  }

  // Grouped run → one aggregated row per group value (count + optional metric sum).
  if (def.groupBy) {
    const sumKey = source.metric?.key;
    const rows = await delegate.groupBy({
      by: [def.groupBy],
      where,
      _count: { _all: true },
      ...(sumKey ? { _sum: { [sumKey]: true } } : {}),
    });
    const grouped = rows
      .map((r) => ({
        group: String(serializeValue(r[def.groupBy as string]) ?? "—"),
        count: Number((r._count as { _all: number } | undefined)?._all ?? 0),
        sum: sumKey ? Number(serializeValue((r._sum as Record<string, unknown> | undefined)?.[sumKey]) ?? 0) : null,
      }))
      .sort((a, b) => b.count - a.count);
    return {
      ok: true, source: source.key, visualization: def.visualization ?? "table",
      columns: colDefs, rows: [], grouped, total: grouped.length,
    };
  }

  // Plain run → selected columns, sorted, capped.
  const select: Record<string, true> = { id: true };
  for (const c of columns) select[c] = true;
  const orderBy = def.sort
    ? { [def.sort.field]: def.sort.dir === "asc" ? "asc" : "desc" }
    : { [source.dateField]: "desc" };
  const limit = Math.min(Math.max(1, def.limit ?? 200), 1000);

  const [raw, total] = await Promise.all([
    delegate.findMany({ where, select, orderBy, take: limit }),
    delegate.count({ where }),
  ]);
  const rows = raw.map((row) => {
    const out: Record<string, unknown> = {};
    for (const c of columns) out[c] = serializeValue(row[c]);
    out.id = row.id;
    return out;
  });
  return {
    ok: true, source: source.key, visualization: def.visualization ?? "table",
    columns: colDefs, rows, grouped: null, total,
  };
}
