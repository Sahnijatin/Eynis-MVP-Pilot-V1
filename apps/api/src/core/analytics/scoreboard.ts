// Experiment scoreboard (#163) — the internal, cross-tenant per-vertical comparison
// that turns "lock 1 primary + shadow 1" into a data call. Groups every tenant by
// industry and reports the five lock-decision metrics. This is platform-staff data
// (aggregates ACROSS tenants), so it is served from the /internal/ block behind
// requirePlatformAdmin — never the tenant-authorized analytics router.
//
// Each metric uses the best available proxy in the current schema; the proxy is
// documented per field so the number is defensible, not magic.

import { prisma } from "../../db/prisma";
import { getValueModel, unitFor } from "../attribution/value-model";
import { INDUSTRY_LABELS, VALID_INDUSTRIES } from "../industries";

export interface VerticalScore {
  industry: string;
  label: string;
  tenants: number;
  /** Tenants that have produced at least one real inbound signal. */
  liveTenants: number;
  /** Avg days from tenant creation to first live signal (live tenants only). */
  activationAvgDays: number | null;
  /** Distinct operators who took an action in the last 7 days, across the vertical. */
  weeklyActiveOperators: number;
  /** The vertical's headline attributed value (revenue INR / downtime or time minutes). */
  attributedValue: { valueType: string; unit: string; amount: number; label: string };
  /** Tenants on a paid plan (growth/enterprise). */
  paidTenants: number;
  /** paidTenants / tenants, as a percentage. */
  wtpConversionPct: number;
  wonDeals: number;
  /** Avg days from deal creation to close, for won deals (null if none). */
  salesCycleAvgDays: number | null;
}

export interface Scoreboard {
  ok: true;
  generatedAt: string;
  verticals: VerticalScore[];
}

const DAY_MS = 24 * 60 * 60 * 1000;
const PAID_PLANS = new Set(["growth", "enterprise"]);

