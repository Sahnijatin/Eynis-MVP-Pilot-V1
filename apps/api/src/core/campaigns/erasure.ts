// GDPR/DPDP erasure for campaign data (Phase 8). Shreds a person's PII across
// every campaign surface — lead fields, call transcripts/summaries, sentiment
// utterances, WhatsApp threads, rendered message bodies — while KEEPING the rows
// so aggregate analytics (counts, outcomes, A/B stats) stay truthful. The phone
// (if known) is added to DoNotContact before it is erased, so the person can
// never be re-imported and re-contacted. Audit-logged with counts only — the
// audit trail itself must not retain the PII being erased.

import { prisma } from "../../db/prisma";

export interface ErasureCounts {
  leads: number;
  callRecords: number;
  sentimentEvents: number;
  conversations: number;
  whatsappMessages: number;
  deliveries: number;
}

export type ErasureResult =
  | { ok: true; counts: ErasureCounts }
  | { ok: false; status: number; error: string };

const ERASED = "[erased]";

export async function eraseCampaignLeadPII(
  tenantId: string,
  selector: { leadId?: string | null; phone?: string | null; email?: string | null },
  actorId?: string | null,
): Promise<ErasureResult> {
  const leadId = selector.leadId?.trim() || null;
  const phone = selector.phone?.trim() || null;
  const email = selector.email?.trim().toLowerCase() || null;
  if (!leadId && !phone && !email) {
    return { ok: false, status: 400, error: "Provide leadId, phone, or email" };
  }

  // Resolve every matching lead in the tenant (a person can exist in several
  // campaigns — erasure means ALL of them).
  const leads = await prisma.campaignLead.findMany({
    where: {
      tenantId,
      ...(leadId
        ? { id: leadId }
        : phone
          ? { phone }
          : { email: { equals: email!, mode: "insensitive" } }),
    },
    select: { id: true, phone: true },
  });
  if (leads.length === 0) return { ok: false, status: 404, error: "No matching leads" };
  const leadIds = leads.map((l) => l.id);

  // Suppress-then-erase: record every known phone in DoNotContact FIRST, so even
  // a failure halfway leaves the person uncontactable.
  const phones = [...new Set([...leads.map((l) => l.phone), phone].filter((v): v is string => Boolean(v)))];
  for (const p of phones) {
    await prisma.doNotContact.upsert({
      where: { tenantId_phone: { tenantId, phone: p } },
      update: { reason: "gdpr_erasure" },
      create: { tenantId, phone: p, reason: "gdpr_erasure" },
    });
  }

  const calls = await prisma.callRecord.findMany({ where: { tenantId, leadId: { in: leadIds } }, select: { id: true } });
  const callIds = calls.map((c) => c.id);
  const conversations = await prisma.whatsappConversation.findMany({ where: { tenantId, leadId: { in: leadIds } }, select: { id: true } });
  const conversationIds = conversations.map((c) => c.id);

  const [leadsRes, callsRes, sentimentRes, convRes, msgRes, deliveryRes] = await prisma.$transaction([
    prisma.campaignLead.updateMany({
      where: { id: { in: leadIds } },
      data: {
        firstName: "Erased", lastName: null, phone: null, email: null,
        company: null, jobTitle: null, rawData: "{}", tags: [], optedOut: true,
      },
    }),
    prisma.callRecord.updateMany({
      where: { id: { in: callIds } },
      data: { transcript: null, aiSummary: null, keyPoints: "[]" },
    }),
    prisma.sentimentEvent.updateMany({
      where: { tenantId, callRecordId: { in: callIds } },
      data: { text: ERASED },
    }),
    prisma.whatsappConversation.updateMany({
      where: { id: { in: conversationIds } },
      data: { threadSummary: null },
    }),
    prisma.whatsappMessage.updateMany({
      where: { conversationId: { in: conversationIds } },
      data: { body: ERASED },
    }),
    prisma.messageDelivery.updateMany({
      where: { tenantId, leadId: { in: leadIds } },
      data: { renderedSubject: null, renderedBody: null },
    }),
  ]);

  const counts: ErasureCounts = {
    leads: leadsRes.count, callRecords: callsRes.count, sentimentEvents: sentimentRes.count,
    conversations: convRes.count, whatsappMessages: msgRes.count, deliveries: deliveryRes.count,
  };

  await prisma.auditLog.create({
    data: {
      tenantId, actorRole: "staff", action: "campaign_lead_erasure", entityType: "campaign_lead",
      entityId: leadIds.length === 1 ? leadIds[0] : null,
      metadata: JSON.stringify({ counts, dncAdded: phones.length, actorId: actorId ?? null }),
    },
  });

  return { ok: true, counts };
}
