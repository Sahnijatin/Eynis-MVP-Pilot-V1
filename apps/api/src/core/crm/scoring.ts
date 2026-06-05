// CRM AI lead scoring (Increment C).
//
// scoreContact() rates a contact 0–100 on fit + intent. It uses the AI layer when
// a provider key is configured, and ALWAYS has a deterministic heuristic fallback
// (so dev/test — and any AI failure — still produces a sensible, explainable score).

import { prisma } from "../../db/prisma";
import { CLAUDE_AVAILABLE, OPENAI_AVAILABLE, aiComplete, extractJson, type AIProvider } from "../ai/intelligence";
import { buildContactTimeline, recentConversationText } from "./timeline";

export interface ContactScore {
  score: number; // 0–100
  tier: "hot" | "warm" | "cool" | "cold";
  reasons: string[];
  source: "ai" | "heuristic";
}

const LIFECYCLE_BASE: Record<string, number> = {
  subscriber: 15, lead: 30, mql: 45, sql: 60, opportunity: 75, customer: 90,
};

function tierFor(score: number): ContactScore["tier"] {
  return score >= 80 ? "hot" : score >= 55 ? "warm" : score >= 30 ? "cool" : "cold";
}

export interface ScoreSignals {
  lifecycleStage: string;
  leadStatus: string | null;
  openDealValue: number;
  dealCount: number;
  positiveSignals: number;
  negativeSignals: number;
  recencyDays: number | null;
}

// Pure, deterministic — the always-available fallback and the test target.
export function heuristicScore(s: ScoreSignals): ContactScore {
  let score = LIFECYCLE_BASE[s.lifecycleStage] ?? 30;
  const reasons: string[] = [`lifecycle stage: ${s.lifecycleStage}`];
  if (s.openDealValue > 0) { score += 8; reasons.push(`₹${Math.round(s.openDealValue).toLocaleString("en-IN")} in open deals`); }
  if (s.dealCount > 1) { score += 4; reasons.push(`${s.dealCount} deals on record`); }
  if (s.leadStatus === "qualified") { score += 6; reasons.push("marked qualified"); }
  if (s.leadStatus === "disqualified") { score -= 25; reasons.push("marked disqualified"); }
  if (s.positiveSignals > 0) { score += Math.min(12, s.positiveSignals * 4); reasons.push(`${s.positiveSignals} positive interaction(s)`); }
  if (s.negativeSignals > 0) { score -= Math.min(18, s.negativeSignals * 6); reasons.push(`${s.negativeSignals} negative interaction(s)`); }
  if (s.recencyDays != null) {
    if (s.recencyDays <= 3) { score += 6; reasons.push("active in the last 3 days"); }
    else if (s.recencyDays > 30) { score -= 8; reasons.push("no activity in 30+ days"); }
  }
  score = Math.max(0, Math.min(100, Math.round(score)));
  return { score, tier: tierFor(score), reasons, source: "heuristic" };
}

async function gatherSignals(tenantId: string, contactId: string, contact: { lifecycleStage: string; leadStatus: string | null }): Promise<ScoreSignals> {
  const [openDeals, dealCount, timeline] = await Promise.all([
    prisma.deal.findMany({ where: { tenantId, contactId, status: "open" }, select: { value: true } }),
    prisma.deal.count({ where: { tenantId, contactId } }),
    buildContactTimeline(tenantId, contactId),
  ]);
  const openDealValue = openDeals.reduce((sum, d) => sum + (d.value ? Number(d.value) : 0), 0);
  const positiveSignals = timeline.filter((i) => i.sentiment === "positive").length;
  const negativeSignals = timeline.filter((i) => i.sentiment === "negative").length;
  const recencyDays = timeline.length ? Math.floor((Date.now() - new Date(timeline[0].at).getTime()) / 86_400_000) : null;
  return { lifecycleStage: contact.lifecycleStage, leadStatus: contact.leadStatus, openDealValue, dealCount, positiveSignals, negativeSignals, recencyDays };
}

// Scores a contact, persists the score on the record, and logs an `ai_score`
// activity on its timeline. Returns null if the contact doesn't exist.
export async function scoreContact(tenantId: string, contactId: string, provider: AIProvider = "claude"): Promise<ContactScore | null> {
  const contact = await prisma.contact.findFirst({ where: { id: contactId, tenantId } });
  if (!contact) return null;

  const signals = await gatherSignals(tenantId, contactId, contact);
  let result = heuristicScore(signals);

  if (CLAUDE_AVAILABLE || OPENAI_AVAILABLE) {
    try {
      const convo = await recentConversationText(tenantId, contactId);
      const prompt = `Score this sales/relationship contact's likelihood to convert/expand, 0-100, on fit + intent.\n` +
        `Lifecycle: ${signals.lifecycleStage}; lead status: ${signals.leadStatus ?? "n/a"}; ` +
        `open deal value: ${signals.openDealValue}; deals: ${signals.dealCount}; ` +
        `positive signals: ${signals.positiveSignals}; negative: ${signals.negativeSignals}; recency(days): ${signals.recencyDays ?? "n/a"}.\n` +
        `Recent conversation (newest first):\n${convo || "(none)"}\n\n` +
        `Respond ONLY with JSON: {"score": <0-100 integer>, "reasons": ["short reason", ...]}`;
      const raw = await aiComplete(prompt, provider);
      const parsed = extractJson(raw) as { score?: unknown; reasons?: unknown } | null;
      const score = parsed && typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : null;
      if (score !== null) {
        const reasons = Array.isArray(parsed?.reasons) ? (parsed!.reasons as unknown[]).filter((r): r is string => typeof r === "string").slice(0, 6) : result.reasons;
        result = { score, tier: tierFor(score), reasons: reasons.length ? reasons : result.reasons, source: "ai" };
      }
    } catch {
      // keep the heuristic result
    }
  }

  await prisma.contact.update({ where: { id: contactId }, data: { leadScore: result.score, lastActivityAt: new Date() } });
  await prisma.activity.create({
    data: {
      tenantId, contactId, type: "ai_score",
      title: `AI lead score: ${result.score} (${result.tier})`,
      body: result.reasons.join("; "),
      meta: { score: result.score, tier: result.tier, source: result.source },
    },
  });
  return result;
}