export async function computeScoreboard(now: Date = new Date()): Promise<Scoreboard> {
  const sevenDaysAgo = new Date(now.getTime() - 7 * DAY_MS);

  // 1. All tenants with plan.
  const tenants = await prisma.tenant.findMany({
    select: { id: true, industry: true, createdAt: true, license: { select: { plan: true } } },
  });

  // 2. First live signal per tenant (ConnectorEvent, fallback ServiceRequest).
  const [connFirst, srFirst] = await Promise.all([
    prisma.connectorEvent.groupBy({ by: ["tenantId"], _min: { createdAt: true } }),
    prisma.serviceRequest.groupBy({ by: ["tenantId"], _min: { createdAt: true } }),
  ]);
  const firstSignal = new Map<string, Date>();
  for (const r of srFirst) if (r._min.createdAt) firstSignal.set(r.tenantId, r._min.createdAt);
  for (const r of connFirst) {
    if (!r._min.createdAt) continue;
    const cur = firstSignal.get(r.tenantId);
    if (!cur || r._min.createdAt < cur) firstSignal.set(r.tenantId, r._min.createdAt);
  }

  // 3. Attributed value per tenant, summed by valueType.
  const valueRows = await prisma.valueEvent.groupBy({ by: ["tenantId", "valueType"], _sum: { valueAmount: true } });
  const valueByTenant = new Map<string, Map<string, number>>();
  for (const r of valueRows) {
    const m = valueByTenant.get(r.tenantId) ?? new Map<string, number>();
    m.set(r.valueType, (m.get(r.valueType) ?? 0) + (r._sum.valueAmount ?? 0));
    valueByTenant.set(r.tenantId, m);
  }

  // 4. Weekly active operators — distinct actors on request/deal transitions in 7d.
  // groupBy returns the distinct (tenant, actor) pairs directly, so we never load
  // the individual transition rows. A user active in two tenants counts once per
  // tenant, which is what a per-vertical operator count wants.
  const [srOps, dealOps] = await Promise.all([
    prisma.serviceRequestTransition.groupBy({
      by: ["tenantId", "changedByUserId"], where: { createdAt: { gte: sevenDaysAgo } },
    }),
    prisma.dealTransition.groupBy({
      by: ["tenantId", "changedById"], where: { createdAt: { gte: sevenDaysAgo }, changedById: { not: null } },
    }),
  ]);
  const operatorsByTenant = new Map<string, Set<string>>();
  const addOperator = (tenantId: string, userId: string | null) => {
    if (!userId) return;
    const s = operatorsByTenant.get(tenantId) ?? new Set<string>();
    s.add(userId);
    operatorsByTenant.set(tenantId, s);
  };
  for (const r of srOps) addOperator(r.tenantId, r.changedByUserId);
  for (const r of dealOps) addOperator(r.tenantId, r.changedById);

  // 5. Won deals with cycle time.
  const wonDeals = await prisma.deal.findMany({
    where: { status: "won", closedAt: { not: null } },
    select: { tenantId: true, createdAt: true, closedAt: true },
  });
  const dealCycleByTenant = new Map<string, number[]>();
  for (const d of wonDeals) {
    if (!d.closedAt) continue;
    const days = Math.max(0, (d.closedAt.getTime() - d.createdAt.getTime()) / DAY_MS);
    const arr = dealCycleByTenant.get(d.tenantId) ?? [];
    arr.push(days);
    dealCycleByTenant.set(d.tenantId, arr);
  }

  // ── Roll up per vertical ──────────────────────────────────────────────────
  const byIndustry = new Map<string, typeof tenants>();
  for (const t of tenants) {
    const arr = byIndustry.get(t.industry) ?? [];
    arr.push(t);
    byIndustry.set(t.industry, arr);
  }

  const verticals: VerticalScore[] = [];
  // Report every known vertical (even 0-tenant ones) so the board is comparable.
  const industries = Array.from(new Set<string>([...VALID_INDUSTRIES, ...byIndustry.keys()]));
  for (const industry of industries) {
    const group = byIndustry.get(industry) ?? [];
    const vm = getValueModel(industry);

    const activationDays: number[] = [];
    let liveTenants = 0;
    let paidTenants = 0;
    let weeklyActiveOperators = 0;
    const cycleDays: number[] = [];
    let headlineAmount = 0;

    for (const t of group) {
      const first = firstSignal.get(t.id);
      if (first) {
        liveTenants++;
        activationDays.push(Math.max(0, (first.getTime() - t.createdAt.getTime()) / DAY_MS));
      }
      if (t.license && PAID_PLANS.has(t.license.plan)) paidTenants++;
      weeklyActiveOperators += operatorsByTenant.get(t.id)?.size ?? 0;
      const cyc = dealCycleByTenant.get(t.id);
      if (cyc) cycleDays.push(...cyc);
      headlineAmount += valueByTenant.get(t.id)?.get(vm.headlineType) ?? 0;
    }

    const avg = (xs: number[]): number | null => (xs.length ? Math.round((xs.reduce((s, x) => s + x, 0) / xs.length) * 10) / 10 : null);

    verticals.push({
      industry,
      label: INDUSTRY_LABELS[industry as keyof typeof INDUSTRY_LABELS] ?? industry,
      tenants: group.length,
      liveTenants,
      activationAvgDays: avg(activationDays),
      weeklyActiveOperators,
      attributedValue: {
        valueType: vm.headlineType,
        unit: unitFor(vm.headlineType),
        amount: headlineAmount,
        label: vm.headlineLabel,
      },
      paidTenants,
      wtpConversionPct: group.length ? Math.round((paidTenants / group.length) * 1000) / 10 : 0,
      wonDeals: cycleDays.length,
      salesCycleAvgDays: avg(cycleDays),
    });
  }

  // Most-tenants first, then alphabetical for a stable comparison order.
  verticals.sort((a, b) => b.tenants - a.tenants || a.label.localeCompare(b.label));

  return { ok: true, generatedAt: now.toISOString(), verticals };
}
