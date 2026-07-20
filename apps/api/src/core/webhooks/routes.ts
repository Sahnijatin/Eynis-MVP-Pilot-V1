// Public webhooks + intake router (#164) — the inbound endpoints external systems
// (or public forms) POST to: the Vapi end-of-call webhook, the SR-created event
// hook, the public request-intake form, the Resend email-events webhook, and the
// PMS check-in simulate/webhook. Extracted verbatim from server.ts; returns true
// when it handled the request, false to let the dispatcher continue.
//
// Most routes are PUBLIC and self-protecting: Vapi/Resend/PMS verify a provider
// secret/signature, /public/requests is per-IP rate-limited. /events/... and
// /connectors/pms/simulate are tenant-authorized.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, ensureTenantAccess } from "../authz";
import { json, parseBody, parseRawBody, parseUrl, asTrimmedString, clientIp } from "../../http/helpers";
import { selectPmsAdapter } from "../connectors/pms/adapters";
import { ingestPmsEvent } from "../connectors/pms/ingest";
import { rateLimit } from "../rate-limit";
import { upsertContactByPhone } from "../crm/upsert-contact";
import { broadcastSSEEvent } from "../../sse/clients";
import { verifySharedWebhookSecret } from "../connectors/webhook-verify";
import { processResendEvent, verifyResendSignature } from "../email/resend-webhook";
import { eventBus } from "../../events/bus";

const normalizePhone = (value: string) => value.replace(/\s+/g, "");

