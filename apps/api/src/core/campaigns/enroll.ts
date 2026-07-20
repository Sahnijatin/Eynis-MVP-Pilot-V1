// Reusable sequence-enrollment helper.
//
// The drip engine (core/campaigns/sequence-runner) keys enrollment on CampaignLead,
// so enrolling a durable Contact means find-or-creating a lead for it, then creating
// the SequenceEnrollment. Both the quote-sent follow-up and custom "New Flow"
// automations enroll contacts, so the lead + enrollment recipe lives here once.

import { prisma } from "../../db/prisma";
import { nextRunFrom } from "./sequences";

const DEFAULT_FOLLOWUP_CAMPAIGN_NAME = "Follow-up";

export interface EnrollContact {
  id: string;
  fullName: string;
  phoneE164: string;
  email: string | null;
}

// Find-or-create a CampaignLead for this contact. Reuses any existing lead for the
// contact; otherwise creates one in a dedicated (multi-channel, active) campaign so
// the sequence runner has the send context it reads.
export async function findOrCreateFollowupLead(
  tenantId: string,
  contact: EnrollContact,
  opts: { campaignName?: string; consentSource?: string } = {},
): Promise<string> {
  const existing = await prisma.campaignLead.findFirst({
    where: { tenantId, contactId: contact.id },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (existing) return existing.id;

  const campaignName = opts.campaignName ?? DEFAULT_FOLLOWUP_CAMPAIGN_NAME;
  let campaign = await prisma.voiceCampaign.findFirst({ where: { tenantId, name: campaignName }, select: { id: true } });
  if (!campaign) {
    campaign = await prisma.voiceCampaign.create({
      data: { tenantId, name: campaignName, status: "active", channels: JSON.stringify(["whatsapp", "email"]) },
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
      consent: true,
      consentSource: opts.consentSource ?? "automation",
    },
    select: { id: true },
  });
  return lead.id;
}

export interface EnrollResult {
  enrolled: boolean;
  sequenceId?: string;
  sequenceName?: string;
  reason?: string;
}

// Resolve the target sequence: a specific active one by id, else the tenant's first
// active sequence. Returns null when there is nothing to enroll into.
async function resolveSequence(tenantId: string, sequenceId?: string | null) {
  const where = sequenceId
    ? { id: sequenceId, tenantId, status: "active" }
    : { tenantId, status: "active" };
  return prisma.sequence.findFirst({
    where,
    orderBy: { createdAt: "asc" },
    include: { steps: { orderBy: { order: "asc" }, take: 1 } },
  });
}

// Enroll a contact into a sequence (idempotent — re-enrolling the same lead is a
// no-op thanks to the (sequenceId, leadId) unique index). Best-effort: returns a
// reason rather than throwing so callers can fall back gracefully.
export async function enrollContactInSequence(
  tenantId: string,
  contactId: string,
  opts: { sequenceId?: string | null; campaignName?: string; consentSource?: string } = {},
): Promise<EnrollResult> {
  const sequence = await resolveSequence(tenantId, opts.sequenceId ?? null);
  if (!sequence) return { enrolled: false, reason: opts.sequenceId ? "sequence not found or inactive" : "no active sequence" };
  if (sequence.steps.length === 0) return { enrolled: false, sequenceId: sequence.id, sequenceName: sequence.name, reason: "sequence has no steps" };

  const contact = await prisma.contact.findFirst({
    where: { id: contactId, tenantId },
    select: { id: true, fullName: true, phoneE164: true, email: true },
  });
  if (!contact) return { enrolled: false, reason: "contact not found" };

  const leadId = await findOrCreateFollowupLead(tenantId, contact, { campaignName: opts.campaignName, consentSource: opts.consentSource });
  const nextRunAt = nextRunFrom(new Date(), sequence.steps[0].waitMinutes);
  const res = await prisma.sequenceEnrollment.createMany({
    data: [{ sequenceId: sequence.id, tenantId, leadId, currentStepOrder: 0, nextRunAt }],
    skipDuplicates: true,
  });
  return {
    enrolled: res.count > 0,
    sequenceId: sequence.id,
    sequenceName: sequence.name,
    reason: res.count > 0 ? undefined : "already enrolled",
  };
}
