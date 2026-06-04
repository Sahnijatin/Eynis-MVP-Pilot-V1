// Voice dialler worker (Phase 6).
//
// The voice channel of the unified campaign engine. Runs on its own 30s cycle
// (separate from the 60s automation engine). Per active voice campaign it:
//   1. recovers stuck calls (in-flight > 15 min → reset lead, fail the record)
//   2. enforces the spend cap (auto-pause + SSE)
//   3. computes free slots (maxConcurrent − in-flight)
//   4. picks due pending leads, runs the shared pre-send guard
//   5. atomically locks each lead (pending → calling) to prevent double-dial
//   6. assigns the A/B variant (balanced; reused on retry) and initiates the call
//
// Vapi calls are dependency-injected so the whole flow is testable with no keys.

import { prisma } from "../../db/prisma";
import { broadcastSSEEvent } from "../../sse/clients";
import { evaluateContact } from "./guard";
import { campaignMaySendNow } from "./schedule-gate";
import { parseSegmentRules, buildLeadWhere } from "./segments";
import { buildTemplateVars } from "../email/resend";
import {
  resolveVapiCredentials, isVapiConfigured, initiateCall as realInitiateCall,
  type VapiCredentials, type VapiResult, type CallParams,
} from "./vapi";

const TICK_MS = Number(process.env.CAMPAIGN_DIALER_INTERVAL_MS ?? 30_000);
const DEFAULT_MAX_CONCURRENT = 5;
const STUCK_CALL_MINUTES = 15;

export interface DialerDeps {
  resolveCreds?: (hotelId: string) => Promise<VapiCredentials>;
  initiateCall?: (creds: VapiCredentials, params: CallParams) => Promise<VapiResult<{ id: string }>>;
  now?: () => Date;
}

const safeArray = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};

const isServerError = (msg: string): boolean => /error 5\d\d/i.test(msg);

// Resets calls stuck in-flight beyond the threshold so a crashed/abandoned dial
// never pins a slot forever; the lead returns to the queue.
async function recoverStuckCalls(campaignId: string, now: Date): Promise<void> {
  const cutoff = new Date(now.getTime() - STUCK_CALL_MINUTES * 60_000);
  const stuck = await prisma.callRecord.findMany({
    where: { campaignId, status: { in: ["initiated", "in_progress"] }, createdAt: { lt: cutoff } },
    select: { id: true, leadId: true },
  });
  for (const call of stuck) {
    await prisma.callRecord.update({ where: { id: call.id }, data: { status: "failed", error: "stuck_timeout" } });
    await prisma.campaignLead.updateMany({ where: { id: call.leadId, status: "calling" }, data: { status: "pending" } });
  }
}

