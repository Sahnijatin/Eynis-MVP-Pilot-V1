// Vapi end-of-call webhook processing (Phase 7).
//
// Normalises Vapi's webhook `message` into a small internal event, then updates
// the matching CallRecord (by vapiCallId): live per-utterance sentiment during
// the call, and finalisation (transcript/outcome/sentiment) + retry scheduling +
// follow-ups at end-of-call. Opt-out detected mid-call suppresses the lead.

import { prisma } from "../../db/prisma";
import { broadcastSSEEvent } from "../../sse/clients";
import { classifySentiment, aggregateSentiment } from "./sentiment";
import { detectOptOut } from "./compliance";
import { suppressContact } from "./csv-import";
import { handlePostCallFollowUp, type FollowUpDeps } from "./followup";

// ── Normalisation ─────────────────────────────────────────────────────────────

export type InternalEvent =
  | { kind: "call-started"; callId: string; startedAt?: string }
  | { kind: "utterance"; callId: string; role: "customer" | "agent"; text: string }
  | { kind: "end-of-call"; callId: string; transcript?: string; outcome?: string; sentiment?: string; keyPoints?: string[]; summary?: string; durationSeconds?: number; endedReason?: string }
  | { kind: "ignore" };

const NO_ANSWER_REASONS = ["no-answer", "customer-did-not-answer", "voicemail", "busy", "no-response"];

// Accepts either a bare message or a { message } envelope.
export function normalizeVapiMessage(raw: any): InternalEvent {
  const m = raw?.message ?? raw ?? {};
  const callId: string | undefined = m.call?.id ?? raw?.call?.id;
  const type: string = m.type ?? "";

  if (!callId) return { kind: "ignore" };

  if (type === "status-update") {
    if (m.status === "in-progress" || m.status === "started") return { kind: "call-started", callId, startedAt: m.call?.startedAt };
    return { kind: "ignore" };
  }
  if (type === "call-started") return { kind: "call-started", callId, startedAt: m.call?.startedAt };

  if (type === "transcript") {
    // Only act on final utterances to avoid scoring partial fragments.
    if (m.transcriptType && m.transcriptType !== "final") return { kind: "ignore" };
    const role = m.role === "assistant" || m.role === "bot" || m.role === "agent" ? "agent" : "customer";
    const text = m.transcript ?? m.text ?? "";
    if (!text) return { kind: "ignore" };
    return { kind: "utterance", callId, role, text };
  }

  if (type === "end-of-call-report" || type === "end-of-call") {
    const sd = m.analysis?.structuredData ?? {};
    return {
      kind: "end-of-call", callId,
      transcript: m.transcript ?? m.artifact?.transcript,
      outcome: sd.outcome,
      sentiment: sd.sentiment,
      keyPoints: Array.isArray(sd.keyPoints) ? sd.keyPoints : undefined,
      summary: m.analysis?.summary ?? m.summary,
      durationSeconds: m.durationSeconds ?? m.call?.durationSeconds,
      endedReason: m.endedReason ?? m.call?.endedReason,
    };
  }

  return { kind: "ignore" };
}

// ── Handlers (operate on a CallRecord found by vapiCallId) ──────────────────

async function findCall(callId: string) {
  return prisma.callRecord.findUnique({ where: { vapiCallId: callId } });
}

export async function handleCallStarted(callId: string, startedAt?: string): Promise<void> {
  const call = await findCall(callId);
  if (!call) return;
  await prisma.callRecord.update({
    where: { id: call.id },
    data: { status: "in_progress", startedAt: startedAt ? new Date(startedAt) : call.startedAt ?? new Date() },
  });
}

