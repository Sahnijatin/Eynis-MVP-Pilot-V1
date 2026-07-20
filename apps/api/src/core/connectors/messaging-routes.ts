// Connector messaging + events router (#164) — the inbound WhatsApp webhook, the
// unified connector ingest endpoint, the connector event log, and the outbound
// WhatsApp send. Extracted verbatim from server.ts; returns true when it handled
// the request, false to let the dispatcher continue. Lives in core/connectors/
// alongside config-routes / intake-routes / ingest.
//
// The public WhatsApp webhook verifies the provider signature (enforce-when-
// configured) before ingesting; the ingest / event-log / send routes are
// tenant-authorized. The outbound send still honours the #168 opt-out guardrail.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, ensureTenantAccess } from "../authz";
import { json, parseBody, parseRawBody, parseUrl, asTrimmedString, asSafeLimit, asSafeOffset } from "../../http/helpers";
import { ingestConnectorEvent } from "./ingest";
import { normalizeWhatsappInbound } from "./whatsapp";
import { checkWebhookSignature, verifySharedWebhookSecret, webhookEnforcement } from "./webhook-verify";

export async function handleConnectorMessagingRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url === "/integrations/whatsapp/webhook" && req.method === "POST") {
    const provided = req.headers["x-webhook-secret"];
    const secretCheck = verifySharedWebhookSecret({
      expected: process.env.WHATSAPP_WEBHOOK_SECRET,
      provided: typeof provided === "string" ? provided : Array.isArray(provided) ? provided[0] : null,
      isProduction: process.env.NODE_ENV === "production"
    });
    if (!secretCheck.ok) { json(res, secretCheck.status, { ok: false, error: secretCheck.reason ?? "Unauthorized" }); return true; }

    const rawBody = await parseRawBody(req);
    // Enforce-when-configured: verification turns on automatically as soon as
    // the operator has configured what it needs (Interakt secret, or Twilio
    // token + public URL). VERIFY_WEBHOOKS=true forces it on; =false is the
    // explicit dev escape hatch. See webhookEnforcement().
    const enforcement = webhookEnforcement();

    const twilioSig = typeof req.headers["x-twilio-signature"] === "string" ? req.headers["x-twilio-signature"] : null;
    const interaktSigPresent = typeof req.headers["x-hub-signature-256"] === "string" || typeof req.headers["x-interakt-signature"] === "string";
    // Close the omission bypass: when any provider is enforced, a request with
    // no provider signature at all must be rejected rather than silently
    // accepted (F-9) — otherwise forging "the other provider's" payload
    // unsigned would bypass verification entirely.
    if (enforcement.any && twilioSig === null && !interaktSigPresent) {
      json(res, 401, { ok: false, error: "Missing webhook signature" }); return true;
    }
    if (twilioSig !== null) {
      // Twilio's HMAC covers the exact public URL it POSTed to PLUS the sorted form
      // params. Use the configured public URL (TWILIO_WEBHOOK_URL / EYNIS_PUBLIC_URL,
      // never the request Host which a caller controls) and the real form params
      // parsed from the body. Enforcement is automatic once that URL + the auth
      // token are configured — operators should validate against a live Twilio
      // number when setting them.
      const configuredBase = (process.env.TWILIO_WEBHOOK_URL ?? process.env.EYNIS_PUBLIC_URL ?? "").trim();
      const fullUrl = configuredBase
        ? configuredBase
        : `https://${req.headers.host ?? "localhost"}${req.url}`;
      const isForm = (req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded");
      const twilioParams = isForm ? Object.fromEntries(new URLSearchParams(rawBody)) : {};
      const check = checkWebhookSignature({ provider: "twilio", signature: twilioSig, url: fullUrl, rawBody, params: twilioParams, enforce: enforcement.twilio });
      if (!check.ok) { json(res, 401, { ok: false, error: check.reason ?? "Twilio signature verification failed" }); return true; }
    }

    const interaktSig = typeof req.headers["x-hub-signature-256"] === "string"
      ? req.headers["x-hub-signature-256"]
      : typeof req.headers["x-interakt-signature"] === "string"
      ? req.headers["x-interakt-signature"]
      : null;
    if (interaktSig !== null) {
      const check = checkWebhookSignature({ provider: "interakt", signature: interaktSig, url: req.url ?? "", rawBody, enforce: enforcement.interakt });
      if (!check.ok) { json(res, 401, { ok: false, error: check.reason ?? "Interakt signature verification failed" }); return true; }
    }

    const body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
    const normalized = normalizeWhatsappInbound(body);
    if (!normalized) {
      json(res, 400, {
        ok: false,
        error: "Unable to normalize webhook payload. Provide provider-compatible payload with tenantId, sender phone and message."
      });
      return true;
    }
    const { tenantId, fromPhone, message, guestName, provider } = normalized;
    const hasAccess = await ensureTenantAccess(tenantId);
    if (!hasAccess) {
      json(res, 404, { ok: false, error: "Hotel not found" });
      return true;
    }

    // Two-way campaign WhatsApp agent: if this sender is a lead on a campaign
    // with the agent enabled, handle the reply here and stop. Otherwise fall
    // through to the normal service-request ingest.
    const providerMessageId =
      asTrimmedString((body as Record<string, unknown>).MessageSid) ??
      asTrimmedString((body as Record<string, unknown>).messageId) ??
      asTrimmedString((body as Record<string, unknown>).id);
    const { handleInboundWhatsApp } = await import("../campaigns/whatsapp-agent");
    const agentResult = await handleInboundWhatsApp({ tenantId, fromPhone, body: message, providerMessageId });
    if (agentResult.handled) {
      json(res, 202, { ok: true, handledBy: "whatsapp_agent", reason: agentResult.reason });
      return true;
    }

    const result = await ingestConnectorEvent({
      tenantId,
      connectorKey: provider === "twilio" ? "whatsapp_twilio" : provider === "interakt" ? "whatsapp_interakt" : "whatsapp_generic",
      guestPhone: fromPhone,
      guestName,
      messageText: message,
      rawPayload: body,
      sendReply: true
    });

    json(res, 202, {
      ok: true,
      connectorEventId: result.connectorEventId,
      requestId: result.serviceRequestId,
      classification: result.classification,
      replySent: result.replySent
    });
    return true;
  }

  // ── Connector: unified ingest endpoint ──────────────────────────────────
  if (req.url?.startsWith("/connectors/events/ingest") && req.method === "POST") {
    const auth = await authorize(req, res, "POST /connectors/events/ingest");
    if (!auth.ok) return true;

    const body = (await parseBody(req)) as {
      connectorKey?: unknown; eventType?: unknown; guestPhone?: unknown;
      guestName?: unknown; messageText?: unknown; aiProvider?: unknown; sendReply?: unknown;
    };
    const connectorKey = asTrimmedString(body.connectorKey);
    const messageText = asTrimmedString(body.messageText);
    if (!connectorKey || !messageText) {
      json(res, 400, { ok: false, error: "connectorKey and messageText are required" }); return true;
    }
    const aiProv = asTrimmedString(body.aiProvider) === "openai" ? "openai" as const : "claude" as const;

    const result = await ingestConnectorEvent({
      tenantId: auth.context.tenantId,
      connectorKey,
      eventType: asTrimmedString(body.eventType) ?? "inbound_message",
      guestPhone: asTrimmedString(body.guestPhone) ?? undefined,
      guestName: asTrimmedString(body.guestName) ?? undefined,
      messageText,
      rawPayload: body,
      aiProvider: aiProv,
      sendReply: body.sendReply !== false
    });

    json(res, 201, { ok: true, ...result });
    return true;
  }

  // ── Connector: event log ────────────────────────────────────────────────
  if (req.url?.startsWith("/connectors/events") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /connectors/events");
    if (!auth.ok) return true;

    const qs = parseUrl(req.url).searchParams;
    // Use the hardened helpers — a raw Number("abc") here yielded take: NaN, which
    // made Prisma throw and surfaced as an opaque 500 (F-…). Every other list route
    // already uses these.
    const limit = asSafeLimit(qs.get("limit"), 20, 100);
    const offset = asSafeOffset(qs.get("offset"));
    const connectorKey = qs.get("connectorKey") ?? undefined;

    const [items, total] = await Promise.all([
      prisma.connectorEvent.findMany({
        where: { tenantId: auth.context.tenantId, ...(connectorKey ? { connectorKey } : {}) },
        orderBy: { createdAt: "desc" },
        take: limit,
        skip: offset,
        select: {
          id: true, connectorKey: true, eventType: true, guestPhone: true,
          guestName: true, aiProvider: true, aiCategory: true, aiPriority: true,
          aiSummary: true, aiSentiment: true, aiRoutingHint: true,
          serviceRequestId: true, replySentAt: true, replyStatus: true, createdAt: true
        }
      }),
      prisma.connectorEvent.count({ where: { tenantId: auth.context.tenantId, ...(connectorKey ? { connectorKey } : {}) } })
    ]);

    json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
    return true;
  }

  // ── Connector: outbound WhatsApp send ───────────────────────────────────
  if (req.url?.startsWith("/connectors/whatsapp/send") && req.method === "POST") {
    const auth = await authorize(req, res, "POST /connectors/whatsapp/send");
    if (!auth.ok) return true;

    const body = (await parseBody(req)) as { toPhone?: unknown; message?: unknown };
    const toPhone = asTrimmedString(body.toPhone);
    const message = asTrimmedString(body.message);
    if (!toPhone || !message) {
      json(res, 400, { ok: false, error: "toPhone and message are required" }); return true;
    }

    // Guardrail (#168): even a manual staff send must honour the durable opt-out /
    // DND list — a subject who texted STOP (or was suppressed/erased) is never
    // contacted. Caps/quiet-hours don't apply to a human-initiated send.
    const { evaluateOutboundSend } = await import("./messaging-guardrails");
    const guard = await evaluateOutboundSend({ tenantId: auth.context.tenantId, phone: toPhone, kind: "manual" });
    if (!guard.allowed) {
      json(res, 403, { ok: false, error: `Cannot message this subject: ${guard.reason}` }); return true;
    }

    const { sendWhatsAppReply } = await import("./whatsapp-outbound");
    const result = await sendWhatsAppReply(auth.context.tenantId, toPhone, message);
    json(res, result.sent ? 200 : 503, { ok: result.sent, ...result });
    return true;
  }

  return false;
}
