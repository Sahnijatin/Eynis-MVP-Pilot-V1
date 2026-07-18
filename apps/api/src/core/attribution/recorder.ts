// Attribution recorder (#167) — writes ValueEvents when a triggered outcome
// happens (a resolved request, an accepted offer). Idempotent per source outcome
// via the unique (tenantId, sourceType, sourceId, outcome) index, so re-running the
// backfill or a duplicate resolution never double-counts.

import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { getValueModel, unitFor } from "./value-model";

interface ValueEventInput {
  tenantId: string;
  sourceType: string;
  sourceId: string;
  trigger: string;
  outcome: string;
  valueType: string;
  valueAmount: number;
  unit: string;
  occurredAt: Date;
  segment?: string | null;
}

// Returns true if a new row was written, false if it already existed (P2002).
async function insertValueEvent(data: ValueEventInput): Promise<boolean> {
  try {
    await prisma.valueEvent.create({ data: { ...data, contextJson: "{}" } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

/** Record the value of a service request being resolved (forward path). */
export async function recordServiceRequestResolution(input: {
  tenantId: string; industry: string | null; serviceRequestId: string; category: string; occurredAt?: Date;
}): Promise<void> {
  const vm = getValueModel(input.industry);
  await insertValueEvent({
    tenantId: input.tenantId, sourceType: "service_request", sourceId: input.serviceRequestId,
    trigger: input.category, outcome: "resolved",
    valueType: vm.srValueType, valueAmount: vm.minutesPerResolved, unit: unitFor(vm.srValueType),
    occurredAt: input.occurredAt ?? new Date(),
  });
}

// NB: offer *acceptance* has no live endpoint yet (accepted offers exist only in
// seed/tests), so its revenue is attributed via backfillValueEvents below rather
// than a forward recorder. When an accept-offer endpoint is added, record the
// revenue value event there (sourceType "offer", outcome "accepted").

const BACKFILL_CAP = 1000;

/**
 * Backfill value events for a tenant's already-resolved requests and already-accepted
 * offers (data that predates the live recorder). Idempotent and bounded. Returns the
 * number of new events written.
 */
export async function backfillValueEvents(tenantId: string, industry: string | null): Promise<number> {
  let created = 0;
  const vm = getValueModel(industry);

  const resolved = await prisma.serviceRequest.findMany({
    where: { tenantId, status: "resolved" },
    select: { id: true, category: true, resolvedAt: true, createdAt: true },
    orderBy: { resolvedAt: "desc" }, take: BACKFILL_CAP,
  });
  for (const sr of resolved) {
    if (await insertValueEvent({
      tenantId, sourceType: "service_request", sourceId: sr.id, trigger: sr.category, outcome: "resolved",
      valueType: vm.srValueType, valueAmount: vm.minutesPerResolved, unit: unitFor(vm.srValueType),
      occurredAt: sr.resolvedAt ?? sr.createdAt,
    })) created++;
  }

  const accepted = await prisma.offerEvent.findMany({
    where: { tenantId, status: { in: ["accepted", "converted"] } },
    select: { id: true, offerType: true, revenueInr: true, createdAt: true },
    orderBy: { createdAt: "desc" }, take: BACKFILL_CAP,
  });
  for (const o of accepted) {
    if (await insertValueEvent({
      tenantId, sourceType: "offer", sourceId: o.id, trigger: o.offerType, outcome: "accepted",
      valueType: "revenue", valueAmount: Math.max(0, o.revenueInr), unit: "INR",
      occurredAt: o.createdAt,
    })) created++;
  }

  return created;
}

/** Boot-time backfill across every tenant (bounded per tenant, best-effort). */
export async function backfillAllTenantsValueEvents(): Promise<void> {
  const tenants = await prisma.tenant.findMany({ select: { id: true, industry: true } });
  for (const t of tenants) {
    try {
      await backfillValueEvents(t.id, t.industry);
    } catch (e) {
      console.warn(`[attribution] backfill failed for tenant ${t.id}:`, e instanceof Error ? e.message : e);
    }
  }
}