export async function handleUtterance(callId: string, role: "customer" | "agent", text: string): Promise<void> {
  const call = await findCall(callId);
  if (!call) return;

  const { sentiment, score } = classifySentiment(text);
  await prisma.sentimentEvent.create({
    data: { hotelId: call.hotelId, callRecordId: call.id, speaker: role, text: text.slice(0, 500), sentiment, score },
  });
  broadcastSSEEvent({ type: "campaign_sentiment_update", hotelId: call.hotelId, campaignId: call.campaignId, callRecordId: call.id, speaker: role, sentiment, score });

  // Sentiment-driven safety: a customer opt-out mid-call suppresses the lead
  // tenant-wide and ends the call as opted_out.
  if (role === "customer" && detectOptOut(text)) {
    const lead = await prisma.campaignLead.findUnique({ where: { id: call.leadId }, select: { phone: true } });
    if (lead?.phone) await suppressContact(call.hotelId, lead.phone, "opt_out");
    await prisma.callRecord.update({ where: { id: call.id }, data: { outcome: "opted_out", sentiment: "negative" } });
  }
}

const isNoAnswer = (outcome?: string, endedReason?: string): boolean =>
  outcome === "no_answer" || NO_ANSWER_REASONS.some((r) => (endedReason ?? "").toLowerCase().includes(r));

export async function handleEndOfCall(ev: Extract<InternalEvent, { kind: "end-of-call" }>, deps: FollowUpDeps = {}): Promise<void> {
  const call = await findCall(ev.callId);
  if (!call) return;

  // Aggregate sentiment from the live timeline (fallback to the report's label).
  const events = await prisma.sentimentEvent.findMany({ where: { callRecordId: call.id }, select: { score: true } });
  const agg = aggregateSentiment(events.map((e) => e.score ?? 0));
  const finalSentiment = events.length > 0 ? agg.sentiment : (ev.sentiment ?? null);

  // Respect a mid-call opt-out (already set on the record).
  const outcome = call.outcome === "opted_out" ? "opted_out" : (ev.outcome ?? (isNoAnswer(ev.outcome, ev.endedReason) ? "no_answer" : null));

  await prisma.callRecord.update({
    where: { id: call.id },
    data: {
      status: "ended", outcome,
      transcript: ev.transcript ?? call.transcript,
      aiSummary: ev.summary ?? call.aiSummary,
      sentiment: finalSentiment,
      keyPoints: ev.keyPoints ? JSON.stringify(ev.keyPoints) : call.keyPoints,
      durationSeconds: ev.durationSeconds ?? call.durationSeconds,
      endedAt: new Date(),
    },
  });

  // Lead lifecycle + retry scheduling.
  const lead = await prisma.campaignLead.findUnique({ where: { id: call.leadId } });
  const campaign = await prisma.voiceCampaign.findUnique({ where: { id: call.campaignId }, select: { maxRetries: true, retryDelayHours: true } });
  if (lead && campaign) {
    if (outcome === "opted_out") {
      // suppressContact already flagged the lead; nothing more.
    } else if (isNoAnswer(outcome ?? undefined, ev.endedReason) && lead.callAttempts < campaign.maxRetries) {
      const nextCallAt = new Date(Date.now() + campaign.retryDelayHours * 3_600_000);
      await prisma.campaignLead.updateMany({ where: { id: lead.id, status: "calling" }, data: { status: "pending", nextCallAt } });
    } else {
      await prisma.campaignLead.updateMany({ where: { id: lead.id, status: "calling" }, data: { status: "called" } });
    }
  }

  broadcastSSEEvent({ type: "campaign_call_ended", hotelId: call.hotelId, campaignId: call.campaignId, leadId: call.leadId, outcome, sentiment: finalSentiment });

  // Follow-ups (skipped automatically for opted-out leads).
  await handlePostCallFollowUp(call.id, deps);
}

// Top-level dispatch used by the route.
export async function processVapiWebhook(raw: unknown, deps: FollowUpDeps = {}): Promise<{ handled: string }> {
  const ev = normalizeVapiMessage(raw);
  switch (ev.kind) {
    case "call-started": await handleCallStarted(ev.callId, ev.startedAt); return { handled: "call-started" };
    case "utterance": await handleUtterance(ev.callId, ev.role, ev.text); return { handled: "utterance" };
    case "end-of-call": await handleEndOfCall(ev, deps); return { handled: "end-of-call" };
    default: return { handled: "ignore" };
  }
}
