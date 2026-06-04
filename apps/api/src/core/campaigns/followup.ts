// Post-call follow-up (Phase 7).
//
// After a call ends, fire the channels configured for its outcome in
// campaign.followUpRules (e.g. { interested: ["whatsapp","email"] }). Reuses the
// SAME sender registry as the dispatch engine — no duplicate send logic — and
// records each follow-up as a MessageDelivery. Never fires for opted-out leads.

import { prisma } from "../../db/prisma";
import { broadcastSSEEvent } from "../../sse/clients";
import { getSender, type SendContext } from "./senders";
import { resolveApprovedWhatsappTemplate } from "./whatsapp-template";

const safeObject = (json: string): Record<string, string[]> => {
  try { const v = JSON.parse(json); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
};
const safeArray = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

export interface FollowUpDeps {
  resolveSender?: typeof getSender;
}

// Resolves which channels to fire for a given outcome and sends them.
export function channelsForOutcome(followUpRulesJson: string, outcome: string | null): string[] {
  if (!outcome) return [];
  const rules = safeObject(followUpRulesJson);
  return (rules[outcome] ?? []).filter((c) => c === "whatsapp" || c === "email");
}

export async function handlePostCallFollowUp(callRecordId: string, deps: FollowUpDeps = {}): Promise<{ sent: string[] }> {
  const resolveSender = deps.resolveSender ?? getSender;
  const sent: string[] = [];

  const call = await prisma.callRecord.findUnique({ where: { id: callRecordId } });
  if (!call || !call.outcome) return { sent };

  const [campaign, lead, tenant] = await Promise.all([
    prisma.voiceCampaign.findUnique({ where: { id: call.campaignId } }),
    prisma.campaignLead.findUnique({ where: { id: call.leadId } }),
    prisma.tenant.findUnique({ where: { id: call.tenantId }, select: { name: true } }),
  ]);
  if (!campaign || !lead) return { sent };
  if (lead.optedOut || lead.status === "opted_out") return { sent }; // never follow up an opt-out

  const channels = channelsForOutcome(campaign.followUpRules, call.outcome);
  for (const channel of channels) {
    // Idempotency: a re-delivered end-of-call webhook must not re-send. The
    // per-channel flags on the call record mark what's already gone out (F-14).
    if (channel === "whatsapp" && call.whatsappSent) continue;
    if (channel === "email" && call.emailSent) continue;

    const sender = resolveSender(channel);
    if (!sender) continue;

    // Durable suppression — honour the tenant-wide DoNotContact (phone) and email
    // suppression lists, exactly like the dispatcher does (F-14: previously the
    // follow-up only checked lead.optedOut).
    if (channel === "whatsapp") {
      if (!lead.phone) continue;
      const dnc = await prisma.doNotContact.findUnique({ where: { tenantId_phone: { tenantId: call.tenantId, phone: lead.phone } }, select: { id: true } });
      if (dnc) continue;
    }
    if (channel === "email") {
      if (!lead.email) continue;
      const sup = await prisma.emailSuppression.findUnique({ where: { tenantId_email: { tenantId: call.tenantId, email: lead.email.trim().toLowerCase() } }, select: { id: true } });
      if (sup) continue;
    }

    // WhatsApp: enforce the approved library template, same as dispatch — Meta
    // forbids un-approved business-initiated sends (F-14).
    let whatsappContentSid = campaign.whatsappContentSid;
    let whatsappTemplateBody = campaign.whatsappTemplateBody;
    let whatsappVariables = safeArray(campaign.whatsappVariables);
    if (channel === "whatsapp" && campaign.whatsappTemplateId) {
      const resolved = await resolveApprovedWhatsappTemplate(campaign.whatsappTemplateId);
      if (!resolved) continue; // template no longer approved → skip this channel
      whatsappContentSid = resolved.contentSid;
      whatsappTemplateBody = resolved.body;
      whatsappVariables = resolved.variables;
    }

    const ctx: SendContext = {
      tenantId: call.tenantId,
      tenantName: tenant?.name ?? null,
      campaign: {
        name: campaign.name, calendlyLink: campaign.calendlyLink,
        whatsappContentSid, whatsappTemplateBody, whatsappVariables,
        emailSubjectTemplate: campaign.emailSubjectTemplate, emailBodyTemplate: campaign.emailBodyTemplate,
      },
      lead: {
        firstName: lead.firstName, lastName: lead.lastName, phone: lead.phone, email: lead.email,
        company: lead.company, jobTitle: lead.jobTitle, rawData: lead.rawData,
      },
    };
    const result = await sender.send(ctx);
    await prisma.messageDelivery.create({
      data: {
        tenantId: call.tenantId, campaignId: call.campaignId, leadId: call.leadId, channel,
        status: result.ok ? "sent" : "failed",
        providerId: result.providerId, renderedSubject: result.renderedSubject,
        renderedBody: result.renderedBody, error: result.error, sentAt: result.ok ? new Date() : null,
      },
    });
    if (result.ok) {
      sent.push(channel);
      await prisma.callRecord.update({
        where: { id: callRecordId },
        data: channel === "whatsapp" ? { whatsappSent: true } : { emailSent: true },
      });
    }
  }

  if (sent.length > 0) {
    broadcastSSEEvent(call.tenantId, { type: "campaign_followup_sent", tenantId: call.tenantId, campaignId: call.campaignId, leadId: call.leadId, channels: sent });
  }
  return { sent };
}
