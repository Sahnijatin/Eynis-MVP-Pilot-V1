import { prisma } from "../../db/prisma";
import { AI_AVAILABLE, type AIProvider, classifyInboundEvent } from "../ai/intelligence";
import { sendWhatsAppReply, buildReplyMessage } from "./whatsapp-outbound";
import { broadcastSSEEvent } from "../../sse/clients";

export interface IngestInput {
  tenantId: string;
  connectorKey: string;
  eventType?: string;
  guestPhone?: string;
  guestName?: string;
  messageText: string;
  rawPayload: unknown;
  aiProvider?: AIProvider;
  sendReply?: boolean;
}

export interface ClassificationResult {
  category: string;
  priority: string;
  summary: string;
  sentiment: string;
  routingHint: string;
  slaMinutes: number;
}

export interface IngestResult {
  connectorEventId: string;
  guestId: string | null;
  serviceRequestId: string | null;
  classification: ClassificationResult | null;
  replySent: boolean;
  replyMessage: string | null;
}

function asTrimmedString(v: unknown): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : null;
}

async function upsertGuest(tenantId: string, guestName: string, phoneE164: string): Promise<string> {
  // Atomic upsert on the (tenantId, phoneE164) unique — the previous find-then-create
  // raced under concurrent inbound messages from a new number (provider retries /
  // bursts), creating duplicate Contacts that split history and CRM data (F-…).
  const g = await prisma.contact.upsert({
    where: { tenantId_phoneE164: { tenantId, phoneE164 } },
    update: {}, // keep the existing contact's fields on a repeat message
    create: { tenantId, fullName: guestName, phoneE164 },
    select: { id: true },
  });
  return g.id;
}

// Keyword fallback when AI is unavailable
export function keywordClassify(text: string): ClassificationResult {
  const lower = text.toLowerCase();
  const category =
    lower.includes("towel") || lower.includes("clean") || lower.includes("housekeep") ? "housekeeping"
    : lower.includes("ac") || lower.includes("maintenance") || lower.includes("broken") || lower.includes("repair") ? "maintenance"
    : lower.includes("food") || lower.includes("room service") || lower.includes("dining") || lower.includes("drink") ? "fnb"
    : lower.includes("checkout") || lower.includes("check-out") || lower.includes("bill") || lower.includes("invoice") ? "front_desk"
    : lower.includes("taxi") || lower.includes("tour") || lower.includes("recommend") ? "concierge"
    : "front_desk";

  const priority =
    lower.includes("urgent") || lower.includes("emergency") || lower.includes("medical") ? "urgent"
    : lower.includes("asap") || lower.includes("quickly") || lower.includes("soon") ? "high"
    : "normal";

  const slaMinutes = priority === "urgent" ? 10 : priority === "high" ? 20 : 45;
  const summary = text.length > 80 ? text.slice(0, 77) + "..." : text;

  return { category, priority, summary, sentiment: "neutral", routingHint: category, slaMinutes };
}

const VALID_PRIORITIES = new Set(["low", "normal", "medium", "high", "urgent"]);
const VALID_SENTIMENTS = new Set(["positive", "neutral", "negative"]);
const SLA_MIN = 5;              // never less than 5 minutes
const SLA_MAX = 7 * 24 * 60;    // never more than 7 days

// Clamp a (possibly AI-produced, injection-influenced) classification into safe,
// well-typed values before it drives an SLA deadline and downstream filtering.
export function sanitizeClassification(c: ClassificationResult): ClassificationResult {
  const cleanStr = (v: unknown, max: number, dflt: string) => {
    const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
    return s ? s.slice(0, max) : dflt;
  };
  const sla = Number(c.slaMinutes);
  return {
    category: cleanStr(c.category, 40, "front_desk").toLowerCase(),
    priority: VALID_PRIORITIES.has(String(c.priority).toLowerCase()) ? String(c.priority).toLowerCase() : "normal",
    summary: cleanStr(c.summary, 500, "Request received"),
    sentiment: VALID_SENTIMENTS.has(String(c.sentiment).toLowerCase()) ? String(c.sentiment).toLowerCase() : "neutral",
    routingHint: cleanStr(c.routingHint, 40, "front_desk").toLowerCase(),
    slaMinutes: Number.isFinite(sla) ? Math.min(SLA_MAX, Math.max(SLA_MIN, Math.round(sla))) : 45,
  };
}

