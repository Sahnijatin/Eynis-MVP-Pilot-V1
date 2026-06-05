// CRM forecasting (Increment A).
//
// The revenue math behind GET /deals/forecast. `summarizeForecast` is a pure
// function (no DB) so the weighting/period logic is unit-testable; `computeForecast`
// is the thin tenant-scoped DB wrapper used by the route.

import { prisma } from "../../db/prisma";
import { DEFAULT_CURRENCY } from "./pipeline";

export interface ForecastDeal {
  value: number | null;
  expectedCloseAt: Date | null;
  stage: { id: string; name: string; order: number; probability: number } | null;
}

export interface StageForecast {
  stageId: string;
  stageName: string;
  order: number;
  count: number;
  value: number;
  weighted: number;
}

export interface ForecastSummary {
  currency: string;
  openCount: number;
  openValue: number; // total ₹ value of open deals
  weightedForecast: number; // Σ value × stage.probability
  byStage: StageForecast[];
  byPeriod: { thisMonth: number; thisQuarter: number }; // weighted, by expected close date
  wonCount: number;
  lostCount: number;
  winRate: number; // won / (won + lost), 0..1
}

function endOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}

function endOfQuarter(now: Date): Date {
  const q = Math.floor(now.getMonth() / 3);
  return new Date(now.getFullYear(), q * 3 + 3, 0, 23, 59, 59, 999);
}

// Pure summarizer — given the open deals and won/lost counts, compute totals.
export function summarizeForecast(
  openDeals: ForecastDeal[],
  wonCount: number,
  lostCount: number,
  now: Date = new Date(),
  currency: string = DEFAULT_CURRENCY,
): ForecastSummary {
  const monthEnd = endOfMonth(now);
  const quarterEnd = endOfQuarter(now);

  let openValue = 0;
  let weightedForecast = 0;
  let thisMonth = 0;
  let thisQuarter = 0;
  const byStage = new Map<string, StageForecast>();

  for (const d of openDeals) {
    const v = d.value ?? 0;
    const prob = (d.stage?.probability ?? 0) / 100;
    const weighted = v * prob;
    openValue += v;
    weightedForecast += weighted;

    const stageId = d.stage?.id ?? "unstaged";
    const agg =
      byStage.get(stageId) ??
      {
        stageId,
        stageName: d.stage?.name ?? "Unstaged",
        order: d.stage?.order ?? 999,
        count: 0,
        value: 0,
        weighted: 0,
      };
    agg.count += 1;
    agg.value += v;
    agg.weighted += weighted;
    byStage.set(stageId, agg);

    if (d.expectedCloseAt) {
      if (d.expectedCloseAt <= monthEnd) thisMonth += weighted;
      if (d.expectedCloseAt <= quarterEnd) thisQuarter += weighted;
    }
  }

  const closed = wonCount + lostCount;
  const round = (n: number) => Math.round(n * 100) / 100;

  return {
    currency,
    openCount: openDeals.length,
    openValue: round(openValue),
    weightedForecast: round(weightedForecast),
    byStage: [...byStage.values()]
      .sort((a, b) => a.order - b.order)
      .map((s) => ({ ...s, value: round(s.value), weighted: round(s.weighted) })),
    byPeriod: { thisMonth: round(thisMonth), thisQuarter: round(thisQuarter) },
    wonCount,
    lostCount,
    winRate: closed > 0 ? round(wonCount / closed) : 0,
  };
}

// Tenant-scoped DB wrapper. Optionally filtered to one pipeline.
export async function computeForecast(
  tenantId: string,
  opts: { pipelineId?: string } = {},
): Promise<ForecastSummary> {
  const scope = opts.pipelineId ? { pipelineId: opts.pipelineId } : {};
  const [openDeals, wonCount, lostCount] = await Promise.all([
    prisma.deal.findMany({
      where: { tenantId, status: "open", ...scope },
      select: {
        value: true,
        expectedCloseAt: true,
        stage: { select: { id: true, name: true, order: true, probability: true } },
      },
    }),
    prisma.deal.count({ where: { tenantId, status: "won", ...scope } }),
    prisma.deal.count({ where: { tenantId, status: "lost", ...scope } }),
  ]);

  // Pick a display currency from the open deals if present, else the default.
  const currency = DEFAULT_CURRENCY;

  return summarizeForecast(
    openDeals.map((d) => ({
      value: d.value === null ? null : Number(d.value),
      expectedCloseAt: d.expectedCloseAt,
      stage: d.stage,
    })),
    wonCount,
    lostCount,
    new Date(),
    currency,
  );
}