export async function processVoiceCampaign(
  campaignId: string,
  deps: DialerDeps = {},
): Promise<{ dialed: number; skipped: number; failed: number }> {
  const now = deps.now ?? (() => new Date());
  const resolveCreds = deps.resolveCreds ?? resolveVapiCredentials;
  const initiateCall = deps.initiateCall ?? realInitiateCall;
  let dialed = 0, skipped = 0, failed = 0;

  const campaign = await prisma.voiceCampaign.findUnique({ where: { id: campaignId } });
  if (!campaign || campaign.status !== "active") return { dialed, skipped, failed };
  if (!safeArray(campaign.channels).includes("voice")) return { dialed, skipped, failed };
  if (!campaign.vapiAssistantIdA || !campaign.vapiAssistantIdB) return { dialed, skipped, failed };
  // Respect scheduled start / send window / quiet-hours.
  if (!(await campaignMaySendNow(campaign))) return { dialed, skipped, failed };

  const creds = await resolveCreds(campaign.hotelId);
  if (!isVapiConfigured(creds) || !creds.phoneNumberId) return { dialed, skipped, failed }; // not dialable yet

  const ts = now();
  await recoverStuckCalls(campaignId, ts);

  // Spend cap (shared across channels): total dials + sent messages.
  let budget = Number.POSITIVE_INFINITY;
  if (campaign.spendCapCalls != null) {
    const [calls, deliveries] = await Promise.all([
      prisma.callRecord.count({ where: { campaignId } }),
      prisma.messageDelivery.count({ where: { campaignId, status: { in: ["sent", "delivered"] } } }),
    ]);
    budget = campaign.spendCapCalls - (calls + deliveries);
    if (budget <= 0) {
      await prisma.voiceCampaign.update({ where: { id: campaignId }, data: { status: "paused" } });
      broadcastSSEEvent({ type: "campaign_paused", hotelId: campaign.hotelId, campaignId, reason: "spend_cap_reached" });
      return { dialed, skipped, failed };
    }
  }

  // Slot calc: cap concurrent in-flight calls.
  const maxConcurrent = campaign.maxConcurrent ?? DEFAULT_MAX_CONCURRENT;
  const inFlight = await prisma.callRecord.count({ where: { campaignId, status: { in: ["initiated", "in_progress"] } } });
  let slots = Math.min(maxConcurrent - inFlight, budget);
  if (slots <= 0) return { dialed, skipped, failed };

  // Optional targeting: when the campaign points at a segment, only matching
  // leads are dialled.
  let segmentWhere = {};
  if (campaign.segmentId) {
    const seg = await prisma.leadSegment.findUnique({ where: { id: campaign.segmentId }, select: { rules: true } });
    if (seg) segmentWhere = buildLeadWhere(parseSegmentRules(seg.rules));
  }

  // Due pending leads (covers retries via nextCallAt).
  const leads = await prisma.campaignLead.findMany({
    where: {
      campaignId, status: "pending",
      OR: [{ nextCallAt: null }, { nextCallAt: { lte: ts } }],
      ...segmentWhere,
    },
    orderBy: { createdAt: "asc" },
    take: slots,
    select: {
      id: true, firstName: true, lastName: true, phone: true, email: true, company: true,
      jobTitle: true, rawData: true, consent: true, consentSource: true, optedOut: true, abVariant: true,
    },
  });
  if (leads.length === 0) return { dialed, skipped, failed };

  // Batch-resolve suppression + balance A/B across what's already assigned.
  const phones = leads.map((l) => l.phone).filter((p): p is string => Boolean(p));
  const suppressedRows = phones.length
    ? await prisma.doNotContact.findMany({ where: { hotelId: campaign.hotelId, phone: { in: phones } }, select: { phone: true } })
    : [];
  const suppressed = new Set(suppressedRows.map((s) => s.phone));

  const [aCount, bCount] = await Promise.all([
    prisma.campaignLead.count({ where: { campaignId, abVariant: "A" } }),
    prisma.campaignLead.count({ where: { campaignId, abVariant: "B" } }),
  ]);
  let a = aCount, b = bCount;

  const hotel = await prisma.hotel.findUnique({ where: { id: campaign.hotelId }, select: { name: true } });

  for (const lead of leads) {
    if (slots <= 0) break;

    const decision = evaluateContact(
      { consent: lead.consent, consentSource: lead.consentSource, optedOut: lead.optedOut, phone: lead.phone },
      { channel: "voice", suppressed: lead.phone ? suppressed.has(lead.phone) : true },
    );
    if (!decision.ok) {
      // Terminal: take the lead out of the dial queue (opt-outs become opted_out).
      const status = decision.reason === "suppressed" || decision.reason === "lead_opted_out" ? "opted_out" : "failed";
      await prisma.campaignLead.updateMany({ where: { id: lead.id, status: "pending" }, data: { status } });
      skipped++;
      continue;
    }

    // Choose variant: reuse on retry, else assign to the lighter arm.
    const variant = lead.abVariant ?? (a <= b ? "A" : "B");

    // Atomic lock: only the updater that flips pending→calling owns the dial.
    const lock = await prisma.campaignLead.updateMany({
      where: { id: lead.id, status: "pending" },
      data: { status: "calling", abVariant: variant, callAttempts: { increment: 1 } },
    });
    if (lock.count !== 1) continue; // lost the race
    if (!lead.abVariant) { variant === "A" ? a++ : b++; }

    const call = await prisma.callRecord.create({
      data: { hotelId: campaign.hotelId, campaignId, leadId: lead.id, abVariant: variant, status: "initiated" },
    });

    const vars = buildTemplateVars({
      lead: { firstName: lead.firstName, lastName: lead.lastName, company: lead.company, jobTitle: lead.jobTitle, email: lead.email, phone: lead.phone, rawData: lead.rawData },
      campaign: { name: campaign.name, calendlyLink: campaign.calendlyLink },
      tenant: { name: hotel?.name ?? null },
      booking: { calendlyLink: campaign.calendlyLink },
    });

    const result = await initiateCall(creds, {
      vapiAssistantId: variant === "A" ? campaign.vapiAssistantIdA : campaign.vapiAssistantIdB,
      phoneNumberId: creds.phoneNumberId,
      leadPhone: lead.phone ?? "",
      leadName: `${lead.firstName} ${lead.lastName ?? ""}`.trim(),
      variableValues: vars,
    });

    if (result.ok) {
      await prisma.callRecord.update({ where: { id: call.id }, data: { status: "in_progress", vapiCallId: result.data.id, startedAt: ts } });
      dialed++;
      slots--;
      broadcastSSEEvent({ type: "campaign_call_started", hotelId: campaign.hotelId, campaignId, leadId: lead.id, abVariant: variant });
    } else {
      // No silent failures: fail the record, return the lead to the queue.
      await prisma.callRecord.update({ where: { id: call.id }, data: { status: "failed", error: result.error } });
      await prisma.campaignLead.updateMany({ where: { id: lead.id, status: "calling" }, data: { status: "pending" } });
      failed++;
      // Provider outage → auto-pause and stop this tick (manual resume).
      if (isServerError(result.error)) {
        await prisma.voiceCampaign.update({ where: { id: campaignId }, data: { status: "paused" } });
        broadcastSSEEvent({ type: "campaign_paused", hotelId: campaign.hotelId, campaignId, reason: "provider_error" });
        break;
      }
    }
  }

  return { dialed, skipped, failed };
}

export async function runDialerTick(deps: DialerDeps = {}): Promise<void> {
  const active = await prisma.voiceCampaign.findMany({ where: { status: "active" }, select: { id: true, channels: true } });
  for (const campaign of active) {
    if (!safeArray(campaign.channels).includes("voice")) continue;
    try {
      await processVoiceCampaign(campaign.id, deps);
    } catch (e) {
      console.error(`[Dialer] campaign ${campaign.id} failed:`, (e as Error).message);
    }
  }
}

let timer: ReturnType<typeof setInterval> | null = null;

export function startCampaignWorker(intervalMs = TICK_MS): void {
  if (timer) return;
  timer = setInterval(() => { void runDialerTick(); }, intervalMs);
  console.log(`Eynis CampaignDialer started — ${Math.round(intervalMs / 1000)}s cycle`);
}

export function stopCampaignWorker(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