export async function ingestConnectorEvent(input: IngestInput): Promise<IngestResult> {
  const {
    tenantId,
    connectorKey,
    eventType = "inbound_message",
    guestPhone,
    guestName = "WhatsApp Guest",
    messageText,
    rawPayload,
    aiProvider = "claude",
    sendReply = true
  } = input;

  // 1. Create a preliminary event record
  const event = await prisma.connectorEvent.create({
    data: {
      tenantId,
      connectorKey,
      eventType,
      guestPhone: guestPhone ?? null,
      guestName,
      rawPayload: JSON.stringify(rawPayload)
    },
    select: { id: true }
  });

  let guestId: string | null = null;
  let serviceRequestId: string | null = null;
  let classification: ClassificationResult | null = null;
  let replySent = false;
  let replyMessage: string | null = null;

  try {
    // 2. Upsert guest
    if (guestPhone) {
      guestId = await upsertGuest(tenantId, guestName, guestPhone);
    }

    // 3. Classify via AI (or keyword fallback)
    if (AI_AVAILABLE && messageText) {
      try {
        const aiResult = await classifyInboundEvent(tenantId, messageText, aiProvider);
        classification = {
          category: aiResult.category,
          priority: aiResult.priority,
          summary: aiResult.summary,
          sentiment: aiResult.sentiment,
          routingHint: aiResult.routingHint,
          slaMinutes: aiResult.slaMinutes
        };
      } catch {
        classification = keywordClassify(messageText);
      }
    } else {
      classification = keywordClassify(messageText);
    }

    // 3b. Clamp/validate the classification — the AI output is derived from an
    // untrusted inbound message, so never trust its shape. An unbounded slaMinutes
    // could push the SLA centuries out (never breaches); a non-enum priority/sentiment
    // breaks downstream filters; a NaN slaMinutes makes `new Date(NaN)` throw (F-…).
    classification = sanitizeClassification(classification);

    // 4. Create service request
    if (guestId) {
      const slaDueAt = classification.slaMinutes > 0
        ? new Date(Date.now() + classification.slaMinutes * 60 * 1000)
        : null;

      const sr = await prisma.serviceRequest.create({
        data: {
          tenantId,
          guestId,
          category: classification.category,
          status: "open",
          source: connectorKey.startsWith("whatsapp") ? "whatsapp" : connectorKey,
          summary: classification.summary,
          priority: classification.priority,
          slaDueAt
        },
        select: { id: true }
      });
      serviceRequestId = sr.id;

      broadcastSSEEvent(tenantId, {
        type: "sr_created",
        data: {
          id: sr.id, tenantId, category: classification.category,
          status: "open", summary: classification.summary,
          priority: classification.priority, source: connectorKey,
          guestName, createdAt: new Date().toISOString()
        }
      });

      // 5. Build and send outbound reply
      if (sendReply && guestPhone) {
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, branding: { select: { brandName: true } } }
        });
        const brandName = tenant?.branding?.brandName?.trim() || tenant?.name?.trim() || null;
        replyMessage = buildReplyMessage(guestName, classification.summary, sr.id, brandName);
        const replyResult = await sendWhatsAppReply(tenantId, guestPhone, replyMessage);
        replySent = replyResult.sent;

        if (!replyResult.sent) {
          // Reply failed — store the intended message but mark status
          await prisma.connectorEvent.update({
            where: { id: event.id },
            data: { replyMessage, replyStatus: `failed: ${replyResult.error ?? "unknown"}` }
          });
        }
      }
    }

    // 6. Update event record with all results
    await prisma.connectorEvent.update({
      where: { id: event.id },
      data: {
        guestId,
        aiProvider: AI_AVAILABLE ? aiProvider : "keyword",
        aiCategory: classification?.category,
        aiPriority: classification?.priority,
        aiSummary: classification?.summary,
        aiSentiment: classification?.sentiment,
        aiRoutingHint: classification?.routingHint,
        aiSlaMinutes: classification?.slaMinutes,
        serviceRequestId,
        replyMessage: replyMessage ?? undefined,
        replySentAt: replySent ? new Date() : undefined,
        replyStatus: replySent ? "sent" : (replyMessage ? undefined : "no_reply_needed")
      }
    });

    broadcastSSEEvent(tenantId, {
      type: "connector_event",
      data: {
        id: event.id, connectorKey, guestName,
        aiCategory: classification?.category,
        aiSummary: classification?.summary,
        aiSentiment: classification?.sentiment,
        serviceRequestId,
        createdAt: new Date().toISOString()
      }
    });

    // 7. Write audit log
    await prisma.auditLog.create({
      data: {
        tenantId,
        actorRole: "system",
        action: "connector.event.ingested",
        entityType: "connector_event",
        entityId: event.id,
        metadata: JSON.stringify({
          connectorKey,
          guestPhone,
          category: classification?.category,
          priority: classification?.priority,
          serviceRequestId,
          replySent
        })
      }
    });

  } catch (err) {
    // Partial failure — record the error state AND log it. Previously this was
    // swallowed silently, so a transient outbound-send outage left SRs with no event
    // linkage or audit trail and no operator signal (F-… half-processed ingest).
    console.warn(`[ingest] pipeline failed for connectorEvent=${event.id} tenant=${tenantId}:`, err instanceof Error ? err.message : err);
    await prisma.connectorEvent.update({
      where: { id: event.id },
      data: { replyStatus: `error: ${err instanceof Error ? err.message : "unknown"}` }
    }).catch(() => {/* ignore update failure */});
  }

  return { connectorEventId: event.id, guestId, serviceRequestId, classification, replySent, replyMessage };
}
