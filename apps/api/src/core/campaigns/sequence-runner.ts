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
import { resolveApprovedWhatsappTemplate } from "./whatsapp-template";
import { campaignMaySendNow } from "./schedule-gate";
import { parseExitOn, nextRunFrom, type ExitCondition } from "./sequences";

const TICK_MS = Number(process.env.SEQUENCE_RUNNER_INTERVAL_MS ?? 60_000);
const BATCH = Number(process.env.SEQUENCE_RUNNER_BATCH ?? 200);
// When a drip step falls outside its lead's campaign send window, defer this long
// before re-checking (so it eventually fires once the window opens) (F-15).
const SEND_WINDOW_DEFER_MIN = Number(process.env.SEQUENCE_DEFER_MIN ?? 30);

export interface SequenceDeps {
  resolveSender?: (channel: string) => ChannelSender | null;
  batchSize?: number;
}

const safeArray = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

interface ExitCtx { tenantId: string; leadId: string; enrolledAt: Date; leadOptedOut: boolean; leadPhone: string | null }

// First exit condition the lead has met since enrolling, or null.
async function exitMet(conds: ExitCondition[], c: ExitCtx): Promise<ExitCondition | null> {
  if (conds.includes("opted_out")) {
    if (c.leadOptedOut) return "opted_out";
    if (c.leadPhone) {
      const dnc = await prisma.doNotContact.findUnique({
        where: { tenantId_phone: { tenantId: c.tenantId, phone: c.leadPhone } }, select: { id: true },
      });
      if (dnc) return "opted_out";
    }
  }
  if (conds.includes("replied")) {
    const inbound = await prisma.whatsappMessage.findFirst({
      where: { tenantId: c.tenantId, direction: "in", conversation: { leadId: c.leadId }, createdAt: { gte: c.enrolledAt } },
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

interface EventKeys { tenantId: string; sequenceId: string; enrollmentId: string; leadId: string }
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
    const keys: EventKeys = { tenantId: e.tenantId, sequenceId: e.sequenceId, enrollmentId: e.id, leadId: e.leadId };
    const conds = parseExitOn(e.sequence.exitOn);

    const exit = await exitMet(conds, { tenantId: e.tenantId, leadId: e.leadId, enrolledAt: e.createdAt, leadOptedOut: e.lead.optedOut, leadPhone: e.lead.phone });
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
    // Phone-based DoNotContact applies to phone channels; an email step must not be
    // force-suppressed just for lacking a phone (F-5).
    const isEmailStep = step.channel === "email";
    const suppressed = isEmailStep
      ? Boolean(e.lead.email && await prisma.emailSuppression.findUnique({ where: { tenantId_email: { tenantId: e.tenantId, email: e.lead.email.trim().toLowerCase() } }, select: { id: true } }))
      : e.lead.phone
      ? Boolean(await prisma.doNotContact.findUnique({ where: { tenantId_phone: { tenantId: e.tenantId, phone: e.lead.phone } }, select: { id: true } }))
      : true;
    const decision = evaluateContact(
      { consent: e.lead.consent, consentSource: e.lead.consentSource, optedOut: e.lead.optedOut, phone: e.lead.phone, email: e.lead.email },
      { channel: step.channel as "whatsapp" | "email", suppressed },
    );
    if (!decision.ok) {
      await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { status: "stopped", stoppedReason: decision.reason } });
      await logEvent(keys, step.order, step.channel, "skipped", decision.reason);
      skipped++;
      continue;
    }

    // Honour the originating campaign's send window / quiet-hours so drip steps
    // don't fire overnight (F-15). Sequences have no schedule of their own, so we
    // gate on the lead's campaign; if outside the window, defer without advancing.
    const leadCampaign = await prisma.voiceCampaign.findUnique({
      where: { id: e.lead.campaignId },
      select: { tenantId: true, scheduledStartAt: true, sendWindowStartMin: true, sendWindowEndMin: true, sendDays: true, sendTimeZone: true },
    });
    if (leadCampaign && !(await campaignMaySendNow(leadCampaign, now))) {
      await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { nextRunAt: new Date(now.getTime() + SEND_WINDOW_DEFER_MIN * 60_000) } });
      continue; // deferred — neither sent nor skipped this tick
    }

    // WhatsApp steps must resolve to an approved library template.
    let waContentSid = step.whatsappContentSid;
    let waBody = step.whatsappTemplateBody;
    let waVars = safeArray(step.whatsappVariables);
    if (step.channel === "whatsapp" && step.whatsappTemplateId) {
      const resolved = await resolveApprovedWhatsappTemplate(step.whatsappTemplateId);
      if (!resolved) {
        await logEvent(keys, step.order, step.channel, "skipped", "template_not_approved");
        skipped++;
        // Advance past this step so a stuck template doesn't wedge the enrollment.
        const next = e.sequence.steps.find((s) => s.order === e.currentStepOrder + 1);
        if (next) await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { currentStepOrder: next.order, nextRunAt: nextRunFrom(now, next.waitMinutes) } });
        else await prisma.sequenceEnrollment.update({ where: { id: e.id }, data: { status: "completed", currentStepOrder: e.currentStepOrder + 1 } });
        continue;
      }
      waContentSid = resolved.contentSid; waBody = resolved.body; waVars = resolved.variables;
    }

    const hotel = await prisma.tenant.findUnique({ where: { id: e.tenantId }, select: { name: true } });
    const sender = resolveSender(step.channel);
    let status = "failed";
    let error: string | null = "no_sender";
    if (sender) {
      const ctx: SendContext = {
        tenantId: e.tenantId,
        campaign: {
          name: e.sequence.name, calendlyLink: null,
          whatsappContentSid: waContentSid, whatsappTemplateBody: waBody, whatsappVariables: waVars,
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
