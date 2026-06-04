// Unified multi-channel dispatch worker (Phase 6.1).
//
// One loop drives every non-voice channel (WhatsApp, email; voice is handled by
// the dialler worker). Per active campaign × channel it picks a bounded BATCH of
// leads not yet contacted on that channel, runs the shared pre-send guard,
// renders + sends via the channel's registered sender, and records a
// MessageDelivery. Batching keeps memory/throughput flat whether a list has 50
// leads or 50,000 — each tick chips away up to `batchSize` per channel and the
// next tick continues. Spend caps bound total sends per campaign.

import { prisma } from "../../db/prisma";
import { broadcastSSEEvent } from "../../sse/clients";
import { evaluateContact } from "./guard";
import { parseSegmentRules, buildLeadWhere } from "./segments";
import { getSender, MESSAGING_CHANNELS, type ChannelSender, type SendContext } from "./senders";

// Resolve a campaign's optional targeting segment to a lead where-fragment.
// Returns {} when no segment is set (or it was deleted) → contact all leads.
async function segmentWhereFor(segmentId: string | null): Promise<ReturnType<typeof buildLeadWhere>> {
  if (!segmentId) return {};
  const seg = await prisma.leadSegment.findUnique({ where: { id: segmentId }, select: { rules: true } });
  return seg ? buildLeadWhere(parseSegmentRules(seg.rules)) : {};
}

const DEFAULT_BATCH = Number(process.env.CAMPAIGN_DISPATCH_BATCH ?? 200);
const TICK_MS = Number(process.env.CAMPAIGN_DISPATCH_INTERVAL_MS ?? 30_000);

export interface DispatchDeps {
  resolveSender?: (channel: string) => ChannelSender | null;
  batchSize?: number;
}

const safeArray = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

