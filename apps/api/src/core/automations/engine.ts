import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { sendWhatsAppReply } from "../connectors/whatsapp-outbound";
import { evaluateOutboundSend, recordAutomatedSend } from "../connectors/messaging-guardrails";
import { expireOverdueQuotes } from "../quotes/service";
import { singleFlight } from "../single-flight";
import { loadTemplateForRun } from "../research/store";
import { getIntakePack, packLookup } from "../industry-pack";

type ActionResult = "success" | "failed" | "skipped" | "pending";

// CLAIM-FIRST idempotency (F-… H5): reserve the execution BEFORE performing the side
// effect, using the unique index on (ruleId, triggerEntityId) as an atomic lock. The
// old pattern checked-then-acted-then-recorded, so a crash between act and record —
// or two API instances evaluating the same entity — could fire the side effect twice
// (a guest getting the welcome WhatsApp again). Now only one caller wins the create;
// everyone else gets P2002 and skips. Trade-off: a crash after claim but before the
// action leaves a "pending" row and the action is not retried (at-most-once) — the
// right choice for outbound sends, where a duplicate is worse than a rare miss.
async function claimExecution(data: {
  tenantId: string; ruleId: string; ruleCode: string;
  triggerType: string; triggerEntityId: string; actionType: string;
}): Promise<boolean> {
  try {
    await prisma.automationExecution.create({ data: { ...data, actionResult: "pending" } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false; // already claimed
    throw err;
  }
}

// Finalise a claimed execution with its outcome. The row already exists (claimed).
async function finalizeExecution(ruleId: string, triggerEntityId: string, actionResult: ActionResult, resultDetail?: string) {
  await prisma.automationExecution.updateMany({ where: { ruleId, triggerEntityId }, data: { actionResult, resultDetail } });
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
      if (!(await claimExecution({
        tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
        triggerType: "sla_breach", triggerEntityId: sr.id, actionType: "escalate_sr",
      }))) continue;

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
        await finalizeExecution(rule.id, sr.id, "success", `Escalated: ${sr.summary.slice(0, 80)}`);
      } catch (err) {
        await finalizeExecution(rule.id, sr.id, "failed", err instanceof Error ? err.message : "Unknown error");
      }
    }
  }
}

// ── Rule 2: Negative sentiment → create review SR ─────────────────────────────

export async function evaluateSentimentLowFlag() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "sentiment_low_flag", isActive: true },
    select: { id: true, tenantId: true, code: true, tenant: { select: { industry: true } } }
  });

  for (const rule of rules) {
    // The auto-created SR's category and SLA come from the tenant's industry pack
    // (#159) rather than hardcoded hospitality values.
    const pack = getIntakePack(rule.tenant?.industry ?? null);
    const negativeEvents = await prisma.connectorEvent.findMany({
      where: { tenantId: rule.tenantId, aiSentiment: "negative", guestId: { not: null } },
      select: { id: true, guestId: true, guestName: true, aiSummary: true }
    });

    for (const event of negativeEvents) {
      if (!event.guestId) continue;
      if (!(await claimExecution({
        tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
        triggerType: "sentiment_low", triggerEntityId: event.id, actionType: "create_sr",
      }))) continue;

      try {
        const sr = await prisma.serviceRequest.create({
          data: {
            tenantId: rule.tenantId,
            guestId: event.guestId,
            category: pack.defaultCategory,
            summary: `Negative sentiment flagged — review required: ${(event.aiSummary ?? "Review required").slice(0, 100)}`,
            status: "open",
            priority: "high",
            source: "automation",
            slaDueAt: new Date(Date.now() + pack.sla.autoMinutes * 60000)
          }
        });
        await finalizeExecution(rule.id, event.id, "success", `Created SR ${sr.id} for ${event.guestName ?? event.guestId}`);
      } catch (err) {
        await finalizeExecution(rule.id, event.id, "failed", err instanceof Error ? err.message : "Unknown error");
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
      // Claim BEFORE sending so a crash/two-instances can't send the welcome twice.
      if (!(await claimExecution({
        tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
        triggerType: "checkin_welcome", triggerEntityId: stay.id, actionType: "send_whatsapp",
      }))) continue;

      const { guest } = stay;

      // Anti-spam guardrails (#168): the welcome is an AUTOMATED, business-initiated
      // send, so it faces opt-out + quiet-hours + daily-cap. A blocked send finalises
      // the (already-claimed) execution as "skipped" so it is never retried.
      const guard = await evaluateOutboundSend({ tenantId: rule.tenantId, phone: guest.phoneE164, kind: "automated" });
      if (!guard.allowed) {
        await finalizeExecution(rule.id, stay.id, "skipped", `Suppressed: ${guard.reason}`);
        continue;
      }

      const firstName = guest.fullName.split(" ")[0] ?? guest.fullName;
      const message = `Welcome to ${brandName}, ${firstName}! We're delighted to have you in Room ${stay.roomNumber}. Need anything during your stay? Just WhatsApp us anytime — The ${brandName} Team`;

      try {
        const result = await sendWhatsAppReply(rule.tenantId, guest.phoneE164, message);
        if (result.sent) await recordAutomatedSend(rule.tenantId, guest.phoneE164, rule.code);
        await finalizeExecution(rule.id, stay.id, result.sent ? "success" : "failed",
          result.sent ? `Welcome sent to ${guest.phoneE164}` : (result.error ?? "Send failed"));
      } catch (err) {
        await finalizeExecution(rule.id, stay.id, "failed", err instanceof Error ? err.message : "Unknown error");
      }
    }
  }
}

