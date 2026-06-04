// Campaign A/B analytics (Phase 9).
//
// Pure stats: per-variant funnel rates, average sentiment, and a two-proportion
// z-test to decide the leading variant — gated by a minimum answered-per-arm
// sample so we never declare a winner on noise. The route feeds in raw counts
// (from Prisma aggregates); everything here is deterministic + unit-tested.

export const WINNER_MIN_ANSWERED = 50; // per arm, before a winner may be declared

export interface VariantRaw {
  dials: number;
  answered: number;
  interested: number;
  meetingsBooked: number;
  avgDurationSeconds: number | null;
  sentimentScoreSum: number; // sum of mapped sentiment scores over rated calls
  sentimentRatedCount: number;
}

export interface VariantStats extends VariantRaw {
  answerRate: number;
  interestRate: number;   // interested / answered
  bookingRate: number;    // meetingsBooked / interested
  avgSentiment: number;   // [-1, 1]
}

const rate = (num: number, den: number): number => (den > 0 ? Number((num / den).toFixed(4)) : 0);

export function summarizeVariant(raw: VariantRaw): VariantStats {
  return {
    ...raw,
    answerRate: rate(raw.answered, raw.dials),
    interestRate: rate(raw.interested, raw.answered),
    bookingRate: rate(raw.meetingsBooked, raw.interested),
    avgSentiment: raw.sentimentRatedCount > 0 ? Number((raw.sentimentScoreSum / raw.sentimentRatedCount).toFixed(3)) : 0,
  };
}

// Two-proportion z-test on interested/answered between two arms. Returns the
// z-score and an approximate two-tailed p-value via the standard-normal CDF.
export function twoProportionZ(xA: number, nA: number, xB: number, nB: number): { z: number; pValue: number } {
  if (nA === 0 || nB === 0) return { z: 0, pValue: 1 };
  const pA = xA / nA, pB = xB / nB;
  const pPool = (xA + xB) / (nA + nB);
  const se = Math.sqrt(pPool * (1 - pPool) * (1 / nA + 1 / nB));
  if (se === 0) return { z: 0, pValue: 1 };
  const z = (pA - pB) / se;
  const pValue = Number((2 * (1 - normalCdf(Math.abs(z)))).toFixed(4));
  return { z: Number(z.toFixed(3)), pValue };
}

// Abramowitz & Stegun 7.1.26 approximation of the standard-normal CDF.
function normalCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * x);
  const d = 0.3989423 * Math.exp(-x * x / 2);
  const p = d * t * (0.3193815 + t * (-0.3565638 + t * (1.781478 + t * (-1.821256 + t * 1.330274))));
  return 1 - p;
}

export interface LeaderDecision {
  leadingVariant: "A" | "B" | null;
  sufficientSample: boolean;
  confident: boolean; // p < 0.05 AND sufficient sample
  pValue: number;
  sampleNote: string;
}

export function decideLeader(a: VariantStats, b: VariantStats, minAnswered = WINNER_MIN_ANSWERED): LeaderDecision {
  const sufficientSample = a.answered >= minAnswered && b.answered >= minAnswered;
  const { pValue } = twoProportionZ(a.interested, a.answered, b.interested, b.answered);
  const leadingVariant = a.interestRate === b.interestRate ? null : a.interestRate > b.interestRate ? "A" : "B";
  const confident = sufficientSample && pValue < 0.05 && leadingVariant !== null;
  const need = minAnswered;
  const sampleNote = sufficientSample
    ? `${a.answered} vs ${b.answered} answered (threshold ${need}/arm)`
    : `insufficient sample — need ${need} answered per arm (have ${a.answered} / ${b.answered})`;
  return { leadingVariant, sufficientSample, confident, pValue, sampleNote };
}

// Maps a sentiment label to a numeric score for averaging.
export function sentimentScore(label: string | null): number {
  return label === "positive" ? 1 : label === "negative" ? -1 : 0;
}
