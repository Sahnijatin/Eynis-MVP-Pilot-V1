// Attribution aggregator (#167) — turns the persisted ValueEvent rows into a
// defensible, auditable attributed-value summary: a per-vertical headline number,
// a breakdown by value type and by trigger, and a daily time series. Mirrors the
// shape of computeUpsellAnalytics.

import { prisma } from "../../db/prisma";
import { getValueModel, VALUE_TYPE_LABELS, unitFor, type ValueType } from "./value-model";

export interface AttributionByType {
  valueType: ValueType;
  label: string;
  unit: "INR" | "minutes";
  amount: number;
  count: number;
}

export interface AttributionAnalytics {
  ok: true;
  headline: { valueType: ValueType; label: string; unit: "INR" | "minutes"; amount: number; count: number };
  byType: AttributionByType[];
  byTrigger: Array<{ trigger: string; valueType: string; count: number; amount: number }>;
  timeSeries: Array<{ day: string; amount: number }>;
  totalEvents: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function computeAttributionAnalytics(
  tenantId: string,
  range?: { from: Date; to: Date },
): Promise<AttributionAnalytics> {
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { industry: true } });
  const vm = getValueModel(tenant?.industry ?? null);

  const where = range
    ? { tenantId, occurredAt: { gte: range.from, lte: range.to } }
    : { tenantId };
  const events = await prisma.valueEvent.findMany({
    where,
    select: { trigger: true, outcome: true, valueType: true, valueAmount: true, unit: true, occurredAt: true },
  });

  // By value type.
  const typeAgg = new Map<string, { amount: number; count: number }>();
  const triggerAgg = new Map<string, { valueType: string; amount: number; count: number }>();
  for (const e of events) {
    const t = typeAgg.get(e.valueType) ?? { amount: 0, count: 0 };
    t.amount += e.valueAmount; t.count += 1;
    typeAgg.set(e.valueType, t);

    const key = `${e.valueType}:${e.trigger}`;
    const tr = triggerAgg.get(key) ?? { valueType: e.valueType, amount: 0, count: 0 };
    tr.amount += e.valueAmount; tr.count += 1;
    triggerAgg.set(key, tr);
  }

  const byType: AttributionByType[] = Array.from(typeAgg.entries())
    .map(([valueType, v]) => ({
      valueType: valueType as ValueType,
      label: VALUE_TYPE_LABELS[valueType as ValueType] ?? valueType,
      unit: unitFor(valueType as ValueType),
      amount: v.amount,
      count: v.count,
    }))
    .sort((a, b) => b.count - a.count);

  const byTrigger = Array.from(triggerAgg.entries())
    .map(([key, v]) => ({ trigger: key.split(":").slice(1).join(":"), valueType: v.valueType, count: v.count, amount: v.amount }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 10);

  // Headline = the vertical's primary value type (0 if no events of that type yet).
  const headlineAgg = typeAgg.get(vm.headlineType) ?? { amount: 0, count: 0 };
  const headline = {
    valueType: vm.headlineType,
    label: vm.headlineLabel,
    unit: unitFor(vm.headlineType),
    amount: headlineAgg.amount,
    count: headlineAgg.count,
  };

  // 14-day daily series of the headline value type.
  const now = range?.to ?? new Date();
  const start = new Date(now.getTime() - 13 * DAY_MS); start.setHours(0, 0, 0, 0);
  const buckets = new Map<string, number>();
  for (let i = 0; i < 14; i++) {
    const d = new Date(start.getTime() + i * DAY_MS);
    buckets.set(d.toISOString().slice(0, 10), 0);
  }
  for (const e of events) {
    if (e.valueType !== vm.headlineType) continue;
    const day = e.occurredAt.toISOString().slice(0, 10);
    if (buckets.has(day)) buckets.set(day, (buckets.get(day) ?? 0) + e.valueAmount);
  }
  const timeSeries = Array.from(buckets.entries()).map(([day, amount]) => ({ day, amount }));

  return { ok: true, headline, byType, byTrigger, timeSeries, totalEvents: events.length };
}
