// Execute self-serve "New Flow" custom journey automations (apps/.../flow.ts).
//
// A custom flow is an AutomationRule whose configJson is { ruleType: "marketing",
// custom: true, trigger, action, channels, delayHours, detail }. The engine resolves
// the entities currently matching the flow's trigger, then performs its action — each
// claimed once per (rule, entity) via the same claim-first idempotency the built-in
// rules use, so a flow fires at most once per matching entity. Outbound sends go
// through the standard opt-out / quiet-hours / daily-cap guardrails.
//
// Because a custom flow is ruleType "marketing", every finalized AutomationExecution
// row is already counted by GET /automations (executions = live rows, conversions =
// successful rows), so the UI's numbers move without any extra bookkeeping here.

import { Prisma } from "@prisma/client";
import { prisma } from "../../db/prisma";
import { sendWhatsAppReply } from "../connectors/whatsapp-outbound";
import { evaluateOutboundSend, recordAutomatedSend } from "../connectors/messaging-guardrails";
import { resolveResendCredentials, isResendConfigured, sendFollowUpEmail } from "../email/resend";
import { enrollContactInSequence } from "../campaigns/enroll";

type ActionResult = "success" | "failed" | "skipped" | "pending";

// Per-flow, per-cycle cap — bounds a burst when a flow first goes live over a large
// backlog; the remainder is picked up on subsequent 60s cycles.
const MAX_ENTITIES_PER_CYCLE = 25;

// Default wait windows for time-based triggers when the flow leaves delayHours at 0.
const DEFAULT_DELAY_HOURS: Record<string, number> = {
  quote_no_response: 72, // 3 days
  contact_dormant: 24 * 30, // 30 days
};

interface FlowConfig {
  trigger: string;
  action: string;
  channels: string[];
  delayHours: number;
  detail: string | null;
  sequenceId: string | null;
}

interface TriggerEntity {
  entityId: string;
  contactId: string | null;
  phone: string | null;
  email: string | null;
  name: string;
  label: string;
}

async function claimExecution(data: {
  tenantId: string; ruleId: string; ruleCode: string;
  triggerType: string; triggerEntityId: string; actionType: string;
}): Promise<boolean> {
  try {
    await prisma.automationExecution.create({ data: { ...data, actionResult: "pending" } });
    return true;
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") return false;
    throw err;
  }
}

async function finalizeExecution(ruleId: string, triggerEntityId: string, actionResult: ActionResult, resultDetail?: string) {
  await prisma.automationExecution.updateMany({ where: { ruleId, triggerEntityId }, data: { actionResult, resultDetail } });
}

const firstNameOf = (name: string) => name.split(" ")[0] || name;

