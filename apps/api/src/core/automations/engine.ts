import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { sendWhatsAppReply } from "../connectors/whatsapp-outbound";
import { singleFlight } from "../single-flight";

async function hasExecution(ruleId: string, triggerEntityId: string): Promise<boolean> {
  const existing = await prisma.automationExecution.findFirst({
    where: { ruleId, triggerEntityId },
    select: { id: true }
  });
  return Boolean(existing);
}

type ActionResult = "success" | "failed" | "skipped";

async function recordExecution(data: {
  tenantId: string;
  ruleId: string;
  ruleCode: string;
  triggerType: string;
  triggerEntityId?: string;
  actionType: string;
  actionResult: ActionResult;
  resultDetail?: string;
}) {
  try {
    await prisma.automationExecution.create({ data });
  } catch (err) {
    // A unique-violation on (ruleId, triggerEntityId) means another cycle already
    // recorded this execution — the entity is handled, so swallow it (F-13). The
    // DB constraint is the backstop for the in-app hasExecution check.
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return;
    throw err;
  }
}

// ── Rule 1: SLA breach → escalate service request ─────────────────────────────

export async function evaluateSlaBreachEscalate() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "sla_breach_escalate", isActive: true },
    select: { id: true, tenantId: true, code: true }
  });

  const now = new Date();

  for (const rule of rules) {
    const breachedSRs = await prisma.serviceRequest.findMany({
      where: {
        tenantId: rule.tenantId,
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
            tenantId: rule.tenantId,
            actorRole: "automation",
            action: "sla_breach_escalate",
            entityType: "service_request",
            entityId: sr.id,
            metadata: JSON.stringify({ rule: rule.code, summary: sr.summary.slice(0, 120) })
          }
        });
        await recordExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sla_breach", triggerEntityId: sr.id,
          actionType: "escalate_sr", actionResult: "success",
          resultDetail: `Escalated: ${sr.summary.slice(0, 80)}`
        });
      } catch (err) {
        await recordExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sla_breach", triggerEntityId: sr.id,
          actionType: "escalate_sr", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Rule 2: Negative sentiment → create review SR ─────────────────────────────

export async function evaluateSentimentLowFlag() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "sentiment_low_flag", isActive: true },
    select: { id: true, tenantId: true, code: true }
  });

  for (const rule of rules) {
    const negativeEvents = await prisma.connectorEvent.findMany({
      where: { tenantId: rule.tenantId, aiSentiment: "negative", guestId: { not: null } },
      select: { id: true, guestId: true, guestName: true, aiSummary: true }
    });

    for (const event of negativeEvents) {
      if (!event.guestId) continue;
      if (await hasExecution(rule.id, event.id)) continue;

      try {
        const sr = await prisma.serviceRequest.create({
          data: {
            tenantId: rule.tenantId,
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
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sentiment_low", triggerEntityId: event.id,
          actionType: "create_sr", actionResult: "success",
          resultDetail: `Created SR ${sr.id} for ${event.guestName ?? event.guestId}`
        });
      } catch (err) {
        await recordExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "sentiment_low", triggerEntityId: event.id,
          actionType: "create_sr", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Rule 3: Check-in within last 30 min → send welcome WhatsApp ───────────────

export async function evaluateCheckinWelcome() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "checkin_welcome", isActive: true },
    select: { id: true, tenantId: true, code: true }
  });

  const now = new Date();
  const thirtyMinsAgo = new Date(now.getTime() - 30 * 60000);

  for (const rule of rules) {
    // White-label: the welcome message must carry the tenant's own brand, never a
    // hardcoded "The Riviera" / "Your Concierge Team" (F-20). Prefer the branding
    // override, fall back to the tenant's name.
    const tenant = await prisma.tenant.findUnique({
      where: { id: rule.tenantId },
      select: { name: true, branding: { select: { brandName: true } } }
    });
    const brandName = tenant?.branding?.brandName?.trim() || tenant?.name?.trim() || "us";

    const recentStays = await prisma.stay.findMany({
      where: { tenantId: rule.tenantId, checkInAt: { gte: thirtyMinsAgo, lte: now } },
      include: { guest: { select: { id: true, fullName: true, phoneE164: true } } }
    });

    for (const stay of recentStays) {
      if (await hasExecution(rule.id, stay.id)) continue;

      const { guest } = stay;
      const firstName = guest.fullName.split(" ")[0] ?? guest.fullName;
      const message = `Welcome to ${brandName}, ${firstName}! We're delighted to have you in Room ${stay.roomNumber}. Need anything during your stay? Just WhatsApp us anytime — The ${brandName} Team`;

      try {
        const result = await sendWhatsAppReply(rule.tenantId, guest.phoneE164, message);
        await recordExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "checkin_welcome", triggerEntityId: stay.id,
          actionType: "send_whatsapp",
          actionResult: result.sent ? "success" : "failed",
          resultDetail: result.sent ? `Welcome sent to ${guest.phoneE164}` : (result.error ?? "Send failed")
        });
      } catch (err) {
        await recordExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "checkin_welcome", triggerEntityId: stay.id,
          actionType: "send_whatsapp", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Rule 4: SR resolved in last 2h → queue upsell offer ──────────────────────

export async function evaluateUpsellFollowup() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "upsell_followup", isActive: true },
    select: { id: true, tenantId: true, code: true }
  });

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60000);

  for (const rule of rules) {
    const recentResolved = await prisma.serviceRequest.findMany({
      where: {
        tenantId: rule.tenantId,
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
            tenantId: rule.tenantId,
            guestId: sr.guestId,
            offerType,
            channel: "whatsapp",
            status: "pending",
            revenueInr: 0,
            contextJson: JSON.stringify({ sourceRequestId: sr.id, automationRule: rule.code })
          }
        });
        await recordExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "upsell_followup", triggerEntityId: sr.id,
          actionType: "queue_offer", actionResult: "success",
          resultDetail: `Queued ${offerType} offer`
        });
      } catch (err) {
        await recordExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "upsell_followup", triggerEntityId: sr.id,
          actionType: "queue_offer", actionResult: "failed",
          resultDetail: err instanceof Error ? err.message : "Unknown error"
        });
      }
    }
  }
}

// ── Public: start worker ──────────────────────────────────────────────────────

// Wrapped in singleFlight so a cycle that overruns the 60s interval can't overlap
// the next one — overlapping cycles widen the check-then-act idempotency window
// (F-13). The DB unique constraint on (ruleId, triggerEntityId) is the backstop.
export const runAutomationCycle = singleFlight(async (): Promise<void> => {
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
});

export function startAutomationWorker(intervalMs = 60_000): () => void {
  void runAutomationCycle();
  const id = setInterval(() => void runAutomationCycle(), intervalMs);
  return () => clearInterval(id);
}
