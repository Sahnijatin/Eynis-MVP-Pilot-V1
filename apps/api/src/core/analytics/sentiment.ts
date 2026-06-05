// Real sentiment analytics, computed from data the platform actually captures:
//   - SentimentEvent rows (customer utterances scored during voice campaigns)
//   - ConnectorEvent.aiSentiment (inbound message classification)
// Replaces the previous Math.random()/hard-coded version (F-17). When there is no
// data yet, every figure is a genuine zero/empty rather than a fabricated number.

import { prisma } from "../../db/prisma";

const WINDOW_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;

// Words ignored when extracting sentiment drivers from snippets.
const STOPWORDS = new Set([
  "the", "and", "for", "was", "were", "are", "you", "your", "our", "but", "not",
  "with", "this", "that", "they", "have", "had", "has", "very", "really", "just",
  "from", "there", "their", "what", "when", "will", "would", "could", "about",
  "i", "a", "an", "is", "it", "to", "of", "in", "on", "at", "we", "me", "my", "so", "as", "be",
]);

export interface SentimentDriver { term: string; weight: number; sentiment: "positive" | "negative" }
export interface SentimentAnalytics {
  ok: true;
  netScore: number;
  totalFeedback: number;
  surveyCompletionRate: number | null;
  breakdown: { positive: number; neutral: number; negative: number };
  bySource: Array<{ source: string; count: number }>;
  drivers: SentimentDriver[];
  timeSeries: Array<{ day: number; score: number | null }>;
  alert: { type: string; message: string } | null;
}

function topTerms(snippets: string[], sentiment: "positive" | "negative", limit = 3): SentimentDriver[] {
  const freq = new Map<string, number>();
  for (const text of snippets) {
    for (const raw of text.toLowerCase().split(/[^a-z]+/)) {
      if (raw.length < 3 || STOPWORDS.has(raw)) continue;
      freq.set(raw, (freq.get(raw) ?? 0) + 1);
    }
  }
  const max = Math.max(1, ...freq.values());
  return [...freq.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([term, n]) => ({ term, weight: Math.round((n / max) * 100) / 100, sentiment }));
}

export async function computeSentimentAnalytics(tenantId: string, now = new Date()): Promise<SentimentAnalytics> {
  const since = new Date(now.getTime() - WINDOW_DAYS * DAY_MS);

  const [events, inbound] = await Promise.all([
    prisma.sentimentEvent.findMany({
      where: { tenantId, speaker: "customer", createdAt: { gte: since } },
      select: { sentiment: true, score: true, createdAt: true, text: true },
    }),
    prisma.connectorEvent.groupBy({
      by: ["aiSentiment"],
      where: { tenantId, aiSentiment: { not: null }, createdAt: { gte: since } },
      _count: { aiSentiment: true },
    }),
  ]);

  const inboundCount = (s: string) => inbound.find((r) => r.aiSentiment === s)?._count.aiSentiment ?? 0;
  const positive = events.filter((e) => e.sentiment === "positive").length + inboundCount("positive");
  const neutral = events.filter((e) => e.sentiment === "neutral").length + inboundCount("neutral");
  const negative = events.filter((e) => e.sentiment === "negative").length + inboundCount("negative");
  const total = positive + neutral + negative;

  // Net score: (%positive − %negative) on a −100..100 scale, mapped to 0..100.
  const netScore = total > 0 ? Math.round((((positive - negative) / total) * 50) + 50) : 0;

  const inboundTotal = inbound.reduce((s, r) => s + r._count.aiSentiment, 0);
  const bySource = [
    { source: "Voice calls", count: events.length },
    { source: "Inbound messages", count: inboundTotal },
  ];

  // 30-day daily average score (falls back to a sentiment-derived score when a
  // numeric score wasn't recorded). Days with no data report null, not a guess.
  const byDay = new Map<number, { sum: number; n: number }>();
  for (const e of events) {
    const day = Math.floor((e.createdAt.getTime() - since.getTime()) / DAY_MS) + 1;
    const s = e.score ?? (e.sentiment === "positive" ? 80 : e.sentiment === "negative" ? 30 : 55);
    const cur = byDay.get(day) ?? { sum: 0, n: 0 };
    cur.sum += s; cur.n += 1;
    byDay.set(day, cur);
  }
  const timeSeries = Array.from({ length: WINDOW_DAYS }, (_, i) => {
    const d = byDay.get(i + 1);
    return { day: i + 1, score: d ? Math.round(d.sum / d.n) : null };
  });

  const drivers = [
    ...topTerms(events.filter((e) => e.sentiment === "positive").map((e) => e.text), "positive"),
    ...topTerms(events.filter((e) => e.sentiment === "negative").map((e) => e.text), "negative"),
  ];

  return {
    ok: true,
    netScore,
    totalFeedback: total,
    surveyCompletionRate: null, // no survey channel is wired yet — don't fabricate one
    breakdown: { positive, neutral, negative },
    bySource,
    drivers,
    timeSeries,
    alert: negative > positive ? { type: "warning", message: "Negative sentiment is outpacing positive" } : null,
  };
}
