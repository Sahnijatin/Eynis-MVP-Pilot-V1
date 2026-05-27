import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { InMemoryEventBus } from "./events/event-bus";
import { prisma } from "./db/prisma";
import type { UserRole } from "@eynis/shared";
import { createAuthToken, parseBearerToken, verifyAuthToken } from "./core/auth";
import { normalizeWhatsappInbound } from "./core/connectors/whatsapp";
import { ingestConnectorEvent } from "./core/connectors/ingest";
import {
  AI_AVAILABLE,
  CLAUDE_AVAILABLE,
  OPENAI_AVAILABLE,
  type AIProvider,
  classifyInboundEvent,
  generateGuestIntelligence,
  generateMorningBriefing,
  generateRevenueInsights,
  generateNightAuditReport,
  type NightAuditData
} from "./core/ai/intelligence";
import { startAutomationWorker } from "./core/automations/engine";
import { registerSSEClient, removeSSEClient, broadcastSSEEvent } from "./sse/clients";
import { checkWebhookSignature } from "./core/connectors/webhook-verify";

const eventBus = new InMemoryEventBus();

eventBus.subscribe("service_request.created", (event) => {
  // Placeholder for upcoming Day 3 worker hooks.
  void event;
});

const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

const parseRawBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
};

const parseBody = async (req: IncomingMessage): Promise<unknown> => {
  const raw = await parseRawBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
};

const hasString = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const asTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asPositiveInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};
const parseUrl = (url: string | undefined) => new URL(url ?? "/", "http://localhost");
const asSafeLimit = (value: string | null, fallback: number, max: number) => {
  const parsed = asPositiveInt(value);
  if (!parsed) {
    return fallback;
  }
  return Math.min(parsed, max);
};
const asSafeOffset = (value: string | null) => {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const ensureHotelAccess = async (hotelId: string) => {
  const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { id: true } });
  return Boolean(hotel);
};

const normalizePhone = (value: string) => value.replace(/\s+/g, "");

const upsertGuestByPhone = async (hotelId: string, fullName: string, phoneE164: string) => {
  const existing = await prisma.guest.findFirst({
    where: { hotelId, phoneE164 },
    select: { id: true }
  });
  if (existing) {
    return existing.id;
  }
  const guest = await prisma.guest.create({
    data: { hotelId, fullName, phoneE164 },
    select: { id: true }
  });
  return guest.id;
};

const createServiceRequestForHotel = async (input: {
  hotelId: string;
  guestId: string;
  category: string;
  summary: string;
  source: string;
  priority?: string;
  slaMinutes?: number | null;
}) => {
  const safePriority = input.priority ?? "normal";
  const safeSlaDueAt =
    input.slaMinutes && input.slaMinutes > 0
      ? new Date(Date.now() + input.slaMinutes * 60 * 1000)
      : null;
  return prisma.serviceRequest.create({
    data: {
      hotelId: input.hotelId,
      guestId: input.guestId,
      category: input.category,
      status: "open",
      source: input.source,
      summary: input.summary,
      priority: safePriority,
      slaDueAt: safeSlaDueAt
    },
    select: {
      id: true,
      hotelId: true,
      guestId: true,
      category: true,
      status: true,
      source: true,
      summary: true,
      assignedToUserId: true,
      priority: true,
      slaDueAt: true,
      slaBreachedAt: true,
      createdAt: true
    }
  });
};

const authError = "Missing or invalid bearer token";

const getAuthenticatedContext = async (req: IncomingMessage) => {
  const token = parseBearerToken(req);
  if (!token) {
    return { ok: false as const, status: 401, error: authError };
  }
  const claims = await verifyAuthToken(token);
  if (!claims) {
    return { ok: false as const, status: 401, error: authError };
  }

  const user = await prisma.user.findFirst({
    where: {
      id: claims.sub,
      hotelId: claims.hotelId,
      email: claims.email,
      role: claims.role,
      isActive: true
    },
    select: { id: true, hotelId: true, email: true, role: true, fullName: true }
  });

  if (!user) {
    return { ok: false as const, status: 401, error: "User not found or role mismatch" };
  }

  return {
    ok: true as const,
    context: {
      hotelId: user.hotelId,
      role: user.role as UserRole,
      email: user.email,
      userId: user.id,
      fullName: user.fullName,
      sub: user.id
    }
  };
};

const isAllowedRole = (role: UserRole, allowedRoles: UserRole[]) => allowedRoles.includes(role);

const parseServiceRequestStatusPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  const match = /^\/service-requests\/([^/]+)\/status$/.exec(url);
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
};

const parseServiceRequestAssignPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  const match = /^\/service-requests\/([^/]+)\/assign$/.exec(url);
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
};

const parseGuestIntelligencePath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/ai\/guest-intelligence\/([^/?]+)/.exec(parseUrl(url).pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const parseAIProvider = (url: string | undefined): AIProvider => {
  const p = parseUrl(url).searchParams.get("provider");
  return p === "openai" ? "openai" : "claude";
};

const parseConnectorConfigPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  const parsed = parseUrl(url);
  const match = /^\/connectors\/configs\/([^/]+)$/.exec(parsed.pathname);
  if (!match || !match[1]) {
    return null;
  }
  return decodeURIComponent(match[1]);
};

const policyMap: Record<string, UserRole[]> = {
  "GET /context": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "POST /events/service-request-created": ["owner", "front_desk"],
  "POST /service-requests": ["owner", "front_desk"],
  "GET /service-requests": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "PATCH /service-requests/:id/status": ["owner", "front_desk", "housekeeping"],
  "PATCH /service-requests/:id/assign": ["owner", "front_desk"],
  "POST /service-requests/sla/refresh": ["owner", "front_desk"],
  "GET /audit": ["owner", "front_desk"],
  "GET /dashboard/overview": ["owner", "front_desk", "fnb_manager"],
  "GET /dashboard/queue-summary": ["owner", "front_desk", "fnb_manager"],
  "GET /dashboard/live-feed": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "GET /users": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "GET /guests": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "GET /analytics/revenue-intelligence": ["owner", "front_desk", "fnb_manager"],
  "GET /analytics/staff-performance": ["owner", "front_desk"],
  "GET /analytics/sentiment": ["owner", "front_desk", "fnb_manager"],
  "GET /analytics/upsell-campaigns": ["owner", "front_desk", "fnb_manager"],
  "GET /automations": ["owner", "front_desk"],
  "GET /automations/executions": ["owner", "front_desk"],
  "GET /guests/:id": ["owner", "front_desk"],
  "GET /connectors/registry": ["owner", "front_desk", "fnb_manager"],
  "GET /connectors/configs": ["owner", "front_desk"],
  "PUT /connectors/configs/:key": ["owner", "front_desk"],
  "DELETE /connectors/configs/:key": ["owner", "front_desk"],
  "POST /connectors/events/ingest": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "GET /connectors/events": ["owner", "front_desk", "fnb_manager"],
  "POST /connectors/whatsapp/send": ["owner", "front_desk"],
  "GET /ai/providers": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "GET /ai/morning-briefing": ["owner", "front_desk", "fnb_manager"],
  "POST /ai/classify-event": ["owner", "front_desk", "housekeeping", "fnb_manager"],
  "GET /ai/guest-intelligence/:guestId": ["owner", "front_desk"],
  "GET /ai/revenue-insights": ["owner", "front_desk", "fnb_manager"],
  "POST /night-audit/generate": ["owner", "front_desk"],
  "GET /night-audit/latest": ["owner", "front_desk", "fnb_manager"],
  "POST /connectors/pms/webhook": ["owner", "front_desk"],
  "POST /connectors/pms/simulate": ["owner", "front_desk"]
};

const connectorRegistry = [
  {
    key: "whatsapp_interakt",
    category: "communication",
    envFlag: "CONNECTOR_WHATSAPP_INTERAKT_ENABLED",
    ingestModes: ["webhook", "outbound_api"]
  },
  {
    key: "whatsapp_twilio",
    category: "communication",
    envFlag: "CONNECTOR_WHATSAPP_TWILIO_ENABLED",
    ingestModes: ["webhook", "outbound_api"]
  },
  {
    key: "pms_hotelogix",
    category: "pms",
    envFlag: "CONNECTOR_PMS_HOTELOGIX_ENABLED",
    ingestModes: ["api", "webhook"]
  },
  {
    key: "pms_ezee",
    category: "pms",
    envFlag: "CONNECTOR_PMS_EZEE_ENABLED",
    ingestModes: ["api"]
  },
  {
    key: "pos_petpooja",
    category: "pos",
    envFlag: "CONNECTOR_POS_PETPOOJA_ENABLED",
    ingestModes: ["api"]
  },
  {
    key: "payments_razorpay",
    category: "payments",
    envFlag: "CONNECTOR_PAYMENTS_RAZORPAY_ENABLED",
    ingestModes: ["api", "payment_link"]
  }
] as const;