// ── Trigger → matching entities ────────────────────────────────────────────────
// `since` scopes event-style triggers to things that happened AFTER the flow was
// created, so switching a flow on never retroactively actions the whole back-catalogue.
export async function resolveTriggerEntities(
  tenantId: string, trigger: string, delayHours: number, since: Date,
): Promise<TriggerEntity[]> {
  const now = new Date();
  const take = MAX_ENTITIES_PER_CYCLE;
  const contactSel = { id: true, fullName: true, phoneE164: true, email: true } as const;
  const mapContact = (c: { id: string; fullName: string; phoneE164: string | null; email: string | null }): TriggerEntity =>
    ({ entityId: c.id, contactId: c.id, phone: c.phoneE164, email: c.email, name: c.fullName, label: c.fullName });

  switch (trigger) {
    case "new_lead": {
      const rows = await prisma.contact.findMany({ where: { tenantId, createdAt: { gte: since } }, select: contactSel, orderBy: { createdAt: "asc" }, take });
      return rows.map(mapContact);
    }
    case "contact_dormant": {
      const cutoff = new Date(now.getTime() - (delayHours || DEFAULT_DELAY_HOURS.contact_dormant) * 3600_000);
      const rows = await prisma.contact.findMany({ where: { tenantId, lastActivityAt: { not: null, lte: cutoff } }, select: contactSel, orderBy: { lastActivityAt: "asc" }, take });
      return rows.map(mapContact);
    }
    case "quote_sent":
    case "quote_no_response": {
      const olderThan = trigger === "quote_no_response"
        ? new Date(now.getTime() - (delayHours || DEFAULT_DELAY_HOURS.quote_no_response) * 3600_000)
        : now;
      const rows = await prisma.quote.findMany({
        where: { tenantId, status: "sent", sentAt: { gte: since, lte: olderThan } },
        select: { id: true, number: true, title: true, contact: { select: { id: true, fullName: true, phoneE164: true, email: true } } }, orderBy: { sentAt: "asc" }, take,
      });
      return rows.map((q) => ({ entityId: q.id, contactId: q.contact?.id ?? null, phone: q.contact?.phoneE164 ?? null, email: q.contact?.email ?? null, name: q.contact?.fullName ?? q.title, label: `${q.number} · ${q.title}` }));
    }
    case "deal_won":
    case "deal_lost": {
      const rows = await prisma.deal.findMany({
        where: { tenantId, status: trigger === "deal_won" ? "won" : "lost", closedAt: { gte: since } },
        select: { id: true, title: true, contact: { select: { id: true, fullName: true, phoneE164: true, email: true } } }, orderBy: { closedAt: "asc" }, take,
      });
      return rows.map((d) => ({ entityId: d.id, contactId: d.contact?.id ?? null, phone: d.contact?.phoneE164 ?? null, email: d.contact?.email ?? null, name: d.contact?.fullName ?? d.title, label: d.title }));
    }
    case "deal_stage_changed": {
      const rows = await prisma.dealTransition.findMany({
        where: { tenantId, createdAt: { gte: since } },
        select: { id: true, deal: { select: { title: true, contact: { select: { id: true, fullName: true, phoneE164: true, email: true } } } } }, orderBy: { createdAt: "asc" }, take,
      });
      return rows.map((tr) => ({ entityId: tr.id, contactId: tr.deal.contact?.id ?? null, phone: tr.deal.contact?.phoneE164 ?? null, email: tr.deal.contact?.email ?? null, name: tr.deal.contact?.fullName ?? tr.deal.title, label: `${tr.deal.title} · stage change` }));
    }
    case "order_delivered": {
      // Order has a contactId column but no `contact` relation — load contacts by id.
      const rows = await prisma.order.findMany({
        where: { tenantId, stage: "delivered", updatedAt: { gte: since } },
        select: { id: true, number: true, contactId: true }, orderBy: { updatedAt: "asc" }, take,
      });
      const ids = [...new Set(rows.map((o) => o.contactId).filter((v): v is string => !!v))];
      const contacts = ids.length
        ? await prisma.contact.findMany({ where: { tenantId, id: { in: ids } }, select: contactSel })
        : [];
      const byId = new Map(contacts.map((c) => [c.id, c]));
      return rows.map((o) => {
        const c = o.contactId ? byId.get(o.contactId) : undefined;
        return { entityId: o.id, contactId: c?.id ?? null, phone: c?.phoneE164 ?? null, email: c?.email ?? null, name: c?.fullName ?? o.number, label: `Order ${o.number}` };
      });
    }
    case "task_overdue": {
      const rows = await prisma.activity.findMany({
        where: { tenantId, type: "task", status: "open", dueAt: { gte: since, lt: now } },
        select: { id: true, title: true, contact: { select: { id: true, fullName: true, phoneE164: true, email: true } } }, orderBy: { dueAt: "asc" }, take,
      });
      return rows.map((a) => ({ entityId: a.id, contactId: a.contact?.id ?? null, phone: a.contact?.phoneE164 ?? null, email: a.contact?.email ?? null, name: a.contact?.fullName ?? a.title, label: a.title }));
    }
    default:
      return [];
  }
}