// ── Rule 4: SR resolved in last 2h → queue upsell offer ──────────────────────

export async function evaluateUpsellFollowup() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "upsell_followup", isActive: true },
    select: { id: true, tenantId: true, code: true, tenant: { select: { industry: true } } }
  });

  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60000);

  for (const rule of rules) {
    // Offer type per resolved-request category comes from the tenant's industry
    // pack (#159), defaulting when the category has no specific mapping.
    const pack = getIntakePack(rule.tenant?.industry ?? null);
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
      if (!(await claimExecution({
        tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
        triggerType: "upsell_followup", triggerEntityId: sr.id, actionType: "queue_offer",
      }))) continue;

      const offerType = packLookup(pack.offerRouting.byCategory, sr.category, pack.offerRouting.default);

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
        await finalizeExecution(rule.id, sr.id, "success", `Queued ${offerType} offer`);
      } catch (err) {
        await finalizeExecution(rule.id, sr.id, "failed", err instanceof Error ? err.message : "Unknown error");
      }
    }
  }
}

// ── Rule 5: Deal enters a stage → auto-run research (RS-3) ────────────────────

// One AutomationRule per tenant (code "research_on_stage") holds a list of
// stage→template triggers in its config (the rule table is unique per tenant+code).
// For each configured stage we enqueue a research run for every open deal in that
// stage, once per (stage, deal) via the idempotency record. The research worker
// then processes the queued runs and logs results back to the deal timeline.
export async function evaluateResearchOnStage() {
  const rules = await prisma.automationRule.findMany({
    where: { code: "research_on_stage", isActive: true },
    select: { id: true, tenantId: true, code: true, configJson: true }
  });

  for (const rule of rules) {
    let triggers: Array<{ stageId: string; templateId: string; fast?: boolean }> = [];
    try {
      const cfg = JSON.parse(rule.configJson) as { triggers?: Array<{ stageId: string; templateId: string; fast?: boolean }> };
      triggers = Array.isArray(cfg.triggers) ? cfg.triggers : [];
    } catch { triggers = []; }

    for (const trig of triggers) {
      if (!trig.stageId || !trig.templateId) continue;

      const deals = await prisma.deal.findMany({
        where: { tenantId: rule.tenantId, stageId: trig.stageId, status: "open" },
        select: { id: true, title: true, company: { select: { name: true, domain: true } } }
      });
      if (deals.length === 0) continue;

      const tpl = await loadTemplateForRun(rule.tenantId, trig.templateId);

      for (const deal of deals) {
        const triggerEntityId = `${trig.stageId}:${deal.id}`;
        if (!(await claimExecution({
          tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
          triggerType: "deal_stage", triggerEntityId, actionType: "enqueue_research",
        }))) continue;

        if (!tpl) {
          await finalizeExecution(rule.id, triggerEntityId, "skipped", `Template ${trig.templateId} not found`);
          continue;
        }

        try {
          // Prefer the linked company (name + domain) for richer research; fall back to the deal title.
          const name = deal.company?.name ?? deal.title;
          const inputs = { name, website: deal.company?.domain ?? "" };
          const def = trig.fast === false ? tpl.def : { ...tpl.def, fast: true };
          await prisma.researchRun.create({
            data: {
              tenantId: rule.tenantId,
              templateId: trig.templateId.startsWith("builtin:") ? null : trig.templateId,
              templateName: tpl.name,
              templateSnapshot: JSON.stringify(def),
              subjectType: "deal",
              subjectId: deal.id,
              subjectLabel: deal.title,
              inputsJson: JSON.stringify(inputs),
              status: "queued"
            }
          });
          await finalizeExecution(rule.id, triggerEntityId, "success", `Queued research for "${deal.title}"`);
        } catch (err) {
          await finalizeExecution(rule.id, triggerEntityId, "failed", err instanceof Error ? err.message : "Unknown error");
        }
      }
    }
  }
}

// ── Sweep: sent quotes past validUntil → expired ──────────────────────────────

// Not rule-table driven: expiry is an intrinsic property of a quote (its
// validUntil), not an opt-in automation, and the status-filtered updateMany is
// idempotent — so no per-tenant rules and no claim records are needed.
export async function evaluateQuoteExpiry() {
  const count = await expireOverdueQuotes();
  if (count > 0) console.log(`[AutomationEngine] Expired ${count} overdue quote(s)`);
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
      evaluateUpsellFollowup(),
      evaluateResearchOnStage(),
      evaluateQuoteExpiry()
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
