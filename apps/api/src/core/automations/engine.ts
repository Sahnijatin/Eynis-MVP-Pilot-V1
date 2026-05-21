import { prisma } from "../../db/prisma";
import { sendWhatsAppReply } from "../connectors/whatsapp-outbound";

async function hasExecution(ruleId: string, triggerEntityId: string): Promise<boolean> {
  const existing = await prisma.automationExecution.findFirst({
    where: { ruleId, triggerEntityId },
    select: { id: true }
  });
  return Boolean(existing);
}

type ActionResult = "success" | "failed" | "skipped";

async function recordExecution(data: {
  hotelId: string;
  ruleId: string;
  ruleCode: string;
  triggerType: string;
  triggerEntityId?: string;
  actionType: string;
  actionResult: ActionResult;
  resultDetail?: string;
}) {
  await prisma.automationExecution.create({ data });
}

// ── Rule 1: SLA breach → escalate service request ─────────────────────────────

async function evaluateSlaBreachEscalate() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "sla_breach_escalate", isActive: true },
    select: { id: true, hotelId: true, code: true }
  });

  const now = new Date();

  for (const rule of rules) {
    const breachedSRs = await prisma.serviceRequest.findMany({
      where: {
        hotelId: rule.hotelId,
        slaDueAt: { lt: now },
        slaBreachedAt: null,
        status: { in: ["open", "accepted"] }
      },
      select: { id: true, summary: true }
    });

    for (const sr of breachedSRs) {
      if (await hasExecution(rule.id, sr.id)) continue;

      try {
        await prisma.serviceRequest.update({
          where: { id: sr.id },
          data: { status: "escalated", slaBreachedAt: now }
        });
        await prisma.auditLog.create({
          data: {
            hotelId: rule.hotelId,
            actorRole: "automation",
            action: "sla_breach_escalate",
            entityType: "service_request",
            entityId: sr.id,
            metadata: JSON.stringify({ rule: rule.code, summary: sr.summary.slice(0, 120) })
          }
        });
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sla_breach", triggerEntityId: sr.id,
          actionType: "escalate_sr", actionResult: "success",
          resultDetail: `Escalated: ${sr.summary.slice(0, 80)}`
        });
      } catch (err) {
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sla_breach", triggerEntityId: sr.id,
          actionType: "escalate_sr", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Rule 2: Negative sentiment → create review SR ─────────────────────────────

async function evaluateSentimentLowFlag() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "sentiment_low_flag", isActive: true },
    select: { id: true, hotelId: true, code: true }
  });

  for (const rule of rules) {
    const negativeEvents = await prisma.connectorEvent.findMany({
      where: { hotelId: rule.hotelId, aiSentiment: "negative", guestId: { not: null } },
      select: { id: true, guestId: true, guestName: true, aiSummary: true }
    });

    for (const event of negativeEvents) {
      if (!event.guestId) continue;
      if (await hasExecution(rule.id, event.id)) continue;

      try {
        const sr = await prisma.serviceRequest.create({
          data: {
            hotelId: rule.hotelId,
            guestId: event.guestId,
            category: "front_desk",
            summary: `Guest Experience Alert — negative feedback: ${(event.aiSummary ?? "Review required").slice(0, 100)}`,
            status: "open",
            priority: "high",
            source: "automation",
            slaDueAt: new Date(Date.now() + 30 * 60000)
          }
        });
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sentiment_low", triggerEntityId: event.id,
          actionType: "create_sr", actionResult: "success",
          resultDetail: `Created SR ${sr.id} for ${event.guestName ?? event.guestId}`
        });
      } catch (err) {
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sentiment_low", triggerEntityId: event.id,
          actionType: "create_sr", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Rule 3: Check-in within last 30 min → send welcome WhatsApp ───────────────

async function evaluateCheckinWelcome() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "checkin_welcome", isActive: true },
    select: { id: true, hotelId: true, code: true }
  });

  const now = new Date();
  const thirtyMinsAgo = new Date(now.getTime() - 30 * 60000);

  for (const rule of rules) {
    const recentStays = await prisma.stay.findMany({
      where: { hotelId: rule.hotelId, checkInAt: { gte: thirtyMinsAgo, lte: now } },
      include: { guest: { select: { id: true, fullName: true, phoneE164: true } } }
    });

    for (const stay of recentStays) {
      if (await hasExecution(rule.id, stay.id)) continue;

      const { guest } = stay;
      const firstName = guest.fullName.split(" ")[0] ?? guest.fullName;
      const message = `Welcome to The Riviera, ${firstName}! We're delighted to have you in Room ${stay.roomNumber}. Need anything during your stay? Just WhatsApp us anytime — Your Concierge Team`;

      try {
        const result = await sendWhatsAppReply(rule.hotelId, guest.phoneE164, message);
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "checkin_welcome", triggerEntityId: stay.id,
          actionType: "send_whatsapp",
          actionResult: result.sent ? "success" : "failed",
          resultDetail: result.sent ? `Welcome sent to ${guest.phoneE164}` : (result.error ?? "Send failed")
        });
      } catch (err) {
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "checkin_welcome", triggerEntityId: stay.id,
          actionType: "send_whatsapp", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Rule 4: SR resolved in last 2h → queue upsell offer ──────────────────────

async function evaluateUpsellFollowup() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "upsell_followup", isActive: true },
    select: { id: true, hotelId: true, code: true }
  });

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60000);

  for (const rule of rules) {
    const recentResolved = await prisma.serviceRequest.findMany({
      where: {
        hotelId: rule.hotelId,
        status: "resolved",
        resolvedAt: { gte: twoHoursAgo },
        guestId: { not: "" }
      },
      select: { id: true, guestId: true, category: true }
    });

    for (const sr of recentResolved) {
      if (!sr.guestId) continue;
      if (await hasExecution(rule.id, sr.id)) continue;

      const offerType =
        sr.category === "fnb" ? "fnb_offer" :
        sr.category === "housekeeping" ? "room_upgrade" : "late_checkout";

      try {
        await prisma.offerEvent.create({
          data: {
            hotelId: rule.hotelId,
            guestId: sr.guestId,
            offerType,
            channel: "whatsapp",
            status: "pending",
            revenueInr: 0,
            contextJson: JSON.stringify({ sourceRequestId: sr.id, automationRule: rule.code })
          }
        });
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "upsell_followup", triggerEntityId: sr.id,
          actionType: "queue_offer", actionResult: "success",
          resultDetail: `Queued ${offerType} offer`
        });
      } catch (err) {
        await recordExecution({
          hotelId: rule.hotelId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "upsell_followup", triggerEntityId: sr.id,
          actionType: "queue_offer", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Public: start worker ──────────────────────────────────────────────────────

export function startAutomationWorker(intervalMs = 60_000): () => void {
  const runCycle = async () => {
    try {
      await Promise.allSettled([
        evaluateSlaBreachEscalate(),
        evaluateSentimentLowFlag(),
        evaluateCheckinWelcome(),
        evaluateUpsellFollowup()
      ]);
    } catch (err) {
      console.error("[AutomationEngine] Cycle error:", err);
    }
  };

  void runCycle();
  const id = setInterval(() => void runCycle(), intervalMs);
  return () => clearInterval(id);
}
