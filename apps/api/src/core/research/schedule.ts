// Scheduled / recurring re-research (RS-4). Drains due ResearchSchedule rows on a
// slow interval and enqueues a fresh ResearchRun for each — the clock-driven twin
// of POST /research/runs/:id/rerun. Each due row is claimed atomically (nextRunAt
// advanced before the enqueue) so an overrun cycle or a second instance can never
// double-run a schedule. Tenant-scoped throughout.

import { prisma } from "../../db/prisma";
import { singleFlight } from "../single-flight";

export type Cadence = "daily" | "weekly" | "monthly";
const CADENCES: readonly Cadence[] = ["daily", "weekly", "monthly"];
export const isCadence = (v: unknown): v is Cadence => typeof v === "string" && (CADENCES as readonly string[]).includes(v);

// Next fire time from a base instant. Monthly steps the calendar month (clamping
// short months via setMonth's natural overflow handling on a copied date).
export function advanceCadence(from: Date, cadence: Cadence): Date {
  const d = new Date(from.getTime());
  if (cadence === "daily") d.setUTCDate(d.getUTCDate() + 1);
  else if (cadence === "monthly") d.setUTCMonth(d.getUTCMonth() + 1);
  else d.setUTCDate(d.getUTCDate() + 7); // weekly (default)
  return d;
}

const BATCH = Number(process.env.RESEARCH_SCHEDULE_BATCH ?? 10);

export const runResearchScheduleCycle = singleFlight(async (): Promise<void> => {
  try {
    const now = new Date();
    const due = await prisma.researchSchedule.findMany({
      where: { isActive: true, nextRunAt: { lte: now } },
      orderBy: { nextRunAt: "asc" },
      take: BATCH,
    });
    if (due.length === 0) return;
    for (const s of due) {
      const cadence: Cadence = isCadence(s.cadence) ? s.cadence : "weekly";
      // Claim the row by advancing nextRunAt — only the cycle that wins this
      // conditional update proceeds to enqueue (no double-runs).
      const claim = await prisma.researchSchedule.updateMany({
        where: { id: s.id, isActive: true, nextRunAt: { lte: now } },
        data: { nextRunAt: advanceCadence(now, cadence), lastRunAt: now },
      });
      if (claim.count !== 1) continue;
      try {
        const run = await prisma.researchRun.create({
          data: {
            tenantId: s.tenantId,
            templateId: s.templateId,
            templateName: s.templateName,
            templateSnapshot: s.templateSnapshot,
            subjectType: s.subjectType,
            subjectId: s.subjectId,
            subjectLabel: s.subjectLabel,
            inputsJson: s.inputsJson,
            status: "queued",
            createdById: s.createdById,
          },
          select: { id: true },
        });
        await prisma.researchSchedule.update({ where: { id: s.id }, data: { lastRunId: run.id } }).catch(() => undefined);
      } catch (err) {
        console.error("[ResearchSchedule] enqueue failed for", s.id, err);
      }
    }
  } catch (err) {
    console.error("[ResearchSchedule] cycle error:", err);
  }
});

export function startResearchScheduleWorker(
  intervalMs = Number(process.env.RESEARCH_SCHEDULE_INTERVAL_MS ?? 60_000),
): () => void {
  void runResearchScheduleCycle();
  const id = setInterval(() => void runResearchScheduleCycle(), intervalMs);
  return () => clearInterval(id);
}
