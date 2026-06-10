// CRM AI next-best-action — SAFE MODE deal-stage suggestions (Increment C).
//
// The AI proposes a stage move with a reason; a human accepts (which performs the
// move) or dismisses. The AI never moves a deal on its own. Falls back to a
// deterministic keyword rule when no provider key is set (so it works in dev/test).

import { prisma } from "../../db/prisma";
import { CLAUDE_AVAILABLE, OPENAI_AVAILABLE, aiComplete, extractJson, type AIProvider } from "../ai/intelligence";
import { recentConversationText } from "./timeline";

type StageRow = { id: string; name: string; order: number; probability: number; isWon: boolean; isLost: boolean };
type SuggestionRow = {
  id: string; dealId: string; fromStageId: string | null; suggestedStageId: string;
  reason: string; confidence: number | null; source: string; status: string;
  createdAt: Date; resolvedAt: Date | null;
};

export function serializeSuggestion(s: SuggestionRow, dealTitle: string, stages: StageRow[]) {
  const stageName = (id: string | null) => stages.find((x) => x.id === id)?.name ?? null;
  return {
    id: s.id,
    dealId: s.dealId,
    dealTitle,
    fromStageId: s.fromStageId,
    fromStageName: stageName(s.fromStageId),
    suggestedStageId: s.suggestedStageId,
    suggestedStageName: stageName(s.suggestedStageId),
    reason: s.reason,
    confidence: s.confidence,
    source: s.source,
    status: s.status,
    createdAt: s.createdAt.toISOString(),
    resolvedAt: s.resolvedAt ? s.resolvedAt.toISOString() : null,
  };
}

// Pure keyword classifier over recent conversation text → movement intent.
export function heuristicStageIntent(text: string): { intent: "advance" | "won" | "lost" | "none"; reason: string } {
  const t = text.toLowerCase();
  if (/\b(not interested|cancel|too expensive|no longer|went with|declin|lost the|dropping)\b/.test(t)) {
    return { intent: "lost", reason: "Customer signalled they are not proceeding." };
  }
  if (/\b(confirmed|agreed|signed|go ahead|booked|paid|deposit|purchase|deal done|let'?s do it)\b/.test(t)) {
    return { intent: "won", reason: "Customer agreed/confirmed — looks closed-won." };
  }
  if (/\b(quote|proposal|pricing|send.*(details|info)|interested|next step|schedule|demo|meeting|negotiat)\b/.test(t)) {
    return { intent: "advance", reason: "Positive buying signal — ready to move forward a stage." };
  }
  return { intent: "none", reason: "" };
}

// Generate (or refresh) a pending suggestion for one open deal. Returns the
// serialized suggestion, or null when there's no supported move to propose.
export async function generateDealSuggestion(tenantId: string, dealId: string, provider: AIProvider = "claude") {
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, tenantId },
    include: { pipeline: { include: { stages: { orderBy: { order: "asc" } } } }, stage: true },
  });
  if (!deal || deal.status !== "open") return null;
  const stages = deal.pipeline.stages as StageRow[];
  const currentIdx = stages.findIndex((s) => s.id === deal.stageId);
  const convo = deal.contactId ? await recentConversationText(tenantId, deal.contactId) : "";

  let targetStageId: string | null = null;
  let reason = "";
  let confidence: number | null = null;
  let usedAi = false;

  if ((CLAUDE_AVAILABLE || OPENAI_AVAILABLE) && convo) {
    try {
      const stageList = stages.map((s, i) => `${i}:${s.name}${s.isWon ? "(won)" : s.isLost ? "(lost)" : ` ${s.probability}%`}`).join("; ");
      const prompt = `A sales deal "${deal.title}" is currently at stage "${deal.stage?.name}". Pipeline stages: ${stageList}. ` +
        `Based ONLY on the recent conversation below, which stage should it be in now? Only propose a change clearly supported by the conversation; otherwise say "no change".\n` +
        `Conversation (newest first):\n${convo}\n\n` +
        `Respond ONLY with JSON: {"stageName":"<exact stage name or 'no change'>","reason":"<short>","confidence":<0-100>}`;
      const raw = await aiComplete(prompt, provider);
      const parsed = extractJson(raw) as { stageName?: unknown; reason?: unknown; confidence?: unknown } | null;
      const name = typeof parsed?.stageName === "string" ? parsed.stageName.trim().toLowerCase() : "";
      const match = stages.find((s) => s.name.toLowerCase() === name);
      if (match && match.id !== deal.stageId) {
        targetStageId = match.id;
        reason = typeof parsed?.reason === "string" && parsed.reason.trim() ? parsed.reason.trim() : "Suggested from the recent conversation.";
        confidence = typeof parsed?.confidence === "number" ? Math.max(0, Math.min(100, Math.round(parsed.confidence))) : null;
        usedAi = true;
      }
    } catch {
      /* fall through to heuristic */
    }
  }

  if (!targetStageId) {
    const intent = heuristicStageIntent(convo);
    if (intent.intent === "won") {
      const w = stages.find((s) => s.isWon);
      if (w && w.id !== deal.stageId) { targetStageId = w.id; reason = intent.reason; confidence = 70; }
    } else if (intent.intent === "lost") {
      const l = stages.find((s) => s.isLost);
      if (l && l.id !== deal.stageId) { targetStageId = l.id; reason = intent.reason; confidence = 65; }
    } else if (intent.intent === "advance") {
      const next = stages[currentIdx + 1];
      if (next && !next.isWon && !next.isLost && next.id !== deal.stageId) { targetStageId = next.id; reason = intent.reason; confidence = 60; }
    }
  }

  if (!targetStageId) return null;

  // De-dupe: one pending suggestion per deal. Supersede a stale one.
  const existing = await prisma.dealSuggestion.findFirst({ where: { tenantId, dealId, status: "pending" } });
  if (existing) {
    if (existing.suggestedStageId === targetStageId) return serializeSuggestion(existing, deal.title, stages);
    await prisma.dealSuggestion.update({ where: { id: existing.id }, data: { status: "dismissed", resolvedAt: new Date() } });
  }
  const created = await prisma.dealSuggestion.create({
    data: { tenantId, dealId, fromStageId: deal.stageId, suggestedStageId: targetStageId, reason, confidence, source: usedAi ? "ai" : "rule" },
  });
  return serializeSuggestion(created, deal.title, stages);
}