const envFlagByConnectorKey = new Map<string, string>(
  connectorRegistry.map((item) => [item.key, item.envFlag])
);

const maskConnectorConfig = (config: Record<string, unknown>) => {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const lowered = key.toLowerCase();
    const isSecretKey =
      lowered.includes("secret") ||
      lowered.includes("token") ||
      lowered.includes("password") ||
      lowered.endsWith("key");
    masked[key] = isSecretKey && typeof value === "string" && value.length > 0 ? "***" : value;
  }
  return masked;
};

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse
) => {
  try {
    if (req.url === "/auth/token" && req.method === "POST") {
      const body = (await parseBody(req)) as { hotelId?: unknown; email?: unknown; role?: unknown };
      const hotelId = asTrimmedString(body.hotelId);
      const email = asTrimmedString(body.email)?.toLowerCase();
      const role = asTrimmedString(body.role) as UserRole | null;
      if (!hotelId || !email || !role) {
        json(res, 400, { ok: false, error: "hotelId, email, role are required" });
        return;
      }
      const user = await prisma.user.findFirst({
        where: { hotelId, email, role, isActive: true },
        select: { id: true, hotelId: true, email: true, role: true }
      });
      if (!user) {
        json(res, 401, { ok: false, error: "Invalid user credentials" });
        return;
      }
      const token = await createAuthToken({
        sub: user.id,
        hotelId: user.hotelId,
        email: user.email,
        role: user.role as UserRole
      });
      json(res, 200, { ok: true, token });
      return;
    }

    if (req.url === "/health" && req.method === "GET") {
      json(res, 200, {
        ok: true,
        service: "eynis-api",
        timestamp: new Date().toISOString()
      });
      return;
    }

    // ── GET /sse/live-feed — real-time event stream ───────────────────────────
    if (req.url?.startsWith("/sse/live-feed") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no"
      });

      const clientId = registerSSEClient(res);
      res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

      const heartbeat = setInterval(() => {
        try { res.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); removeSSEClient(clientId); }
      }, 25000);

      req.on("close", () => { clearInterval(heartbeat); removeSSEClient(clientId); });
      return;
    }

    if (req.url === "/context" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }

      const hasAccess = await ensureHotelAccess(auth.context.hotelId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      if (!isAllowedRole(auth.context.role, policyMap["GET /context"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }
      json(res, 200, { ok: true, context: auth.context });
      return;
    }

    if (req.url === "/events/service-request-created" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["POST /events/service-request-created"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const hasAccess = await ensureHotelAccess(context.hotelId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      eventBus.publish({
        type: "service_request.created",
        hotelId: context.hotelId,
        payload: { source: "api" },
        createdAt: new Date().toISOString()
      });

      await prisma.auditLog.create({
        data: {
          hotelId: context.hotelId,
          actorRole: context.role,
          action: "service_request.created",
          entityType: "service_request",
          metadata: JSON.stringify({ source: "api" })
        }
      });

      json(res, 202, { ok: true });
      return;
    }

    if (req.url === "/public/requests" && req.method === "POST") {
      const body = (await parseBody(req)) as {
        hotelId?: unknown;
        guestName?: unknown;
        guestPhone?: unknown;
        category?: unknown;
        summary?: unknown;
        source?: unknown;
      };
      const hotelId = asTrimmedString(body.hotelId);
      const guestName = asTrimmedString(body.guestName);
      const guestPhoneRaw = asTrimmedString(body.guestPhone);
      const category = asTrimmedString(body.category) ?? "general";
      const summary = asTrimmedString(body.summary);
      const source = asTrimmedString(body.source) ?? "qr";
      const guestPhone = guestPhoneRaw ? normalizePhone(guestPhoneRaw) : null;

      if (!hotelId || !guestName || !guestPhone || !summary) {
        json(res, 400, {
          ok: false,
          error: "hotelId, guestName, guestPhone and summary are required"
        });
        return;
      }

      const hasAccess = await ensureHotelAccess(hotelId);
      if (!hasAccess) {
        json(res, 404, { ok: false, error: "Hotel not found" });
        return;
      }

      const guestId = await upsertGuestByPhone(hotelId, guestName, guestPhone);
      const serviceRequest = await createServiceRequestForHotel({
        hotelId,
        guestId,
        category,
        summary,
        source,
        priority: "normal"
      });

      await prisma.auditLog.create({
        data: {
          hotelId,
          actorRole: "guest",
          action: "service_request.created.public",
          entityType: "service_request",
          entityId: serviceRequest.id,
          metadata: JSON.stringify({ source, guestPhone })
        }
      });

      json(res, 201, { ok: true, item: serviceRequest });
      return;
    }

    if (req.url === "/integrations/whatsapp/webhook" && req.method === "POST") {
      const expected = asTrimmedString(process.env.WHATSAPP_WEBHOOK_SECRET);
      const provided = req.headers["x-webhook-secret"];
      const providedSecret =
        typeof provided === "string" ? provided : Array.isArray(provided) ? provided[0] : null;
      if (expected && providedSecret !== expected) {
        json(res, 401, { ok: false, error: "Invalid webhook secret" });
        return;
      }

      const rawBody = await parseRawBody(req);
      const enforce = process.env.VERIFY_WEBHOOKS === "true";

      const twilioSig = typeof req.headers["x-twilio-signature"] === "string" ? req.headers["x-twilio-signature"] : null;
      if (twilioSig !== null) {
        const fullUrl = `http://${req.headers.host ?? "localhost"}${req.url}`;
        const check = checkWebhookSignature({ provider: "twilio", signature: twilioSig, url: fullUrl, rawBody, params: {}, enforce });
        if (!check.ok) { json(res, 401, { ok: false, error: check.reason ?? "Twilio signature verification failed" }); return; }
      }

      const interaktSig = typeof req.headers["x-hub-signature-256"] === "string"
        ? req.headers["x-hub-signature-256"]
        : typeof req.headers["x-interakt-signature"] === "string"
        ? req.headers["x-interakt-signature"]
        : null;
      if (interaktSig !== null) {
        const check = checkWebhookSignature({ provider: "interakt", signature: interaktSig, url: req.url ?? "", rawBody, enforce });
        if (!check.ok) { json(res, 401, { ok: false, error: check.reason ?? "Interakt signature verification failed" }); return; }
      }

      const body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
      const normalized = normalizeWhatsappInbound(body);
      if (!normalized) {
        json(res, 400, {
          ok: false,
          error: "Unable to normalize webhook payload. Provide provider-compatible payload with hotelId, sender phone and message."
        });
        return;
      }
      const { hotelId, fromPhone, message, guestName, provider } = normalized;
      const hasAccess = await ensureHotelAccess(hotelId);
      if (!hasAccess) {
        json(res, 404, { ok: false, error: "Hotel not found" });
        return;
      }

      const result = await ingestConnectorEvent({
        hotelId,
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
      return;
    }

    // ── Connector: unified ingest endpoint ──────────────────────────────────
    if (req.url?.startsWith("/connectors/events/ingest") && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["POST /connectors/events/ingest"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }

      const body = (await parseBody(req)) as {
        connectorKey?: unknown; eventType?: unknown; guestPhone?: unknown;
        guestName?: unknown; messageText?: unknown; aiProvider?: unknown; sendReply?: unknown;
      };
      const connectorKey = asTrimmedString(body.connectorKey);
      const messageText = asTrimmedString(body.messageText);
      if (!connectorKey || !messageText) {
        json(res, 400, { ok: false, error: "connectorKey and messageText are required" }); return;
      }
      const aiProv = asTrimmedString(body.aiProvider) === "openai" ? "openai" as const : "claude" as const;

      const result = await ingestConnectorEvent({
        hotelId: auth.context.hotelId,
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
      return;
    }

    // ── Connector: event log ────────────────────────────────────────────────
    if (req.url?.startsWith("/connectors/events") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /connectors/events"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }

      const qs = parseUrl(req.url).searchParams;
      const limit = Math.min(Number(qs.get("limit") ?? 20), 100);
      const offset = Math.max(Number(qs.get("offset") ?? 0), 0);
      const connectorKey = qs.get("connectorKey") ?? undefined;

      const [items, total] = await Promise.all([
        prisma.connectorEvent.findMany({
          where: { hotelId: auth.context.hotelId, ...(connectorKey ? { connectorKey } : {}) },
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
        prisma.connectorEvent.count({ where: { hotelId: auth.context.hotelId, ...(connectorKey ? { connectorKey } : {}) } })
      ]);

      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + limit < total } });
      return;
    }

    // ── Connector: outbound WhatsApp send ───────────────────────────────────
    if (req.url?.startsWith("/connectors/whatsapp/send") && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["POST /connectors/whatsapp/send"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }

      const body = (await parseBody(req)) as { toPhone?: unknown; message?: unknown };
      const toPhone = asTrimmedString(body.toPhone);
      const message = asTrimmedString(body.message);
      if (!toPhone || !message) {
        json(res, 400, { ok: false, error: "toPhone and message are required" }); return;
      }

      const { sendWhatsAppReply } = await import("./core/connectors/whatsapp-outbound");
      const result = await sendWhatsAppReply(auth.context.hotelId, toPhone, message);
      json(res, result.sent ? 200 : 503, { ok: result.sent, ...result });
      return;
    }

    if (req.url === "/service-requests" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      const hasAccess = await ensureHotelAccess(context.hotelId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }
      if (!isAllowedRole(context.role, policyMap["POST /service-requests"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const body = (await parseBody(req)) as {
        guestId?: unknown;
        guestName?: unknown;
        guestPhone?: unknown;
        category?: unknown;
        summary?: unknown;
        source?: unknown;
        priority?: unknown;
        slaMinutes?: unknown;
      };

      let guestId: string | null = null;
      const guestIdInput = asTrimmedString(body.guestId);
      const guestNameInput = asTrimmedString(body.guestName);
      const guestPhoneInput = asTrimmedString(body.guestPhone);
      const categoryInput = asTrimmedString(body.category);
      const summaryInput = asTrimmedString(body.summary);
      const sourceInput = asTrimmedString(body.source) ?? "whatsapp";
      const priorityInput = asTrimmedString(body.priority) ?? "normal";
      const slaMinutes = asPositiveInt(body.slaMinutes);
      const slaDueAt = slaMinutes ? new Date(Date.now() + slaMinutes * 60 * 1000) : null;

      if (!categoryInput || !summaryInput) {
        json(res, 400, { ok: false, error: "category and summary are required" });
        return;
      }

      if (guestIdInput) {
        const guest = await prisma.guest.findFirst({
          where: { id: guestIdInput, hotelId: context.hotelId },
          select: { id: true }
        });
        if (!guest) {
          json(res, 404, { ok: false, error: "Guest not found for this hotel" });
          return;
        }
        guestId = guest.id;
      } else if (guestNameInput && guestPhoneInput) {
        const guest = await prisma.guest.create({
          data: {
            hotelId: context.hotelId,
            fullName: guestNameInput,
            phoneE164: guestPhoneInput
          }
        });
        guestId = guest.id;
      } else {
        json(res, 400, {
          ok: false,
          error: "Provide either guestId or both guestName and guestPhone"
        });
        return;
      }

      const serviceRequest = await prisma.serviceRequest.create({
        data: {
          hotelId: context.hotelId,
          guestId,
          category: categoryInput,
          status: "open",
          source: sourceInput,
          summary: summaryInput,
          assignedToUserId: context.role === "front_desk" ? context.userId : null,
          priority: priorityInput,
          slaDueAt
        },
        select: {
          id: true,
          hotelId: true,
          guestId: true,
          category: true,
          status: true,
          source: true,
          summary: true,
          assignedToUserId: true,
          priority: true,
          slaDueAt: true,
          slaBreachedAt: true,
          createdAt: true
        }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: context.hotelId,
          actorRole: context.role,
        action: "service_request.created",
        entityType: "service_request",
          entityId: serviceRequest.id,
          metadata: JSON.stringify({
            source: serviceRequest.source,
            category: serviceRequest.category
          })
        }
      });

      json(res, 201, { ok: true, item: serviceRequest });
      return;
    }

    if (req.url?.startsWith("/service-requests") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      const hasAccess = await ensureHotelAccess(context.hotelId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      if (!isAllowedRole(context.role, policyMap["GET /service-requests"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const statusFilter = asTrimmedString(parsedUrl.searchParams.get("status"));
      const onlyAssigned = parsedUrl.searchParams.get("assignedToMe") === "true";
      const slaState = asTrimmedString(parsedUrl.searchParams.get("slaState")); // pending|breached
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const sortByInput = asTrimmedString(parsedUrl.searchParams.get("sortBy")) ?? "createdAt";
      const sortOrderInput = asTrimmedString(parsedUrl.searchParams.get("sortOrder")) ?? "desc";
      const sortBy =
        sortByInput === "slaDueAt" || sortByInput === "status" ? sortByInput : "createdAt";
      const sortOrder = sortOrderInput === "asc" ? "asc" : "desc";

      const where: {
        hotelId: string;
        status?: string;
        assignedToUserId?: string;
        slaDueAt?: { not: null; gte?: Date; lt?: Date };
      } = { hotelId: context.hotelId };
      if (statusFilter) {
        where.status = statusFilter;
      }
      if (onlyAssigned) {
        where.assignedToUserId = context.userId;
      }
      if (slaState === "pending") {
        where.slaDueAt = { not: null, gte: new Date() };
      }
      if (slaState === "breached") {
        where.slaDueAt = { not: null, lt: new Date() };
      }

      const [items, total] = await Promise.all([
        prisma.serviceRequest.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: offset,
          take: limit,
          select: {
            id: true,
            hotelId: true,
            guestId: true,
            category: true,
            status: true,
            source: true,
            summary: true,
            assignedToUserId: true,
            priority: true,
            slaDueAt: true,
            slaBreachedAt: true,
            createdAt: true
          }
        }),
        prisma.serviceRequest.count({ where })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    if (req.url === "/service-requests/sla/refresh" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["POST /service-requests/sla/refresh"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const now = new Date();
      const result = await prisma.serviceRequest.updateMany({
        where: {
          hotelId: context.hotelId,
          status: { not: "resolved" },
          slaDueAt: { not: null, lt: now },
          slaBreachedAt: null
        },
        data: {
          slaBreachedAt: now
        }
      });

      json(res, 200, { ok: true, breachedMarked: result.count });
      return;
    }

    const requestId = parseServiceRequestStatusPath(req.url);
    if (requestId && req.method === "PATCH") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["PATCH /service-requests/:id/status"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const body = (await parseBody(req)) as { status?: unknown };
      const nextStatus = asTrimmedString(body.status);
      if (!nextStatus || !["accepted", "resolved", "escalated"].includes(nextStatus)) {
        json(res, 400, {
          ok: false,
          error: "status must be one of: accepted, resolved, escalated"
        });
        return;
      }

      const existing = await prisma.serviceRequest.findFirst({
        where: { id: requestId, hotelId: context.hotelId },
        select: { id: true, status: true }
      });
      if (!existing) {
        json(res, 404, { ok: false, error: "Service request not found" });
        return;
      }
      if (existing.status === "resolved") {
        json(res, 409, { ok: false, error: "Resolved request cannot transition" });
        return;
      }

      const updated = await prisma.serviceRequest.update({
        where: { id: requestId },
        data: {
          status: nextStatus,
          resolvedAt: nextStatus === "resolved" ? new Date() : null
        },
        select: {
          id: true,
          hotelId: true,
          guestId: true,
          category: true,
          status: true,
          source: true,
          summary: true,
          assignedToUserId: true,
          priority: true,
          slaDueAt: true,
          slaBreachedAt: true,
          createdAt: true,
          resolvedAt: true
        }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: context.hotelId,
          actorRole: context.role,
          action: "service_request.status_changed",
          entityType: "service_request",
          entityId: updated.id,
          metadata: JSON.stringify({
            from: existing.status,
            to: nextStatus,
            actorEmail: context.email
          })
        }
      });

      await prisma.serviceRequestTransition.create({
        data: {
          hotelId: context.hotelId,
          serviceRequestId: updated.id,
          fromStatus: existing.status,
          toStatus: nextStatus,
          changedByUserId: context.userId
        }
      });

      broadcastSSEEvent({ type: "sr_updated", data: { id: updated.id, status: nextStatus } });
      json(res, 200, { ok: true, item: updated });
      return;
    }

    if (req.url === "/dashboard/overview" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /dashboard/overview"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }
      const [openCount, resolvedTodayCount, escalatedOpenCount, slaBreachedOpenCount] =
        await Promise.all([
          prisma.serviceRequest.count({
            where: { hotelId: context.hotelId, status: { not: "resolved" } }
          }),
          prisma.serviceRequest.count({
            where: {
              hotelId: context.hotelId,
              status: "resolved",
              resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
            }
          }),
          prisma.serviceRequest.count({
            where: { hotelId: context.hotelId, status: "escalated" }
          }),
          prisma.serviceRequest.count({
            where: {
              hotelId: context.hotelId,
              status: { not: "resolved" },
              slaDueAt: { not: null, lt: new Date() }
            }
          })
        ]);

      json(res, 200, {
        ok: true,
        metrics: {
          openCount,
          resolvedTodayCount,
          escalatedOpenCount,
          slaBreachedOpenCount
        }
      });
      return;
    }

    if (req.url === "/dashboard/queue-summary" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /dashboard/queue-summary"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const rows = await prisma.serviceRequest.findMany({
        where: { hotelId: context.hotelId, status: { not: "resolved" } },
        select: { status: true, priority: true, category: true }
      });

      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const row of rows) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
        byPriority[row.priority] = (byPriority[row.priority] ?? 0) + 1;
        byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      }

      json(res, 200, {
        ok: true,
        totalOpen: rows.length,
        byStatus,
        byPriority,
        byCategory
      });
      return;
    }

    if (req.url?.startsWith("/dashboard/trends") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /dashboard/overview"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const days = asSafeLimit(parsedUrl.searchParams.get("days"), 7, 30);
      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setHours(0, 0, 0, 0);
      windowStart.setDate(windowStart.getDate() - (days - 1));

      const [createdRows, resolvedRows] = await Promise.all([
        prisma.serviceRequest.findMany({
          where: { hotelId: context.hotelId, createdAt: { gte: windowStart } },
          select: { createdAt: true }
        }),
        prisma.serviceRequest.findMany({
          where: {
            hotelId: context.hotelId,
            status: "resolved",
            resolvedAt: { not: null, gte: windowStart }
          },
          select: { resolvedAt: true }
        })
      ]);

      const buckets = new Map<string, { date: string; created: number; resolved: number }>();
      for (let i = 0; i < days; i += 1) {
        const d = new Date(windowStart);
        d.setDate(windowStart.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, { date: key, created: 0, resolved: 0 });
      }
      for (const row of createdRows) {
        const key = row.createdAt.toISOString().slice(0, 10);
        const current = buckets.get(key);
        if (current) current.created += 1;
      }
      for (const row of resolvedRows) {
        if (!row.resolvedAt) continue;
        const key = row.resolvedAt.toISOString().slice(0, 10);
        const current = buckets.get(key);
        if (current) current.resolved += 1;
      }

      json(res, 200, { ok: true, days, series: Array.from(buckets.values()) });
      return;
    }

    if (req.url === "/analytics/revenue-intelligence" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /analytics/revenue-intelligence"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const [offerEvents, openRequests] = await Promise.all([
        prisma.offerEvent.findMany({
          where: { hotelId: context.hotelId },
          select: { offerType: true, status: true, revenueInr: true }
        }),
        prisma.serviceRequest.count({
          where: { hotelId: context.hotelId, status: { not: "resolved" } }
        })
      ]);

      const grouped = new Map<string, { sent: number; accepted: number; revenueInr: number }>();
      let sentOffers = 0;
      let acceptedOffers = 0;
      let totalUpsellInr = 0;
      let lateCheckoutInr = 0;
      for (const ev of offerEvents) {
        const key = ev.offerType || "unknown";
        const current = grouped.get(key) ?? { sent: 0, accepted: 0, revenueInr: 0 };
        current.sent += 1;
        sentOffers += 1;
        if (ev.status === "accepted" || ev.status === "converted") {
          current.accepted += 1;
          current.revenueInr += ev.revenueInr;
          acceptedOffers += 1;
          totalUpsellInr += ev.revenueInr;
          if (key.toLowerCase().includes("late_checkout")) {
            lateCheckoutInr += ev.revenueInr;
          }
        }
        grouped.set(key, current);
      }

      const byAutomationType = Array.from(grouped.entries())
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.revenueInr - a.revenueInr);
      const topConvertingOffers = byAutomationType
        .filter((x) => x.sent > 0)
        .map((x) => ({
          offerType: x.key,
          sent: x.sent,
          accepted: x.accepted,
          conversionRate: Number(((x.accepted / x.sent) * 100).toFixed(2))
        }))
        .sort((a, b) => b.conversionRate - a.conversionRate)
        .slice(0, 6);

      const leftOnTableInr = Math.max(0, (sentOffers - acceptedOffers) * 700 + openRequests * 400);
      json(res, 200, {
        ok: true,
        totals: {
          totalUpsellInr,
          acceptedOffers,
          sentOffers,
          lateCheckoutInr,
          leftOnTableInr
        },
        byAutomationType,
        topConvertingOffers,
        funnel: {
          triggered: sentOffers,
          sent: sentOffers,
          opened: sentOffers,
          accepted: acceptedOffers,
          revenueInr: totalUpsellInr
        }
      });
      return;
    }

    if (req.url === "/analytics/staff-performance" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /analytics/staff-performance"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const users = await prisma.user.findMany({
        where: { hotelId: context.hotelId, isActive: true },
        select: { id: true, fullName: true, role: true }
      });
      const requests = await prisma.serviceRequest.findMany({
        where: { hotelId: context.hotelId },
        select: { status: true, assignedToUserId: true, createdAt: true, resolvedAt: true }
      });

      const byUser = new Map<string, { completed: number; minutesTotal: number; open: number }>();
      for (const u of users) byUser.set(u.id, { completed: 0, minutesTotal: 0, open: 0 });

      let resolvedCount = 0;
      let totalMinutes = 0;
      let openCount = 0;
      for (const reqRow of requests) {
        const isResolved = reqRow.status === "resolved" && reqRow.resolvedAt;
        if (isResolved && reqRow.resolvedAt) {
          const minutes = Math.max(
            1,
            Math.round((reqRow.resolvedAt.getTime() - reqRow.createdAt.getTime()) / 60000)
          );
          resolvedCount += 1;
          totalMinutes += minutes;
          if (reqRow.assignedToUserId && byUser.has(reqRow.assignedToUserId)) {
            const current = byUser.get(reqRow.assignedToUserId)!;
            current.completed += 1;
            current.minutesTotal += minutes;
            byUser.set(reqRow.assignedToUserId, current);
          }
        } else {
          openCount += 1;
          if (reqRow.assignedToUserId && byUser.has(reqRow.assignedToUserId)) {
            const current = byUser.get(reqRow.assignedToUserId)!;
            current.open += 1;
            byUser.set(reqRow.assignedToUserId, current);
          }
        }
      }

      const completionRate =
        requests.length === 0 ? 0 : Number(((resolvedCount / requests.length) * 100).toFixed(2));
      const avgResolutionMinutes = resolvedCount === 0 ? 0 : Math.round(totalMinutes / resolvedCount);
      const utilizationRate =
        users.length === 0 ? 0 : Number((Math.min(100, (openCount / users.length) * 22)).toFixed(2));

      const leaderboard = users
        .map((u) => {
          const row = byUser.get(u.id)!;
          return {
            userId: u.id,
            fullName: u.fullName,
            role: u.role,
            completedTasks: row.completed,
            avgResolutionMinutes:
              row.completed === 0 ? 0 : Number((row.minutesTotal / row.completed).toFixed(2))
          };
        })
        .sort((a, b) => b.completedTasks - a.completedTasks)
        .slice(0, 10);

      const roleMap = new Map<string, { openTasks: number; resolvedTasks: number }>();
      for (const u of users) {
        const row = byUser.get(u.id)!;
        const current = roleMap.get(u.role) ?? { openTasks: 0, resolvedTasks: 0 };
        current.openTasks += row.open;
        current.resolvedTasks += row.completed;
        roleMap.set(u.role, current);
      }
      const workloadByRole = Array.from(roleMap.entries()).map(([role, value]) => ({
        role,
        ...value
      }));

      const alerts: string[] = [];
      if (openCount > resolvedCount) alerts.push("Open requests exceed resolved requests in current window");
      for (const [role, value] of roleMap.entries()) {
        if (value.openTasks > value.resolvedTasks * 1.5 && value.openTasks >= 3) {
          alerts.push(role + " workload imbalance detected");
        }
      }

      json(res, 200, {
        ok: true,
        summary: {
          avgResolutionMinutes,
          completionRate,
          avgGuestRating: 0,
          utilizationRate
        },
        leaderboard,
        workloadByRole,
        alerts
      });
      return;
    }

    if (req.url === "/connectors/registry" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /connectors/registry"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const configs = await prisma.connectorConfig.findMany({
        where: { hotelId: context.hotelId },
        select: { connectorKey: true, enabled: true }
      });
      const configMap = new Map(configs.map((c) => [c.connectorKey, c.enabled]));
      const items = connectorRegistry.map((item) => {
        const persisted = configMap.get(item.key);
        const envEnabled = String(process.env[item.envFlag] ?? "").toLowerCase() === "true";
        const enabled = typeof persisted === "boolean" ? persisted : envEnabled;
        return {
          key: item.key,
          category: item.category,
          enabled,
          status: enabled ? ("ready" as const) : ("disabled" as const),
          source: typeof persisted === "boolean" ? ("hotel_config" as const) : ("env" as const),
          ingestModes: item.ingestModes
        };
      });
      json(res, 200, { ok: true, items });
      return;
    }

    if (req.url?.startsWith("/connectors/configs") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /connectors/configs"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const items = await prisma.connectorConfig.findMany({
        where: { hotelId: context.hotelId },
        orderBy: { connectorKey: "asc" },
        select: { connectorKey: true, enabled: true, configJson: true, updatedAt: true }
      });
      json(res, 200, {
        ok: true,
        items: items.map((item) => {
          let parsed: Record<string, unknown> = {};
          try {
            const maybe = JSON.parse(item.configJson) as Record<string, unknown>;
            parsed = maybe && typeof maybe === "object" ? maybe : {};
          } catch {
            parsed = {};
          }
          return {
            key: item.connectorKey,
            enabled: item.enabled,
            config: maskConnectorConfig(parsed),
            updatedAt: item.updatedAt
          };
        })
      });
      return;
    }

    const connectorConfigKey = parseConnectorConfigPath(req.url);
    if (connectorConfigKey && req.method === "PUT") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["PUT /connectors/configs/:key"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }
      if (!envFlagByConnectorKey.has(connectorConfigKey)) {
        json(res, 404, { ok: false, error: "Unknown connector key" });
        return;
      }

      const body = (await parseBody(req)) as { enabled?: unknown; config?: unknown };
      const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
      const config = body.config && typeof body.config === "object" ? body.config : {};
      const configJson = JSON.stringify(config);
      const saved = await prisma.connectorConfig.upsert({
        where: { hotelId_connectorKey: { hotelId: context.hotelId, connectorKey: connectorConfigKey } },
        create: {
          hotelId: context.hotelId,
          connectorKey: connectorConfigKey,
          enabled,
          configJson
        },
        update: {
          enabled,
          configJson
        },
        select: { connectorKey: true, enabled: true, configJson: true, updatedAt: true }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: context.hotelId,
          actorRole: context.role,
          action: "connector.config.updated",
          entityType: "connector_config",
          entityId: saved.connectorKey,
          metadata: JSON.stringify({ connectorKey: saved.connectorKey, enabled: saved.enabled })
        }
      });

      let parsed: Record<string, unknown> = {};
      try {
        const maybe = JSON.parse(saved.configJson) as Record<string, unknown>;
        parsed = maybe && typeof maybe === "object" ? maybe : {};
      } catch {
        parsed = {};
      }

      json(res, 200, {
        ok: true,
        item: {
          key: saved.connectorKey,
          enabled: saved.enabled,
          config: maskConnectorConfig(parsed),
          updatedAt: saved.updatedAt
        }
      });
      return;
    }

    if (connectorConfigKey && req.method === "DELETE") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["DELETE /connectors/configs/:key"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      await prisma.connectorConfig.deleteMany({
        where: { hotelId: context.hotelId, connectorKey: connectorConfigKey }
      });
      await prisma.auditLog.create({
        data: {
          hotelId: context.hotelId,
          actorRole: context.role,
          action: "connector.config.deleted",
          entityType: "connector_config",
          entityId: connectorConfigKey,
          metadata: JSON.stringify({ connectorKey: connectorConfigKey })
        }
      });
      json(res, 200, { ok: true });
      return;
    }

    if (req.url?.startsWith("/users") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /users"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const roleFilter = asTrimmedString(parsedUrl.searchParams.get("role"));
      const isActiveFilter = asTrimmedString(parsedUrl.searchParams.get("isActive"));
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 50, 200);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));

      const where: { hotelId: string; role?: string; isActive?: boolean } = {
        hotelId: context.hotelId
      };
      if (roleFilter) where.role = roleFilter;
      if (isActiveFilter === "true") where.isActive = true;
      if (isActiveFilter === "false") where.isActive = false;

      const [items, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { fullName: "asc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true
          }
        }),
        prisma.user.count({ where })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    const assignRequestId = parseServiceRequestAssignPath(req.url);
    if (assignRequestId && req.method === "PATCH") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["PATCH /service-requests/:id/assign"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }

      const body = (await parseBody(req)) as { assigneeEmail?: unknown };
      const assigneeEmail = asTrimmedString(body.assigneeEmail)?.toLowerCase();
      if (!assigneeEmail) {
        json(res, 400, { ok: false, error: "assigneeEmail is required" });
        return;
      }

      const assignee = await prisma.user.findFirst({
        where: { hotelId: context.hotelId, email: assigneeEmail, isActive: true },
        select: { id: true, email: true }
      });
      if (!assignee) {
        json(res, 404, { ok: false, error: "Assignee not found in this hotel" });
        return;
      }

      const existing = await prisma.serviceRequest.findFirst({
        where: { id: assignRequestId, hotelId: context.hotelId },
        select: { id: true, assignedToUserId: true }
      });
      if (!existing) {
        json(res, 404, { ok: false, error: "Service request not found" });
        return;
      }

      const updated = await prisma.serviceRequest.update({
        where: { id: assignRequestId },
        data: { assignedToUserId: assignee.id },
        select: { id: true, assignedToUserId: true }
      });

      await prisma.auditLog.create({
        data: {
          hotelId: context.hotelId,
          actorRole: context.role,
          action: "service_request.assigned",
          entityType: "service_request",
          entityId: updated.id,
          metadata: JSON.stringify({
            fromUserId: existing.assignedToUserId,
            toUserId: assignee.id,
            toEmail: assignee.email
          })
        }
      });

      json(res, 200, { ok: true, item: updated });
      return;
    }

    if (req.url?.startsWith("/service-requests/") && req.url.endsWith("/transitions") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      const transitionRequestId = /^\/service-requests\/([^/]+)\/transitions$/.exec(req.url)?.[1];
      if (!transitionRequestId) {
        json(res, 400, { ok: false, error: "Invalid path" });
        return;
      }

      const exists = await prisma.serviceRequest.findFirst({
        where: { id: transitionRequestId, hotelId: context.hotelId },
        select: { id: true }
      });
      if (!exists) {
        json(res, 404, { ok: false, error: "Service request not found" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const [items, total] = await Promise.all([
        prisma.serviceRequestTransition.findMany({
          where: { hotelId: context.hotelId, serviceRequestId: transitionRequestId },
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            changedByUserId: true,
            note: true,
            createdAt: true
          }
        }),
        prisma.serviceRequestTransition.count({
          where: { hotelId: context.hotelId, serviceRequestId: transitionRequestId }
        })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    if (req.url === "/audit" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /audit"])) {
        json(res, 403, { ok: false, error: "Role not permitted for this action" });
        return;
      }
      const hasAccess = await ensureHotelAccess(context.hotelId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { hotelId: context.hotelId },
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            hotelId: true,
            actorRole: true,
            action: true,
            entityType: true,
            entityId: true,
            metadata: true,
            createdAt: true
          }
        }),
        prisma.auditLog.count({ where: { hotelId: context.hotelId } })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    // ── GET /dashboard/live-feed ─────────────────────────────────────────────
    if (req.url?.startsWith("/dashboard/live-feed") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /dashboard/live-feed"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const items = await prisma.serviceRequest.findMany({
        where: { hotelId: context.hotelId, status: { not: "resolved" } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          category: true,
          status: true,
          summary: true,
          priority: true,
          createdAt: true,
          assignedToUserId: true,
          guest: { select: { fullName: true } },
          assignedTo: { select: { fullName: true } }
        }
      });
      json(res, 200, { ok: true, items });
      return;
    }

    // ── GET /guests/:id ──────────────────────────────────────────────────────
    const guestIdMatch = /^\/guests\/([^/?]+)/.exec(req.url ?? "");
    if (guestIdMatch && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /guests/:id"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const guestId = guestIdMatch[1]!;
      const { hotelId } = auth.context;
      const guest = await prisma.guest.findFirst({
        where: { id: guestId, hotelId },
        include: {
          stays: { orderBy: { checkInAt: "desc" }, take: 5 },
          serviceRequests: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: { assignedTo: { select: { fullName: true } } }
          }
        }
      });
      if (!guest) { json(res, 404, { ok: false, error: "Guest not found" }); return; }
      const connectorEvents = await prisma.connectorEvent.findMany({
        where: { hotelId, guestId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, connectorKey: true, aiCategory: true, aiSummary: true, aiSentiment: true, replyStatus: true, createdAt: true }
      });
      const totalSpend = await prisma.offerEvent.aggregate({
        where: { hotelId, guestId, status: "accepted" },
        _sum: { revenueInr: true }
      });
      const segments = ["Standard", "Business", "Family", "Solo", "Couple"];
      const segment = guest.visitCount >= 10 ? "VIP" : guest.visitCount >= 5 ? "Valued" : segments[guest.visitCount % segments.length];
      json(res, 200, {
        ok: true,
        guest: {
          id: guest.id, fullName: guest.fullName, phoneE164: guest.phoneE164,
          visitCount: guest.visitCount, segment, totalSpendInr: totalSpend._sum.revenueInr ?? 0,
          createdAt: guest.createdAt,
          currentStay: guest.stays[0] ?? null,
          stays: guest.stays,
          serviceRequests: guest.serviceRequests,
          connectorEvents
        }
      });
      return;
    }

    // ── GET /guests ──────────────────────────────────────────────────────────
    if (req.url?.startsWith("/guests") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /guests"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const parsedUrl = parseUrl(req.url);
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const search = asTrimmedString(parsedUrl.searchParams.get("search"));
      const where = {
        hotelId: context.hotelId,
        ...(search ? { OR: [
          { fullName: { contains: search } },
          { phoneE164: { contains: search } }
        ] } : {})
      };
      const [guests, total] = await Promise.all([
        prisma.guest.findMany({
          where,
          orderBy: { visitCount: "desc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
            visitCount: true,
            createdAt: true,
            stays: {
              orderBy: { checkInAt: "desc" },
              take: 1,
              select: { checkInAt: true, checkOutAt: true, roomNumber: true }
            },
            serviceRequests: {
              select: { id: true }
            }
          }
        }),
        prisma.guest.count({ where })
      ]);
      const segments = ["VIP", "Business", "Family", "Solo", "Couple"];
      const items = guests.map((g, i) => ({
        id: g.id,
        fullName: g.fullName,
        phoneE164: g.phoneE164,
        visitCount: g.visitCount,
        segment: g.visitCount >= 10 ? "VIP" : segments[(i + g.visitCount) % segments.length],
        status: g.stays[0]?.checkOutAt && new Date(g.stays[0].checkOutAt) < new Date() ? "CHECK-OUT" : "ACTIVE",
        lastStay: g.stays[0]?.checkInAt ?? g.createdAt,
        totalRequests: g.serviceRequests.length,
        createdAt: g.createdAt
      }));
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return;
    }

    // ── GET /automations/executions ──────────────────────────────────────────
    if (req.url?.startsWith("/automations/executions") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /automations/executions"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const u = parseUrl(req.url);
      const limit = asSafeLimit(u.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(u.searchParams.get("offset"));
      const [execs, total] = await Promise.all([
        prisma.automationExecution.findMany({
          where: { hotelId: auth.context.hotelId },
          orderBy: { executedAt: "desc" },
          skip: offset,
          take: limit
        }),
        prisma.automationExecution.count({ where: { hotelId: auth.context.hotelId } })
      ]);
      json(res, 200, {
        ok: true,
        items: execs.map((e) => ({
          id: e.id, ruleId: e.ruleId, ruleCode: e.ruleCode,
          triggerType: e.triggerType, triggerEntityId: e.triggerEntityId,
          actionType: e.actionType, actionResult: e.actionResult,
          resultDetail: e.resultDetail, executedAt: e.executedAt
        })),
        page: { limit, offset, total, hasMore: offset + limit < total }
      });
      return;
    }

    // ── GET /automations ─────────────────────────────────────────────────────
    if (req.url?.startsWith("/automations") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /automations"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const rules = await prisma.automationRule.findMany({
        where: { hotelId: context.hotelId },
        orderBy: { createdAt: "asc" },
        include: {
          automationExecutions: {
            orderBy: { executedAt: "desc" },
            take: 1,
            select: { executedAt: true }
          }
        }
      });
      // Execution counts per rule
      const execCounts = await prisma.automationExecution.groupBy({
        by: ["ruleId"],
        where: { hotelId: context.hotelId },
        _count: { id: true }
      });
      const successCounts = await prisma.automationExecution.groupBy({
        by: ["ruleId"],
        where: { hotelId: context.hotelId, actionResult: "success" },
        _count: { id: true }
      });
      const execMap = Object.fromEntries(execCounts.map((e) => [e.ruleId, e._count.id]));
      const successMap = Object.fromEntries(successCounts.map((e) => [e.ruleId, e._count.id]));

      const items = rules.map((r) => {
        let config: Record<string, unknown> = {};
        try { config = JSON.parse(r.configJson) as Record<string, unknown>; } catch { /**/ }
        const isMarketing = (config.ruleType as string) === "marketing";
        const stats = (config.stats as Record<string, number> | undefined) ?? {};
        const liveExecs = execMap[r.id] ?? 0;
        const liveSuccess = successMap[r.id] ?? 0;
        const executions = isMarketing ? (stats.executions ?? 0) + liveExecs : liveExecs;
        const conversions = isMarketing ? (stats.conversions ?? 0) + liveSuccess : liveSuccess;
        const revenueInr = isMarketing ? (stats.revenueInr ?? 0) : 0;
        const lastFiredAt = r.automationExecutions[0]?.executedAt ?? null;
        return {
          id: r.id, code: r.code, name: r.name, isActive: r.isActive,
          ruleType: isMarketing ? "marketing" : "operational",
          executions, conversions, revenueInr, lastFiredAt, createdAt: r.createdAt
        };
      });
      const totalExecutions = items.reduce((s, i) => s + i.executions, 0);
      const totalRevenue = items.reduce((s, i) => s + i.revenueInr, 0);
      const avgConversion = items.length > 0
        ? Math.round(items.reduce((s, i) => s + (i.executions > 0 ? i.conversions / i.executions : 0), 0) / items.length * 1000) / 10
        : 0;
      json(res, 200, {
        ok: true,
        items,
        summary: { totalAutomations: items.length, activeFlows: items.filter(i => i.isActive).length, avgConversion, revenueAttributed: totalRevenue, totalExecutions }
      });
      return;
    }

    // ── GET /analytics/sentiment ─────────────────────────────────────────────
    if (req.url?.startsWith("/analytics/sentiment") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /analytics/sentiment"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      // Compute sentiment from resolved service requests (used as proxy for feedback)
      const resolved = await prisma.serviceRequest.findMany({
        where: { hotelId: context.hotelId, status: "resolved" },
        select: { createdAt: true, resolvedAt: true, category: true }
      });
      const netScore = Math.min(99, 72 + resolved.length * 2);
      const positive = Math.round(resolved.length * 0.68);
      const neutral = Math.round(resolved.length * 0.17);
      const negative = resolved.length - positive - neutral;
      const bySource = [
        { source: "Post-Stay Survey", count: Math.round(resolved.length * 1.5) + 20 },
        { source: "Google Reviews", count: Math.round(resolved.length * 1.2) + 15 },
        { source: "TripAdvisor", count: Math.round(resolved.length * 0.9) + 10 },
        { source: "Booking.com", count: Math.round(resolved.length * 0.7) + 5 }
      ];
      const drivers = [
        { term: "Welcoming", weight: 0.9, sentiment: "positive" },
        { term: "Pristine", weight: 0.7, sentiment: "positive" },
        { term: "Prompt Service", weight: 0.8, sentiment: "positive" },
        { term: "Noisy AC", weight: 0.4, sentiment: "negative" },
        { term: "Wait times", weight: 0.3, sentiment: "negative" },
        { term: "Room view", weight: 0.6, sentiment: "positive" }
      ];
      const timeSeries = Array.from({ length: 30 }, (_, i) => ({
        day: i + 1,
        score: Math.round(60 + Math.random() * 30 + i * 0.5)
      }));
      json(res, 200, {
        ok: true,
        netScore: Math.min(netScore, 99),
        totalFeedback: positive + neutral + Math.max(0, negative),
        surveyCompletionRate: 0.68,
        breakdown: { positive, neutral, negative: Math.max(0, negative) },
        bySource,
        drivers,
        timeSeries,
        alert: { type: "warning", message: "Negative trend in F&B reviews" }
      });
      return;
    }

    // ── GET /analytics/upsell-campaigns ─────────────────────────────────────
    if (req.url?.startsWith("/analytics/upsell-campaigns") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!isAllowedRole(context.role, policyMap["GET /analytics/upsell-campaigns"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const rules = await prisma.automationRule.findMany({
        where: { hotelId: context.hotelId },
        orderBy: { createdAt: "asc" }
      });
      const campaignTriggers: Record<string, string> = {
        pre_arrival_welcome: "Pre-arrival email (T-48h)",
        checkin_breakfast_bundle: "Check-in Kiosk",
        spa_happy_hour: "Post-lunch SMS",
        late_checkout_upsell: "Departure Eve Push",
        post_stay_review: "Post Check-Out"
      };
      const items = rules.map((r) => {
        let config: Record<string, unknown> = {};
        try { config = JSON.parse(r.configJson) as Record<string, unknown>; } catch { /**/ }
        const exec = (config.executions as number) ?? 0;
        const conv = (config.conversions as number) ?? 0;
        return {
          id: r.id,
          name: r.name,
          status: r.isActive ? "Active" : "Paused",
          trigger: campaignTriggers[r.code] ?? r.code,
          recipients: exec,
          conversions: conv,
          conversionRate: exec > 0 ? Math.round((conv / exec) * 1000) / 10 : 0,
          revenueInr: (config.revenueInr as number) ?? 0,
          createdAt: r.createdAt
        };
      });
      const weeklyData = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day, i) => ({
        day,
        executions: 200 + i * 40,
        conversions: 60 + i * 15
      }));
      json(res, 200, { ok: true, items, total: items.length, weeklyData });
      return;
    }

    // ── AI: Provider Status ─────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/providers") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /ai/providers"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      json(res, 200, { ok: true, claude: CLAUDE_AVAILABLE, openai: OPENAI_AVAILABLE });
      return;
    }

    // ── AI: Morning Briefing ────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/morning-briefing") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /ai/morning-briefing"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const { hotelId } = auth.context;
      const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { name: true } });
      const [openReqs, escalatedReqs, guestCount] = await Promise.all([
        prisma.serviceRequest.count({ where: { hotelId, status: "open" } }),
        prisma.serviceRequest.count({ where: { hotelId, status: "escalated" } }),
        prisma.guest.count({ where: { hotelId } })
      ]);
      const topCategories = await prisma.serviceRequest.groupBy({
        by: ["category"],
        where: { hotelId, status: { in: ["open", "escalated"] } },
        _count: { category: true },
        orderBy: { _count: { category: "desc" } },
        take: 3
      });
      const offerAggregate = await prisma.offerEvent.aggregate({
        where: { hotelId },
        _avg: { revenueInr: true }
      });
      const avgSentimentScore = Math.min(100, Math.max(40, Math.round((offerAggregate._avg.revenueInr ?? 0) / 100 + 68)));

      const briefing = await generateMorningBriefing({
        hotelName: hotel?.name ?? hotelId,
        date: new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
        openRequests: openReqs,
        escalatedRequests: escalatedReqs,
        occupancyPct: 72,
        todayRevenue: 284000,
        arrivingGuests: guestCount,
        avgSentimentScore,
        topPendingCategories: topCategories.map((c) => c.category)
      }, provider);

      json(res, 200, { ok: true, provider, briefing });
      return;
    }

    // ── AI: Classify Inbound Event ──────────────────────────────────────────
    if (req.url?.startsWith("/ai/classify-event") && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["POST /ai/classify-event"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const body = (await parseBody(req)) as { text?: unknown; provider?: unknown };
      const text = asTrimmedString(body.text);
      if (!text) { json(res, 400, { ok: false, error: "text is required" }); return; }
      const provider: AIProvider = asTrimmedString(body.provider) === "openai" ? "openai" : "claude";
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const classification = await classifyInboundEvent(auth.context.hotelId, text, provider);
      json(res, 200, { ok: true, provider, classification });
      return;
    }

    // ── AI: Guest Intelligence ──────────────────────────────────────────────
    if (parseGuestIntelligencePath(req.url) && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /ai/guest-intelligence/:guestId"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const guestId = parseGuestIntelligencePath(req.url)!;
      const { hotelId } = auth.context;

      const guest = await prisma.guest.findFirst({
        where: { id: guestId, hotelId },
        select: { id: true, fullName: true, visitCount: true }
      });
      if (!guest) { json(res, 404, { ok: false, error: "Guest not found" }); return; }

      const [guestRequests, guestOffers, openCount] = await Promise.all([
        prisma.serviceRequest.findMany({
          where: { guestId, hotelId },
          select: { category: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20
        }),
        prisma.offerEvent.findMany({
          where: { guestId, hotelId },
          select: { status: true, revenueInr: true },
          take: 30
        }),
        prisma.serviceRequest.count({ where: { guestId, hotelId, status: { in: ["open", "accepted"] } } })
      ]);

      const lastReq = guestRequests[0];
      const catCounts: Record<string, number> = {};
      for (const r of guestRequests) {
        catCounts[r.category] = (catCounts[r.category] ?? 0) + 1;
      }
      const preferredCategories = Object.entries(catCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat]) => cat);
      const totalSpendInr = guestOffers.reduce((sum, o) => sum + (o.revenueInr ?? 0), 0);

      const intelligence = await generateGuestIntelligence({
        guestName: guest.fullName,
        totalStays: guest.visitCount,
        lastStayDate: lastReq ? new Date(lastReq.createdAt).toLocaleDateString("en-IN") : null,
        totalSpendInr,
        preferredCategories,
        openRequests: openCount,
        sentimentScore: null,
        segment: "transient",
        notes: []
      }, provider);

      json(res, 200, { ok: true, provider, guestId, guestName: guest.fullName, intelligence });
      return;
    }

    // ── AI: Revenue Insights ────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/revenue-insights") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /ai/revenue-insights"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const { hotelId } = auth.context;
      const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { name: true } });

      const [totalUsers, offerStats] = await Promise.all([
        prisma.user.count({ where: { hotelId, isActive: true } }),
        prisma.offerEvent.groupBy({
          by: ["offerType"],
          where: { hotelId },
          _count: { offerType: true },
          _sum: { revenueInr: true },
          orderBy: { _sum: { revenueInr: "desc" } },
          take: 5
        })
      ]);

      const accepted = await prisma.offerEvent.count({ where: { hotelId, status: "accepted" } });
      const total = await prisma.offerEvent.count({ where: { hotelId } });

      const insights = await generateRevenueInsights({
        hotelName: hotel?.name ?? hotelId,
        occupancyPct: 72,
        adrInr: 8500,
        revParInr: 6120,
        upsellConversionPct: total > 0 ? Math.round((accepted / total) * 100) : 0,
        topCategories: offerStats.map((o) => ({
          name: o.offerType,
          revenueInr: o._sum.revenueInr ?? 0
        })),
        weekTrend: "up",
        availableRooms: Math.max(0, totalUsers - Math.floor(totalUsers * 0.72))
      }, provider);

      json(res, 200, { ok: true, provider, insights });
      return;
    }

    // ── POST /night-audit/generate ───────────────────────────────────────────
    if (req.url === "/night-audit/generate" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["POST /night-audit/generate"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const body = (await parseBody(req)) as { provider?: unknown };
      const provider: "claude" | "openai" = asTrimmedString(body.provider) === "openai" ? "openai" : "claude";
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured" }); return; }

      const { hotelId } = auth.context;
      const hotel = await prisma.hotel.findUnique({ where: { id: hotelId }, select: { name: true } });
      const today = new Date();
      const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);
      const reportDate = today.toISOString().slice(0, 10);

      const [
        resolvedToday, escalatedCount, openCount,
        checkInsToday, checkOutsToday, inHouseCount,
        autoExecsToday, autoSuccessesToday,
        connEventCount, negEventCount,
        upsellAgg, topCategoryRows
      ] = await Promise.all([
        prisma.serviceRequest.findMany({
          where: { hotelId, status: "resolved", resolvedAt: { gte: todayStart, lte: todayEnd } },
          select: { createdAt: true, resolvedAt: true }
        }),
        prisma.serviceRequest.count({ where: { hotelId, status: "escalated" } }),
        prisma.serviceRequest.count({ where: { hotelId, status: { not: "resolved" } } }),
        prisma.stay.count({ where: { hotelId, checkInAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.stay.count({ where: { hotelId, checkOutAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.stay.count({ where: { hotelId, checkInAt: { lte: today }, checkOutAt: { gte: today } } }),
        prisma.automationExecution.count({ where: { hotelId, executedAt: { gte: todayStart } } }),
        prisma.automationExecution.count({ where: { hotelId, executedAt: { gte: todayStart }, actionResult: "success" } }),
        prisma.connectorEvent.count({ where: { hotelId, createdAt: { gte: todayStart } } }),
        prisma.connectorEvent.count({ where: { hotelId, createdAt: { gte: todayStart }, aiSentiment: "negative" } }),
        prisma.offerEvent.aggregate({ where: { hotelId, status: "accepted", createdAt: { gte: todayStart } }, _sum: { revenueInr: true } }),
        prisma.serviceRequest.groupBy({
          by: ["category"],
          where: { hotelId },
          _count: { category: true },
          orderBy: { _count: { category: "desc" } },
          take: 1
        })
      ]);

      const avgResolutionMins = resolvedToday.length === 0 ? 0 : Math.round(
        resolvedToday.reduce((sum, r) => {
          if (!r.resolvedAt) return sum;
          return sum + (r.resolvedAt.getTime() - r.createdAt.getTime()) / 60000;
        }, 0) / resolvedToday.length
      );

      const auditData: NightAuditData = {
        hotelName: hotel?.name ?? hotelId,
        reportDate,
        occupancyPct: inHouseCount > 0 ? Math.min(100, Math.round((inHouseCount / 45) * 100)) : 72,
        checkIns: checkInsToday,
        checkOuts: checkOutsToday,
        inHouseGuests: inHouseCount,
        resolvedRequests: resolvedToday.length,
        escalatedRequests: escalatedCount,
        openRequests: openCount,
        avgResolutionMins,
        automationExecutions: autoExecsToday,
        automationSuccesses: autoSuccessesToday,
        whatsappMessages: connEventCount,
        upsellRevenue: upsellAgg._sum.revenueInr ?? 0,
        negativeEvents: negEventCount,
        topIssueCategory: topCategoryRows[0]?.category ?? "general"
      };

      const result = await generateNightAuditReport(auditData, provider);
      await prisma.nightAuditReport.upsert({
        where: { hotelId_reportDate: { hotelId, reportDate } },
        create: { hotelId, reportDate, contentJson: JSON.stringify(result), provider },
        update: { contentJson: JSON.stringify(result), provider }
      });

      await prisma.auditLog.create({
        data: {
          hotelId,
          actorRole: auth.context.role,
          action: "night_audit.generated",
          entityType: "night_audit_report",
          metadata: JSON.stringify({ reportDate, provider })
        }
      });

      json(res, 200, { ok: true, reportDate, provider, report: result });
      return;
    }

    // ── GET /night-audit/latest ──────────────────────────────────────────────
    if (req.url?.startsWith("/night-audit/latest") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["GET /night-audit/latest"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const { hotelId } = auth.context;
      const report = await prisma.nightAuditReport.findFirst({
        where: { hotelId },
        orderBy: { generatedAt: "desc" }
      });
      if (!report) { json(res, 404, { ok: false, error: "No night audit report found" }); return; }
      let content: unknown = null;
      try { content = JSON.parse(report.contentJson); } catch { content = null; }
      json(res, 200, { ok: true, reportDate: report.reportDate, provider: report.provider, generatedAt: report.generatedAt, report: content });
      return;
    }

    // ── POST /connectors/pms/simulate ────────────────────────────────────────
    if (req.url === "/connectors/pms/simulate" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!isAllowedRole(auth.context.role, policyMap["POST /connectors/pms/simulate"])) {
        json(res, 403, { ok: false, error: "Role not permitted" }); return;
      }
      const { hotelId } = auth.context;
      const body = (await parseBody(req)) as { guestName?: unknown; roomNumber?: unknown };
      const guestNameInput = asTrimmedString(body.guestName) ?? "Demo Guest";
      const roomNumber = asTrimmedString(body.roomNumber) ?? `${Math.floor(Math.random() * 50) + 101}`;

      const phone = `+9198${Math.floor(Math.random() * 90000000) + 10000000}`;
      const guestId = await upsertGuestByPhone(hotelId, guestNameInput, phone);
      await prisma.guest.update({ where: { id: guestId }, data: { visitCount: { increment: 1 } } });

      const checkInAt = new Date();
      const checkOutAt = new Date(checkInAt.getTime() + 2 * 24 * 60 * 60 * 1000);
      const stay = await prisma.stay.create({
        data: { hotelId, guestId, roomNumber, checkInAt, checkOutAt }
      });

      broadcastSSEEvent({ type: "checkin_event", data: { stayId: stay.id, guestId, guestName: guestNameInput, roomNumber, checkInAt } });

      json(res, 201, { ok: true, stay: { id: stay.id, guestId, guestName: guestNameInput, roomNumber, checkInAt, checkOutAt } });
      return;
    }

    // ── POST /connectors/pms/webhook ─────────────────────────────────────────
    if (req.url === "/connectors/pms/webhook" && req.method === "POST") {
      const rawBody = await parseRawBody(req);
      const body = (rawBody ? JSON.parse(rawBody) : {}) as {
        hotelId?: unknown; event?: unknown;
        guest?: { name?: unknown; phone?: unknown };
        reservation?: { roomNumber?: unknown; checkIn?: unknown; checkOut?: unknown };
      };
      const hotelId = asTrimmedString(body.hotelId);
      const eventType = asTrimmedString(body.event) ?? "guest.checkin";
      if (!hotelId) { json(res, 400, { ok: false, error: "hotelId is required" }); return; }
      const hasAccess = await ensureHotelAccess(hotelId);
      if (!hasAccess) { json(res, 404, { ok: false, error: "Hotel not found" }); return; }

      const guestName = asTrimmedString(body.guest?.name) ?? "PMS Guest";
      const guestPhone = asTrimmedString(body.guest?.phone) ?? `+9199${Math.floor(Math.random() * 90000000) + 10000000}`;
      const roomNumber = asTrimmedString(body.reservation?.roomNumber) ?? "101";
      const checkInAt = body.reservation?.checkIn ? new Date(body.reservation.checkIn as string) : new Date();
      const checkOutAt = body.reservation?.checkOut ? new Date(body.reservation.checkOut as string) : new Date(checkInAt.getTime() + 2 * 24 * 60 * 60 * 1000);

      const guestId = await upsertGuestByPhone(hotelId, guestName, guestPhone);

      if (eventType === "guest.checkin") {
        await prisma.guest.update({ where: { id: guestId }, data: { visitCount: { increment: 1 } } });
        const stay = await prisma.stay.create({ data: { hotelId, guestId, roomNumber, checkInAt, checkOutAt } });
        broadcastSSEEvent({ type: "checkin_event", data: { stayId: stay.id, guestId, guestName, roomNumber, checkInAt } });
        json(res, 201, { ok: true, event: "checkin", stayId: stay.id, guestId });
      } else if (eventType === "guest.checkout") {
        broadcastSSEEvent({ type: "checkout_event", data: { guestId, guestName, roomNumber, checkOutAt } });
        json(res, 200, { ok: true, event: "checkout", guestId });
      } else {
        json(res, 200, { ok: true, event: eventType, guestId });
      }
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (_error) {
    json(res, 500, { ok: false, error: "Internal server error" });
  }
};

export const buildServer = () =>
  createServer((req, res) => {
    void handleRequest(req, res);
  });

export const startServer = (port = Number(process.env.PORT ?? 4000)) => {
  const server = buildServer();
  server.listen(port, () => {
    console.log("Eynis API listening on port " + port);
    startAutomationWorker(60_000);
    console.log("Eynis AutomationEngine started — 60s cycle");
  });
  return server;
};

if (process.env.START_SERVER === "true") {
  const port = Number(process.env.PORT ?? 4000);
  startServer(port);
}
