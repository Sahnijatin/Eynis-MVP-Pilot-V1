// Post-call follow-up (Phase 7).
//
// After a call ends, fire the channels configured for its outcome in
// campaign.followUpRules (e.g. { interested: ["whatsapp","email"] }). Reuses the
// SAME sender registry as the dispatch engine — no duplicate send logic — and
// records each follow-up as a MessageDelivery. Never fires for opted-out leads.

import { prisma } from "../../db/prisma";
import { broadcastSSEEvent } from "../../sse/clients";
import { getSender, type SendContext } from "./senders";

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
    prisma.hotel.findUnique({ where: { id: call.hotelId }, select: { name: true } }),
  ]);
  if (!campaign || !lead) return { sent };
  if (lead.optedOut || lead.status === "opted_out") return { sent }; // never follow up an opt-out

  const channels = channelsForOutcome(campaign.followUpRules, call.outcome);
  for (const channel of channels) {
    const sender = resolveSender(channel);
    if (!sender) continue;

    const ctx: SendContext = {
      hotelId: call.hotelId,
      tenantName: tenant?.name ?? null,
      campaign: {
        name: campaign.name, calendlyLink: campaign.calendlyLink,
        whatsappContentSid: campaign.whatsappContentSid, whatsappTemplateBody: campaign.whatsappTemplateBody,
        whatsappVariables: safeArray(campaign.whatsappVariables),
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
        hotelId: call.hotelId, campaignId: call.campaignId, leadId: call.leadId, channel,
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
    broadcastSSEEvent({ type: "campaign_followup_sent", hotelId: call.hotelId, campaignId: call.campaignId, leadId: call.leadId, channels: sent });
  }
  return { sent };
}