// Safe-mode write-back from a Research Studio run (RS-3). A strong research/fit
// score is a qualification signal, so it maps onto the one stage-move that's
// honest: *advance the deal one stage*. A human still confirms — research never
// moves a deal on its own. No-op for low scores, non-open deals, deals already
// in the last (or a won/lost) stage, or when a pending suggestion already exists
// (we don't clobber a conversation-derived proposal). Best-effort + tenant-scoped.
const RESEARCH_DEAL_SUGGEST_THRESHOLD = Number(process.env.RESEARCH_DEAL_SUGGEST_THRESHOLD ?? 70);

export async function suggestFromResearchScore(tenantId: string, dealId: string, score: number) {
  if (!Number.isFinite(score) || score < RESEARCH_DEAL_SUGGEST_THRESHOLD) return null;
  const deal = await prisma.deal.findFirst({
    where: { id: dealId, tenantId },
    include: { pipeline: { include: { stages: { orderBy: { order: "asc" } } } } },
  });
  if (!deal || deal.status !== "open") return null;
  const stages = deal.pipeline.stages as StageRow[];
  const currentIdx = stages.findIndex((s) => s.id === deal.stageId);
  const next = stages[currentIdx + 1];
  if (!next || next.isWon || next.isLost || next.id === deal.stageId) return null;

  // Don't override an existing pending suggestion (e.g. a conversation-derived one).
  const existing = await prisma.dealSuggestion.findFirst({ where: { tenantId, dealId, status: "pending" } });
  if (existing) return serializeSuggestion(existing, deal.title, stages);

  const rounded = Math.round(score);
  const confidence = Math.max(0, Math.min(100, rounded));
  const created = await prisma.dealSuggestion.create({
    data: {
      tenantId, dealId, fromStageId: deal.stageId, suggestedStageId: next.id,
      reason: `Research scored this ${rounded}/100 — a strong fit signal. Consider advancing to "${next.name}".`,
      confidence, source: "research",
    },
  });
  return serializeSuggestion(created, deal.title, stages);
}

// Accept a pending suggestion → perform the move (mirrors POST /deals/:id/move).
export async function acceptSuggestion(tenantId: string, suggestionId: string, userId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const sug = await prisma.dealSuggestion.findFirst({ where: { id: suggestionId, tenantId } });
  if (!sug) return { ok: false, status: 404, error: "Suggestion not found" };
  if (sug.status !== "pending") return { ok: false, status: 409, error: "Suggestion already resolved" };
  const deal = await prisma.deal.findFirst({ where: { id: sug.dealId, tenantId } });
  if (!deal) return { ok: false, status: 404, error: "Deal not found" };
  const toStage = await prisma.stage.findFirst({ where: { id: sug.suggestedStageId, tenantId, pipelineId: deal.pipelineId } });
  if (!toStage) return { ok: false, status: 400, error: "Suggested stage is not in the deal's pipeline" };

  const status = toStage.isWon ? "won" : toStage.isLost ? "lost" : "open";
  await prisma.deal.update({
    where: { id: deal.id },
    data: {
      stageId: toStage.id, status,
      closedAt: status === "open" ? null : (deal.closedAt ?? new Date()),
      transitions: { create: { tenantId, fromStageId: deal.stageId, toStageId: toStage.id, changedById: userId, note: "AI suggestion accepted" } },
    },
  });
  await prisma.dealSuggestion.update({ where: { id: sug.id }, data: { status: "accepted", resolvedAt: new Date(), resolvedById: userId } });
  return { ok: true };
}

export async function dismissSuggestion(tenantId: string, suggestionId: string, userId: string): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const sug = await prisma.dealSuggestion.findFirst({ where: { id: suggestionId, tenantId } });
  if (!sug) return { ok: false, status: 404, error: "Suggestion not found" };
  if (sug.status !== "pending") return { ok: false, status: 409, error: "Suggestion already resolved" };
  await prisma.dealSuggestion.update({ where: { id: sug.id }, data: { status: "dismissed", resolvedAt: new Date(), resolvedById: userId } });
  return { ok: true };
}
