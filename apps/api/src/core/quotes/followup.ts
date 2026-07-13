// Quote-sent → follow-up wiring.
//
// Solves the customer's real bottleneck ("we send a quote and forget to follow
// up"). Two things happen when a quote is sent:
//   1. Always: log a CRM Activity task ("Follow up on quote …") so it's visible in
//      the timeline even if no drip sequence is configured (the demo-safe fallback).
//   2. If the tenant has an active "Quote follow-up" sequence and the quote has a
//      contact, enroll that contact into the existing multi-channel drip engine
//      (WhatsApp + email, auto-stops when the customer replies). The drip engine
//      keys enrollment on CampaignLead, so we find-or-create a lead for the contact
//      in a dedicated "Quote Follow-up" campaign, then reuse the standard enrollment
//      path (core/campaigns/sequence-runner drives it from there).
//
// Everything here is best-effort and never throws into the send handler — a
// follow-up failure must not block sending the quote.

import { prisma } from "../../db/prisma";
import { nextRunFrom } from "../campaigns/sequences";

const FOLLOWUP_CAMPAIGN_NAME = "Quote Follow-up";

export interface FollowupResult {
  activityLogged: boolean;
  enrolled: boolean;
  sequenceId?: string;
  reason?: string;
}

// Find the tenant's designated quote follow-up sequence: an active sequence whose
// name mentions "quote" (seeded as "Quote follow-up"). Returns null if none — the
// tenant just hasn't set up a drip yet, which is fine (the Activity task still logs).
async function findQuoteSequence(tenantId: string) {
  return prisma.sequence.findFirst({
    where: { tenantId, status: "active", name: { contains: "quote", mode: "insensitive" } },
    orderBy: { createdAt: "asc" },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
}

// Find-or-create a CampaignLead for this contact in the dedicated follow-up
// campaign. The lead carries the send-window context the sequence runner reads.
async function findOrCreateLead(tenantId: string, contact: { id: string; fullName: string; phoneE164: string; email: string | null }) {
  const existing = await prisma.campaignLead.findFirst({
    where: { tenantId, contactId: contact.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Ensure the "Quote Follow-up" campaign exists (multi-channel, active).
  let campaign = await prisma.voiceCampaign.findFirst({ where: { tenantId, name: FOLLOWUP_CAMPAIGN_NAME }, select: { id: true } });
  if (!campaign) {
    campaign = await prisma.voiceCampaign.create({
      data: { tenantId, name: FOLLOWUP_CAMPAIGN_NAME, status: "active", channels: JSON.stringify(["whatsapp", "email"]) },
      select: { id: true },
    });
  }

  const [firstName, ...rest] = contact.fullName.trim().split(/\s+/);
  const lead = await prisma.campaignLead.create({
    data: {
      campaignId: campaign.id,
      tenantId,
      firstName: firstName || contact.fullName || "Customer",
      lastName: rest.join(" ") || null,
      phone: contact.phoneE164 || null,
      email: contact.email,
      contactId: contact.id,
      // The customer just requested/received a quote from us — legitimate-interest
      // consent for transactional follow-up on the quote they asked for.
      consent: true,
      consentSource: "quote_request",
    },
    select: { id: true },
  });
  return lead.id;
}

export async function runQuoteFollowup(
  tenantId: string,
  quote: { id: string; number: string; title: string; contactId: string | null; dealId: string | null; createdById: string | null; publicUrl?: string | null },
): Promise<FollowupResult> {
  const result: FollowupResult = { activityLogged: false, enrolled: false };

  // 1. Always log a CRM follow-up task.
  try {
    await prisma.activity.create({
      data: {
        tenantId,
        contactId: quote.contactId,
        dealId: quote.dealId,
        userId: quote.createdById,
        type: "task",
        title: `Follow up on quote ${quote.number}`,
        body: `Quote "${quote.title}" was sent. Follow up if the customer hasn't responded.`
          + (quote.publicUrl ? ` Customer link: ${quote.publicUrl}` : ""),
        status: "open",
        dueAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), // +2 days
      },
    });
    result.activityLogged = true;
  } catch {
    /* best-effort */
  }

  // 2. Enroll into the drip sequence if configured and we have a contact.
  if (!quote.contactId) { result.reason = "no contact linked"; return result; }
  try {
    const sequence = await findQuoteSequence(tenantId);
    if (!sequence || sequence.steps.length === 0) { result.reason = "no active quote follow-up sequence"; return result; }
    const contact = await prisma.contact.findFirst({
      where: { id: quote.contactId, tenantId },
      select: { id: true, fullName: true, phoneE164: true, email: true },
    });
    if (!contact) { result.reason = "contact not found"; return result; }

    const leadId = await findOrCreateLead(tenantId, contact);
    const nextRunAt = nextRunFrom(new Date(), sequence.steps[0].waitMinutes);
    const enrollment = await prisma.sequenceEnrollment.createMany({
      data: [{ sequenceId: sequence.id, tenantId, leadId, currentStepOrder: 0, nextRunAt }],
      skipDuplicates: true, // idempotent: re-sending won't double-enroll
    });
    result.enrolled = enrollment.count > 0;
    result.sequenceId = sequence.id;
    if (!result.enrolled) result.reason = "already enrolled";
  } catch (e) {
    result.reason = e instanceof Error ? e.message : "enrollment failed";
  }
  return result;
}
