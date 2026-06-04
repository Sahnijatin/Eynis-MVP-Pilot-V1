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
  const existing = await prisma.contact.findFirst({ where: { tenantId, phoneE164 }, select: { id: true } });
  if (existing) return existing.id;
  const g = await prisma.contact.create({
    data: { tenantId, fullName: guestName, phoneE164 },
    select: { id: true }
  });
  return g.id;
}

// Keyword fallback when AI is unavailable
function keywordClassify(text: string): ClassificationResult {
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

      broadcastSSEEvent({
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
        replyMessage = buildReplyMessage(guestName, classification.summary, sr.id);
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

    broadcastSSEEvent({
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
    // Partial failure — update event with error state
    await prisma.connectorEvent.update({
      where: { id: event.id },
      data: { replyStatus: `error: ${err instanceof Error ? err.message : "unknown"}` }
    }).catch(() => {/* ignore update failure */});
  }

  return { connectorEventId: event.id, guestId, serviceRequestId, classification, replySent, replyMessage };
}
