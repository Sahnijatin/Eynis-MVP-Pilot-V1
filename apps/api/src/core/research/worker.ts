// Research worker (RS-1). Drains queued ResearchRun rows on a short interval,
// mirroring the automation engine's pattern (singleFlight cycle so an overrun can't
// overlap the next tick). Each run is claimed atomically (queued → gathering) so an
// overlapping cycle or a second instance can never double-process it.

import { prisma } from "../../db/prisma";
import { singleFlight } from "../single-flight";
import { processRun } from "./engine";

const BATCH = Number(process.env.RESEARCH_WORKER_BATCH ?? 3);

export const runResearchCycle = singleFlight(async (): Promise<void> => {
  try {
    const queued = await prisma.researchRun.findMany({
      where: { status: "queued" },
      orderBy: { createdAt: "asc" },
      take: BATCH,
      select: { id: true },
    });
    if (queued.length === 0) return;
    await Promise.allSettled(
      queued.map(async ({ id }) => {
        const claim = await prisma.researchRun.updateMany({
          where: { id, status: "queued" },
          data: { status: "gathering", progress: 10, startedAt: new Date() },
        });
        if (claim.count !== 1) return; // someone else claimed it
        await processRun(id);
      }),
    );
  } catch (err) {
    console.error("[ResearchWorker] cycle error:", err);
  }
});

export function startResearchWorker(
  intervalMs = Number(process.env.RESEARCH_WORKER_INTERVAL_MS ?? 5_000),
): () => void {
  void runResearchCycle();
  const id = setInterval(() => void runResearchCycle(), intervalMs);
  return () => clearInterval(id);
}