const createServiceRequestForHotel = async (input: {
  tenantId: string;
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
      tenantId: input.tenantId,
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
      tenantId: true,
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

export async function handlePublicWebhookRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url === "/webhooks/vapi" && req.method === "POST") {
    const rawBody = await parseRawBody(req);
    let payload: unknown = {};
    try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { json(res, 400, { ok: false, error: "Invalid JSON" }); return true; }

    const { verifyWebhook, resolveVapiCredentials } = await import("../campaigns/vapi");
    const { normalizeVapiMessage, processVapiWebhook } = await import("../campaigns/webhook");

    // Resolve the expected secret per-tenant: assistants are provisioned with the
    // tenant's webhookSecret (ConnectorConfig, falling back to env), so verifying
    // only against the global env var rejects tenants with their own secret (F-16).
    // Mapping the call→tenant uses the unverified callId purely to pick which
    // secret to check against — the caller must still present that secret.
    let expectedSecret = asTrimmedString(process.env.VAPI_WEBHOOK_SECRET);
    const evt = normalizeVapiMessage(payload);
    if (evt.kind !== "ignore") {
      const call = await prisma.callRecord.findUnique({ where: { vapiCallId: evt.callId }, select: { tenantId: true } });
      if (call) {
        const creds = await resolveVapiCredentials(call.tenantId);
        if (creds.webhookSecret) expectedSecret = creds.webhookSecret;
      }
    }

    const verdict = verifyWebhook({
      provided: (req.headers["x-vapi-secret"] as string) ?? null,
      expected: expectedSecret,
      enforce: String(process.env.VERIFY_WEBHOOKS ?? "").toLowerCase() === "true",
    });
    if (!verdict.ok) { json(res, 401, { ok: false, error: verdict.reason ?? "Invalid webhook secret" }); return true; }

    const result = await processVapiWebhook(payload);
    json(res, 200, { ok: true, ...result });
    return true;
  }

  if (req.url === "/events/service-request-created" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /events/service-request-created");
    if (!auth.ok) return true;
    const context = auth.context;

    const hasAccess = await ensureTenantAccess(context.tenantId);
    if (!hasAccess) {
      json(res, 403, { ok: false, error: "Hotel not found or access denied" });
      return true;
    }

    eventBus.publish({
      type: "service_request.created",
      tenantId: context.tenantId,
      payload: { source: "api" },
      createdAt: new Date().toISOString()
    });

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
        actorRole: context.role,
        action: "service_request.created",
        entityType: "service_request",
        metadata: JSON.stringify({ source: "api" })
      }
    });

    json(res, 202, { ok: true });
    return true;
  }

  if (req.url === "/public/requests" && req.method === "POST") {
    // Throttle per client IP — this is an unauthenticated write (creates a Contact +
    // ServiceRequest). Without a cap it can be scripted to flood a tenant's queue and
    // create unbounded Contact rows (F-…). A public intake form is low-frequency.
    const pip = clientIp(req);
    if (!(await rateLimit(`public-req:${pip}`, 10, 60_000))) {
      json(res, 429, { ok: false, error: "Too many requests. Please try again shortly." });
      return true;
    }
    const body = (await parseBody(req)) as {
      tenantId?: unknown;
      hotelId?: unknown;
      guestName?: unknown;
      guestPhone?: unknown;
      category?: unknown;
      summary?: unknown;
      source?: unknown;
    };
    const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId); // accept legacy hotelId from existing public links
    const guestName = asTrimmedString(body.guestName);
    const guestPhoneRaw = asTrimmedString(body.guestPhone);
    const category = asTrimmedString(body.category) ?? "general";
    const summary = asTrimmedString(body.summary);
    const source = asTrimmedString(body.source) ?? "qr";
    const guestPhone = guestPhoneRaw ? normalizePhone(guestPhoneRaw) : null;

    if (!tenantId || !guestName || !guestPhone || !summary) {
      json(res, 400, {
        ok: false,
        error: "tenantId, guestName, guestPhone and summary are required"
      });
      return true;
    }

    const hasAccess = await ensureTenantAccess(tenantId);
    if (!hasAccess) {
      json(res, 404, { ok: false, error: "Hotel not found" });
      return true;
    }

    const guestId = await upsertContactByPhone(tenantId, guestName, guestPhone);
    const serviceRequest = await createServiceRequestForHotel({
      tenantId,
      guestId,
      category,
      summary,
      source,
      priority: "normal"
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorRole: "guest",
        action: "service_request.created.public",
        entityType: "service_request",
        entityId: serviceRequest.id,
        metadata: JSON.stringify({ source, guestPhone })
      }
    });

    json(res, 201, { ok: true, item: serviceRequest });
    return true;
  }

  // ── POST /webhooks/resend — public: email delivery/bounce/complaint events ──
  // Feeds the per-tenant EmailSuppression list. Verified via the Svix signature
  // when RESEND_WEBHOOK_SECRET is set (accept-all in dev, mirroring VERIFY_WEBHOOKS).
  if (req.url === "/webhooks/resend" && req.method === "POST") {
    const rawBody = await parseRawBody(req);
    const secret = asTrimmedString(process.env.RESEND_WEBHOOK_SECRET);
    if (!secret) {
      // Fail closed in production: without the secret, forged bounce/complaint
      // events could suppress arbitrary recipients (F-10). Accept-all only in dev.
      if (process.env.NODE_ENV === "production") { json(res, 503, { ok: false, error: "Webhook secret not configured" }); return true; }
    } else {
      const hdr = (k: string) => (typeof req.headers[k] === "string" ? (req.headers[k] as string) : null);
      const tsHeader = hdr("svix-timestamp");
      // Replay protection: reject stale or missing timestamps (Svix sends unix
      // seconds) so a captured signed payload can't be replayed forever (F-10).
      const tsSec = tsHeader ? Number(tsHeader) : NaN;
      if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) {
        json(res, 401, { ok: false, error: "Stale or missing webhook timestamp" }); return true;
      }
      const valid = verifyResendSignature(secret, {
        id: hdr("svix-id"), timestamp: tsHeader, signature: hdr("svix-signature"),
      }, rawBody ?? "");
      if (!valid) { json(res, 401, { ok: false, error: "Invalid webhook signature" }); return true; }
    }
    let event: unknown;
    try { event = rawBody ? JSON.parse(rawBody) : {}; } catch { json(res, 400, { ok: false, error: "Invalid JSON" }); return true; }
    const result = await processResendEvent(event as Parameters<typeof processResendEvent>[0]);
    json(res, 200, { ok: true, action: result.action });
    return true;
  }

  // ── POST /connectors/pms/simulate ────────────────────────────────────────
  if (req.url === "/connectors/pms/simulate" && req.method === "POST") {
    // Demo-only: fabricates a check-in with real DB writes. Disabled in
    // production unless explicitly opted in, so it can't be used to seed
    // bogus stays/contacts on a live tenant (F-2).
    if (process.env.NODE_ENV === "production" && process.env.ENABLE_PMS_SIMULATE !== "true") {
      json(res, 404, { ok: false, error: "Not found" }); return true;
    }
    const auth = await authorize(req, res, "POST /connectors/pms/simulate");
    if (!auth.ok) return true;
    const { tenantId } = auth.context;
    const body = (await parseBody(req)) as { guestName?: unknown; roomNumber?: unknown };
    const guestNameInput = asTrimmedString(body.guestName) ?? "Demo Guest";
    const roomNumber = asTrimmedString(body.roomNumber) ?? `${Math.floor(Math.random() * 50) + 101}`;

    const phone = `+9198${Math.floor(Math.random() * 90000000) + 10000000}`;
    const guestId = await upsertContactByPhone(tenantId, guestNameInput, phone);
    await prisma.contact.update({ where: { id: guestId }, data: { visitCount: { increment: 1 } } });

    const checkInAt = new Date();
    const checkOutAt = new Date(checkInAt.getTime() + 2 * 24 * 60 * 60 * 1000);
    const stay = await prisma.stay.create({
      data: { tenantId, guestId, roomNumber, checkInAt, checkOutAt }
    });

    broadcastSSEEvent(tenantId, { type: "checkin_event", data: { stayId: stay.id, guestId, guestName: guestNameInput, roomNumber, checkInAt } });

    json(res, 201, { ok: true, stay: { id: stay.id, guestId, guestName: guestNameInput, roomNumber, checkInAt, checkOutAt } });
    return true;
  }

  // ── POST /connectors/pms/webhook ─────────────────────────────────────────
  if (parseUrl(req.url).pathname === "/connectors/pms/webhook" && req.method === "POST") {
    // This endpoint writes data (contacts, stays, visit counts) for the tenantId
    // in the body, so it MUST be authenticated. Without the shared-secret gate
    // anyone who knows a tenantId could inject check-in/checkout events (F-2).
    const providedSecret = req.headers["x-webhook-secret"];
    const secretCheck = verifySharedWebhookSecret({
      expected: process.env.PMS_WEBHOOK_SECRET,
      provided: typeof providedSecret === "string" ? providedSecret : Array.isArray(providedSecret) ? providedSecret[0] : null,
      isProduction: process.env.NODE_ENV === "production"
    });
    if (!secretCheck.ok) { json(res, secretCheck.status, { ok: false, error: secretCheck.reason ?? "Unauthorized" }); return true; }

    const rawBody = await parseRawBody(req);
    let body: Record<string, unknown>;
    try { body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>; }
    catch { json(res, 400, { ok: false, error: "Invalid JSON" }); return true; }

    // Provider selection (#169): `?provider=ezee|hotelogix` (or the connector key
    // `pms_*`, or a `provider` field in the body) picks the adapter; absent →
    // the generic shape, so existing integrations keep working.
    const qp = parseUrl(req.url).searchParams;
    const provider = asTrimmedString(qp.get("provider"))
      ?? (typeof req.headers["x-pms-provider"] === "string" ? req.headers["x-pms-provider"] : null)
      ?? asTrimmedString(body.provider) ?? asTrimmedString(body.connectorKey);
    const adapter = selectPmsAdapter(provider);

    // Tenant resolution: our tenantId comes from the request (body `tenantId`/
    // legacy `hotelId`, or `?tenantId=` on the webhook URL) — real PMS payloads
    // carry the vendor's own property id, not ours, so the tenant is identified by
    // the URL the provider is configured to POST to.
    const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId) ?? asTrimmedString(qp.get("tenantId"));
    if (!tenantId) { json(res, 400, { ok: false, error: "tenantId is required" }); return true; }
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Hotel not found" }); return true; }

    const canonical = adapter.normalize(body);
    if (!canonical) { json(res, 400, { ok: false, error: "Unrecognised PMS payload" }); return true; }

    const result = await ingestPmsEvent(tenantId, canonical);
    if (result.event === "checkin") {
      json(res, 201, { ok: true, event: "checkin", stayId: result.stayId, guestId: result.guestId, provider: adapter.provider });
    } else if (result.event === "checkout") {
      json(res, 200, { ok: true, event: "checkout", guestId: result.guestId, provider: adapter.provider });
    } else {
      json(res, 200, { ok: true, event: canonical.sourceEvent ?? "ignored", guestId: result.guestId, provider: adapter.provider });
    }
    return true;
  }

  return false;
}