// ── Action → side effect ───────────────────────────────────────────────────────
async function runFlowAction(
  tenantId: string, ruleCode: string, cfg: FlowConfig, entity: TriggerEntity, brandName: string,
): Promise<{ result: ActionResult; detail: string }> {
  switch (cfg.action) {
    case "send_whatsapp":
    case "ask_review": {
      if (!entity.phone) return { result: "skipped", detail: "No phone number on the contact" };
      const guard = await evaluateOutboundSend({ tenantId, phone: entity.phone, kind: "automated" });
      if (!guard.allowed) return { result: "skipped", detail: `Suppressed: ${guard.reason}` };
      const first = firstNameOf(entity.name);
      const message = cfg.action === "ask_review"
        ? `Hi ${first}, thanks for choosing ${brandName}! Could you share quick feedback on your experience? It really helps us. — Team ${brandName}`
        : (cfg.detail?.trim() || `Hi ${first}, a quick note from ${brandName}. Reply here anytime — we're happy to help.`);
      const send = await sendWhatsAppReply(tenantId, entity.phone, message);
      if (send.sent) await recordAutomatedSend(tenantId, entity.phone, ruleCode);
      return send.sent
        ? { result: "success", detail: `WhatsApp sent to ${entity.phone}` }
        : { result: "failed", detail: send.error ?? "Send failed" };
    }
    case "send_email": {
      if (!entity.email) return { result: "skipped", detail: "No email on the contact" };
      const creds = await resolveResendCredentials(tenantId);
      if (!isResendConfigured(creds)) return { result: "skipped", detail: "Email channel not configured (Resend)" };
      const first = firstNameOf(entity.name);
      const body = cfg.detail?.trim() || `Hi {firstName}, a quick update from ${brandName}. Reply anytime — we're happy to help.`;
      const send = await sendFollowUpEmail(creds, {
        to: entity.email,
        subjectTemplate: `A note from ${brandName}`,
        htmlTemplate: body,
        vars: { firstName: first, brand: brandName },
      });
      return send.sent
        ? { result: "success", detail: `Email sent to ${entity.email}` }
        : { result: send.error?.includes("not configured") ? "skipped" : "failed", detail: send.error ?? "Send failed" };
    }
    // Enroll the contact into a multi-step drip Sequence (WhatsApp + email, auto-stops
    // when the customer replies). Uses the flow's chosen sequence, else the tenant's
    // first active one. With no contact or no sequence available, falls back to a
    // tracked follow-up task so the flow still produces an actionable record.
    case "multi_touch_followup":
    case "nurture_drip": {
      if (entity.contactId) {
        const enrolled = await enrollContactInSequence(tenantId, entity.contactId, {
          sequenceId: cfg.sequenceId, campaignName: "Automation Follow-up", consentSource: "automation_flow",
        });
        if (enrolled.enrolled) return { result: "success", detail: `Enrolled ${entity.label} in "${enrolled.sequenceName}"` };
        if (enrolled.reason === "already enrolled") return { result: "skipped", detail: `Already enrolled in "${enrolled.sequenceName}"` };
        // No usable sequence (or none configured) → fall through to the task fallback.
      }
      await prisma.activity.create({
        data: {
          tenantId, contactId: entity.contactId, userId: null, type: "task", status: "open",
          title: `Start follow-up sequence: ${entity.label}`.slice(0, 300),
          body: cfg.detail ?? "No active sequence to enroll into — follow up manually or create one in Sequences.",
          dueAt: new Date(Date.now() + 24 * 3600_000),
        },
      });
      return { result: "success", detail: `Queued follow-up task for ${entity.label} (no active sequence)` };
    }
    // Internal actions — create a tracked follow-up task (and, for notify_team, an
    // audit entry) so the flow produces a real, actionable record every time.
    case "create_task":
    case "notify_team": {
      const titlePrefix = cfg.action === "notify_team" ? "Team follow-up" : "Follow-up";
      await prisma.activity.create({
        data: {
          tenantId, contactId: entity.contactId, userId: null, type: "task", status: "open",
          title: `${titlePrefix}: ${entity.label}`.slice(0, 300),
          body: cfg.detail ?? null,
          dueAt: new Date(Date.now() + 24 * 3600_000), // due tomorrow by default
        },
      });
      if (cfg.action === "notify_team") {
        await prisma.auditLog.create({
          data: { tenantId, actorRole: "automation", action: "flow_notify_team", entityType: "contact", entityId: entity.contactId ?? entity.entityId, metadata: JSON.stringify({ rule: ruleCode, label: entity.label.slice(0, 120) }) },
        });
      }
      return { result: "success", detail: `Created task for ${entity.label}` };
    }
    default:
      return { result: "skipped", detail: `Unknown action "${cfg.action}"` };
  }
}

function parseFlowConfig(configJson: string): FlowConfig | null {
  try {
    const c = JSON.parse(configJson) as Record<string, unknown>;
    if (c.custom !== true || c.ruleType !== "marketing" || typeof c.trigger !== "string" || typeof c.action !== "string") return null;
    return {
      trigger: c.trigger,
      action: c.action,
      channels: Array.isArray(c.channels) ? (c.channels as string[]) : [],
      delayHours: typeof c.delayHours === "number" ? c.delayHours : 0,
      detail: typeof c.detail === "string" ? c.detail : null,
      sequenceId: typeof c.sequenceId === "string" && c.sequenceId ? c.sequenceId : null,
    };
  } catch {
    return null;
  }
}

// ── Public: evaluate every active custom flow ──────────────────────────────────
export async function evaluateCustomFlows(): Promise<void> {
  const rules = await prisma.automationRule.findMany({
    where: { isActive: true },
    select: { id: true, tenantId: true, code: true, configJson: true, createdAt: true, tenant: { select: { name: true, branding: { select: { brandName: true } } } } },
  });

  for (const rule of rules) {
    const cfg = parseFlowConfig(rule.configJson);
    if (!cfg) continue; // not a custom flow (operational/other rule)

    let entities: TriggerEntity[];
    try {
      entities = await resolveTriggerEntities(rule.tenantId, cfg.trigger, cfg.delayHours, rule.createdAt);
    } catch (err) {
      console.error(`[CustomFlows] resolve failed for ${rule.code}:`, err instanceof Error ? err.message : err);
      continue;
    }
    if (entities.length === 0) continue;

    const brandName = rule.tenant?.branding?.brandName?.trim() || rule.tenant?.name?.trim() || "us";

    for (const entity of entities) {
      // Claim BEFORE acting so a crash / two instances can't double-fire the action.
      if (!(await claimExecution({
        tenantId: rule.tenantId, ruleId: rule.id, ruleCode: rule.code,
        triggerType: cfg.trigger, triggerEntityId: entity.entityId, actionType: cfg.action,
      }))) continue;

      try {
        const { result, detail } = await runFlowAction(rule.tenantId, rule.code, cfg, entity, brandName);
        await finalizeExecution(rule.id, entity.entityId, result, detail);
      } catch (err) {
        await finalizeExecution(rule.id, entity.entityId, "failed", err instanceof Error ? err.message : "Unknown error");
      }
    }
  }
}
