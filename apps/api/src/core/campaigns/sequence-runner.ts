// Drip sequence runner.
//
// Each tick advances every due enrollment by one step: re-check exit conditions
// (reply / opt-out / booking) and the shared compliance guard, send the step's
// action via the ChannelSender registry, log a SequenceEvent, then schedule the
// next step (or complete). Sender is dependency-injected so the whole flow runs
// with no Twilio/Resend keys.

import { prisma } from "../../db/prisma";
import { evaluateContact } from "./guard";
import { getSender, type ChannelSender, type SendContext } from "./senders";
import { parseExitOn, nextRunFrom, type ExitCondition } from "./sequences";

const TICK_MS = Number(process.env.SEQUENCE_RUNNER_INTERVAL_MS ?? 60_000);
const BATCH = Number(process.env.SEQUENCE_RUNNER_BATCH ?? 200);

export interface SequenceDeps {
  resolveSender?: (channel: string) => ChannelSender | null;
  batchSize?: number;
}

const safeArray = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

interface ExitCtx { hotelId: string; leadId: string; enrolledAt: Date; leadOptedOut: boolean; leadPhone: string | null }

// First exit condition the lead has met since enrolling, or null.
async function exitMet(conds: ExitCondition[], c: ExitCtx): Promise<ExitCondition | null> {
  if (conds.includes("opted_out")) {
    if (c.leadOptedOut) return "opted_out";
    if (c.leadPhone) {
      const dnc = await prisma.doNotContact.findUnique({
        where: { hotelId_phone: { hotelId: c.hotelId, phone: c.leadPhone } }, select: { id: true },
      });
      if (dnc) return "opted_out";
    }
  }
  if (conds.includes("replied")) {
    const inbound = await prisma.whatsappMessage.findFirst({
      where: { hotelId: c.hotelId, direction: "in", conversation: { leadId: c.leadId }, createdAt: { gte: c.enrolledAt } },
      select: { id: true },
    });
    if (inbound) return "replied";
  }
  if (conds.includes("booked")) {
    const booked = await prisma.whatsappConversation.findFirst({ where: { leadId: c.leadId, state: "booked" }, select: { id: true } });
    if (booked) return "booked";
  }
  return null;
}

interface EventKeys { hotelId: string; sequenceId: string; enrollmentId: string; leadId: string }
const logEvent = (k: EventKeys, stepOrder: number, channel: string, status: string, error: string | null) =>
  prisma.sequenceEvent.create({ data: { ...k, stepOrder, channel, status, error } });

export async function processDueEnrollments(deps: SequenceDeps = {}, now = new Date()): Promise<{ sent: number; stopped: number; completed: number; skipped: number }> {
  const resolveSender = deps.resolveSender ?? getSender;
  const batchSize = deps.batchSize ?? BATCH;
  let sent = 0, stopped = 0, completed = 0, skipped = 0;

  const due = await prisma.sequenceEnrollment.findMany({
    where: { status: "active", nextRunAt: { lte: now }, sequence: { status: "active" } },
    take: batchSize,
    include: { sequence: { include: { steps: true } }, lead: true },
  });

  for (const e of due) {
    const keys: EventKeys = { hotelId: e.hotelId, sequenceId: e.sequenceId, enrollmentId: e.id, leadId: e.leadId };
    const conds = parseExitOn(e.sequence.exitOn);

    const exit = await exitMet(conds, { hotelId: e.hotelId, leadId: e.leadId, enrolledAt: e.createdAt, leadOptedOut: e.lead.optedOut, leadPhone: e.lead.phone });
    if (exit) {
      await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { status: "stopped", stoppedReason: exit } });
      await logEvent(keys, e.currentStepOrder, "-", "stopped", exit);
      stopped++;
      continue;
    }

    const step = e.sequence.steps.find((s) => s.order === e.currentStepOrder);
    if (!step) {
      await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { status: "completed" } });
      completed++;
      continue;
    }

    // Compliance guard — suppression is always enforced (independent of exitOn).
    const suppressed = e.lead.phone
      ? Boolean(await prisma.doNotContact.findUnique({ where: { hotelId_phone: { hotelId: e.hotelId, phone: e.lead.phone } }, select: { id: true } }))
      : true;
    const decision = evaluateContact(
      { consent: e.lead.consent, consentSource: e.lead.consentSource, optedOut: e.lead.optedOut, phone: e.lead.phone },
      { channel: step.channel as "whatsapp" | "email", suppressed },
    );
    if (!decision.ok) {
      await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { status: "stopped", stoppedReason: decision.reason } });
      await logEvent(keys, step.order, step.channel, "skipped", decision.reason);
      skipped++;
      continue;
    }

    const hotel = await prisma.hotel.findUnique({ where: { id: e.hotelId }, select: { name: true } });
    const sender = resolveSender(step.channel);
    let status = "failed";
    let error: string | null = "no_sender";
    if (sender) {
      const ctx: SendContext = {
        hotelId: e.hotelId,
        campaign: {
          name: e.sequence.name, calendlyLink: null,
          whatsappContentSid: step.whatsappContentSid, whatsappTemplateBody: step.whatsappTemplateBody,
          whatsappVariables: safeArray(step.whatsappVariables),
          emailSubjectTemplate: step.emailSubject, emailBodyTemplate: step.emailBody,
        },
        lead: e.lead, tenantName: hotel?.name ?? null,
      };
      const result = await sender.send(ctx);
      status = result.ok ? "sent" : "failed";
      error = result.error ?? null;
      if (result.ok) sent++;
    }
    await logEvent(keys, step.order, step.channel, status, error);

    // Advance to the next step (regardless of send success — v1 doesn't retry a
    // single failed step) or complete the enrollment.
    const nextStep = e.sequence.steps.find((s) => s.order === e.currentStepOrder + 1);
    if (nextStep) {
      await prisma.sequenceEnrollment.update({
        where: { id: e.id },
        data: { currentStepOrder: nextStep.order, nextRunAt: nextRunFrom(now, nextStep.waitMinutes) },
      });
    } else {
      await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { status: "completed", currentStepOrder: e.currentStepOrder + 1 } });
      completed++;
    }
  }

  return { sent, stopped, completed, skipped };
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startSequenceWorker(intervalMs = TICK_MS): void {
  if (timer) return;
  timer = setInterval(() => { void processDueEnrollments().catch((e) => console.error("[Sequence] tick failed:", (e as Error).message)); }, intervalMs);
  console.log(`Eynis SequenceRunner started — ${Math.round(intervalMs / 1000)}s cycle`);
}

export function stopSequenceWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