// Processes one (campaign, channel) pair for up to `batchSize` leads. Returns
// how many were sent/skipped/failed this tick. Reusable + unit-testable via the
// injected sender resolver.
export async function processCampaignChannel(
  campaignId: string,
  channel: string,
  deps: DispatchDeps = {},
): Promise<{ sent: number; failed: number; skipped: number }> {
  const resolveSender = deps.resolveSender ?? getSender;
  const sender = resolveSender(channel);
  let sent = 0, failed = 0, skipped = 0;
  if (!sender) return { sent, failed, skipped };

  const campaign = await prisma.voiceCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "active") return { sent, failed, skipped };

  // Spend cap: bound the batch to remaining budget; pause if exhausted.
  let batchSize = deps.batchSize ?? DEFAULT_BATCH;
  if (campaign.spendCapCalls != null) {
    const [deliveries, calls] = await Promise.all([
      prisma.messageDelivery.count({ where: { campaignId, status: { in: ["sent", "delivered"] } } }),
      prisma.callRecord.count({ where: { campaignId } }),
    ]);
    const remaining = campaign.spendCapCalls - (deliveries + calls);
    if (remaining <= 0) {
      await prisma.voiceCampaign.update({ where: { id: campaignId }, data: { status: "paused" } });
      broadcastSSEEvent({ type: "campaign_paused", hotelId: campaign.hotelId, campaignId, reason: "spend_cap_reached" });
      return { sent, failed, skipped };
    }
    batchSize = Math.min(batchSize, remaining);
  }

  // Lead selection, bounded together by batchSize, has two parts:
  //   (1) fresh leads never attempted on this channel; and
  //   (2) retry leads whose only attempts on this channel are failures, are
  //       still under the campaign's maxRetries, and whose last failure is older
  //       than retryDelayHours (transient-failure backoff). A "skipped" delivery
  //       is a permanent compliance decision (no consent / suppressed) and is
  //       never retried — only "failed" rows are.
  const leadScalars = {
    id: true, firstName: true, lastName: true, phone: true, email: true, company: true,
    jobTitle: true, rawData: true, consent: true, consentSource: true, optedOut: true,
  } as const;

  // Optional targeting: when the campaign points at a segment, only matching
  // leads are contacted (ANDed into both fresh and retry selection).
  const segmentWhere = await segmentWhereFor(campaign.segmentId);

  const fresh = await prisma.campaignLead.findMany({
    where: { campaignId, status: { not: "opted_out" }, deliveries: { none: { channel } }, ...segmentWhere },
    take: batchSize,
    select: leadScalars,
  });
  const leads: Array<(typeof fresh)[number]> = [...fresh];

  const retryBudget = batchSize - fresh.length;
  if (retryBudget > 0 && campaign.maxRetries > 0) {
    const cutoff = new Date(Date.now() - campaign.retryDelayHours * 3_600_000);
    const candidates = await prisma.campaignLead.findMany({
      where: {
        campaignId, status: { not: "opted_out" },
        deliveries: {
          some: { channel, status: "failed" },
          // No channel delivery that is either non-failed (terminal/in-flight) or
          // a failure inside the backoff window ⇒ all attempts failed and the last
          // one is past the delay, so the lead is due for a retry.
          none: { channel, OR: [{ status: { not: "failed" } }, { createdAt: { gte: cutoff } }] },
        },
        ...segmentWhere,
      },
      take: retryBudget,
      select: { ...leadScalars, deliveries: { where: { channel }, select: { id: true } } },
    });
    for (const c of candidates) {
      if (c.deliveries.length > campaign.maxRetries) continue; // retries exhausted
      const { deliveries: _attempts, ...lead } = c;
      leads.push(lead);
    }
  }

  if (leads.length === 0) return { sent, failed, skipped };

  // Batch-resolve the durable suppression list for this slice of phones.
  const phones = leads.map((l) => l.phone).filter((p): p is string => Boolean(p));
  const suppressedRows = phones.length
    ? await prisma.doNotContact.findMany({ where: { hotelId: campaign.hotelId, phone: { in: phones } }, select: { phone: true } })
    : [];
  const suppressed = new Set(suppressedRows.map((s) => s.phone));

  const hotel = await prisma.hotel.findUnique({ where: { id: campaign.hotelId }, select: { name: true } });
  const senderCampaign = {
    name: campaign.name, calendlyLink: campaign.calendlyLink,
    whatsappContentSid: campaign.whatsappContentSid, whatsappTemplateBody: campaign.whatsappTemplateBody,
    whatsappVariables: safeArray(campaign.whatsappVariables),
    emailSubjectTemplate: campaign.emailSubjectTemplate, emailBodyTemplate: campaign.emailBodyTemplate,
  };

  for (const lead of leads) {
    const decision = evaluateContact(
      { consent: lead.consent, consentSource: lead.consentSource, optedOut: lead.optedOut, phone: lead.phone },
      { channel: channel as "whatsapp" | "email", suppressed: lead.phone ? suppressed.has(lead.phone) : true },
    );
    if (!decision.ok) {
      await prisma.messageDelivery.create({
        data: { hotelId: campaign.hotelId, campaignId, leadId: lead.id, channel, status: "skipped", error: decision.reason },
      });
      skipped++;
      continue;
    }

    const ctx: SendContext = { hotelId: campaign.hotelId, campaign: senderCampaign, lead, tenantName: hotel?.name ?? null };
    const result = await sender.send(ctx);
    await prisma.messageDelivery.create({
      data: {
        hotelId: campaign.hotelId, campaignId, leadId: lead.id, channel,
        status: result.ok ? "sent" : "failed",
        providerId: result.providerId, renderedSubject: result.renderedSubject,
        renderedBody: result.renderedBody, error: result.error,
        sentAt: result.ok ? new Date() : null,
      },
    });
    if (result.ok) {
      sent++;
      broadcastSSEEvent({ type: "campaign_message_sent", hotelId: campaign.hotelId, campaignId, leadId: lead.id, channel });
    } else {
      failed++;
    }
  }

  return { sent, failed, skipped };
}

// One pass over all active campaigns' messaging channels.
export async function runDispatchTick(deps: DispatchDeps = {}): Promise<void> {
  const active = await prisma.voiceCampaign.findMany({ where: { status: "active" }, select: { id: true, channels: true } });
  for (const campaign of active) {
    const channels = safeArray(campaign.channels).filter((c) => MESSAGING_CHANNELS.includes(c));
    for (const channel of channels) {
      try {
        await processCampaignChannel(campaign.id, channel, deps);
      } catch (e) {
        console.error(`[Dispatch] campaign ${campaign.id} channel ${channel} failed:`, (e as Error).message);
      }
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startCampaignDispatchWorker(intervalMs = TICK_MS): void {
  if (timer) return;
  timer = setInterval(() => { void runDispatchTick(); }, intervalMs);
  console.log(`Eynis CampaignDispatch started — ${Math.round(intervalMs / 1000)}s cycle`);
}

export function stopCampaignDispatchWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
