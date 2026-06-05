// CRM pipeline helpers (Increment A).
//
// Pure-ish helpers behind the /pipelines + /deals endpoints: the standard stage
// set, an idempotent "ensure a tenant has a default pipeline" routine, and
// serializers. New tables use a real `tenantId` column (no legacy @@map).

import { prisma } from "../../db/prisma";

// Default deal currency. Confirmed for the pilot: INR. Stored per-deal so a
// tenant can override later; this is only the starting default.
export const DEFAULT_CURRENCY = "INR";

export interface StageSeed {
  name: string;
  order: number;
  probability: number; // 0–100
  isWon?: boolean;
  isLost?: boolean;
}

// Standard stage names (Option A). Tenants rename / reorder / re-probability
// these later — they are only sensible defaults so the board works out of the box.
export const DEFAULT_STAGES: StageSeed[] = [
  { name: "Lead In", order: 0, probability: 10 },
  { name: "Qualified", order: 1, probability: 30 },
  { name: "Proposal", order: 2, probability: 60 },
  { name: "Negotiation", order: 3, probability: 80 },
  { name: "Won", order: 4, probability: 100, isWon: true },
  { name: "Lost", order: 5, probability: 0, isLost: true },
];

type PipelineWithStages = Awaited<ReturnType<typeof findDefaultPipeline>>;

async function findDefaultPipeline(tenantId: string) {
  return prisma.pipeline.findFirst({
    where: { tenantId, archived: false },
    orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
    include: { stages: { orderBy: { order: "asc" } } },
  });
}

// Idempotent: returns the tenant's default pipeline, creating the standard one
// (with INR-friendly defaults) on first use. Safe to call on every request.
export async function ensureDefaultPipeline(tenantId: string) {
  const existing = await findDefaultPipeline(tenantId);
  if (existing) return existing;
  await prisma.pipeline.create({
    data: {
      tenantId,
      name: "Sales Pipeline",
      isDefault: true,
      stages: {
        create: DEFAULT_STAGES.map((s) => ({
          tenantId,
          name: s.name,
          order: s.order,
          probability: s.probability,
          isWon: s.isWon ?? false,
          isLost: s.isLost ?? false,
        })),
      },
    },
  });
  // Re-read so a concurrent caller that lost the create race still gets one row.
  return (await findDefaultPipeline(tenantId)) as NonNullable<PipelineWithStages>;
}

type StageRow = {
  id: string;
  name: string;
  order: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
};

export function serializeStage(s: StageRow) {
  return {
    id: s.id,
    name: s.name,
    order: s.order,
    probability: s.probability,
    isWon: s.isWon,
    isLost: s.isLost,
  };
}

export function serializePipeline(p: {
  id: string;
  name: string;
  isDefault: boolean;
  stages: StageRow[];
}) {
  return {
    id: p.id,
    name: p.name,
    isDefault: p.isDefault,
    stages: p.stages.map(serializeStage),
  };
}
