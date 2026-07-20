// Service-requests domain router (#164) — the operational core spine: create,
// list, CSV export, SLA-breach refresh, status transition (with attribution + SSE),
// assignment, and transition history. Extracted verbatim from server.ts; returns
// true when it handled the request, false to let the dispatcher continue.
//
// Every /service-requests* path is handled here and nowhere else, so consolidating
// these behind one dispatch call is behaviour-preserving. Within the router the
// specific sub-resource routes (/export, /:id/status, /:id/assign, /:id/transitions)
// are matched before the broad collection list, exactly as before (F-7).
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess, ensureTenantAccess } from "../authz";
import {
  json, parseBody, parseUrl, sendDoc,
  asTrimmedString, asPositiveInt, asSafeLimit, asSafeOffset,
} from "../../http/helpers";
import { broadcastSSEEvent } from "../../sse/clients";
import { recordServiceRequestResolution } from "../attribution/recorder";
import { loadReportBrand } from "../export/brand";
import { brandedCsv } from "../export/csv";

const parseServiceRequestStatusPath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/service-requests\/([^/]+)\/status$/.exec(url);
  return match && match[1] ? match[1] : null;
};

const parseServiceRequestAssignPath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/service-requests\/([^/]+)\/assign$/.exec(url);
  return match && match[1] ? match[1] : null;
};

export async function handleServiceRequestRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // GET /service-requests/export?format=csv — tabular CSV of this tenant's SRs.
  if (parseUrl(req.url).pathname === "/service-requests/export" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /service-requests/export");
    if (!auth.ok) return true;
    const { tenantId } = auth.context;
    const params = parseUrl(req.url).searchParams;
    const statusFilter = asTrimmedString(params.get("status"));
    const items = await prisma.serviceRequest.findMany({
      where: { tenantId, ...(statusFilter ? { status: statusFilter } : {}) },
      orderBy: { createdAt: "desc" },
      take: 5000,
      select: {
        id: true, category: true, status: true, priority: true, source: true,
        summary: true, slaDueAt: true, slaBreachedAt: true, createdAt: true,
        guest: { select: { fullName: true } }
      }
    });
    const brand = await loadReportBrand(tenantId);
    const rows: Array<Array<unknown>> = items.map((s) => [
      s.id, s.guest?.fullName ?? "", s.category, s.status, s.priority ?? "", s.source,
      s.summary ?? "", s.slaDueAt?.toISOString() ?? "", s.slaBreachedAt ? "yes" : "no",
      s.createdAt.toISOString()
    ]);
    const header = ["ID", "Contact", "Category", "Status", "Priority", "Source", "Summary", "SLA due", "SLA breached", "Created"];
    const csv = brandedCsv(brand, "Service Requests", { header, rows });
    sendDoc(res, "text/csv; charset=utf-8", csv, `service-requests-${new Date().toISOString().slice(0, 10)}.csv`);
    return true;
  }

  if (req.url === "/service-requests" && req.method === "POST") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const context = auth.context;
    const hasAccess = await ensureTenantAccess(context.tenantId);
    if (!hasAccess) {
      json(res, 403, { ok: false, error: "Hotel not found or access denied" });
      return true;
    }
    if (!canAccess(context.permissions, "POST /service-requests")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" });
      return true;
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
      return true;
    }

    if (guestIdInput) {
      const guest = await prisma.contact.findFirst({
        where: { id: guestIdInput, tenantId: context.tenantId },
        select: { id: true }
      });
      if (!guest) {
        json(res, 404, { ok: false, error: "Guest not found for this hotel" });
        return true;
      }
      guestId = guest.id;
    } else if (guestNameInput && guestPhoneInput) {
      const guest = await prisma.contact.create({
        data: {
          tenantId: context.tenantId,
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
      return true;
    }

    const serviceRequest = await prisma.serviceRequest.create({
      data: {
        tenantId: context.tenantId,
        guestId,
        category: categoryInput,
        status: "open",
        source: sourceInput,
        summary: summaryInput,
        // Front-line operators self-assign requests they log. Key off the
        // canonical roleKey ("manager" ≡ legacy "front_desk"), falling back to
        // the deprecated legacy role only for older tokens (F-35).
        assignedToUserId: (context.roleKey === "manager" || context.role === "front_desk") ? context.userId : null,
        priority: priorityInput,
        slaDueAt
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

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
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
    return true;
  }

  // Match only the collection (with or without query string), NOT sub-resources
  // like /service-requests/:id/transitions — otherwise this broad list handler
  // shadows the specific routes declared below it (F-7).
  if ((req.url === "/service-requests" || req.url?.startsWith("/service-requests?")) && req.method === "GET") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const context = auth.context;
    const hasAccess = await ensureTenantAccess(context.tenantId);
    if (!hasAccess) {
      json(res, 403, { ok: false, error: "Hotel not found or access denied" });
      return true;
    }

    if (!canAccess(context.permissions, "GET /service-requests")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" });
      return true;
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
      tenantId: string;
      status?: string;
      assignedToUserId?: string;
      slaDueAt?: { not: null; gte?: Date; lt?: Date };
    } = { tenantId: context.tenantId };
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
      }),
      prisma.serviceRequest.count({ where })
    ]);

    json(res, 200, {
      ok: true,
      items,
      page: { limit, offset, total, hasMore: offset + items.length < total }
    });
    return true;
  }

  if (req.url === "/service-requests/sla/refresh" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /service-requests/sla/refresh");
    if (!auth.ok) return true;
    const context = auth.context;

    const now = new Date();
    const result = await prisma.serviceRequest.updateMany({
      where: {
        tenantId: context.tenantId,
        status: { not: "resolved" },
        slaDueAt: { not: null, lt: now },
        slaBreachedAt: null
      },
      data: {
        slaBreachedAt: now
      }
    });

    json(res, 200, { ok: true, breachedMarked: result.count });
    return true;
  }

  const requestId = parseServiceRequestStatusPath(req.url);
  if (requestId && req.method === "PATCH") {
    const auth = await authorize(req, res, "PATCH /service-requests/:id/status");
    if (!auth.ok) return true;
    const context = auth.context;

    const body = (await parseBody(req)) as { status?: unknown };
    const nextStatus = asTrimmedString(body.status);
    if (!nextStatus || !["accepted", "resolved", "escalated"].includes(nextStatus)) {
      json(res, 400, {
        ok: false,
        error: "status must be one of: accepted, resolved, escalated"
      });
      return true;
    }

    const existing = await prisma.serviceRequest.findFirst({
      where: { id: requestId, tenantId: context.tenantId },
      select: { id: true, status: true }
    });
    if (!existing) {
      json(res, 404, { ok: false, error: "Service request not found" });
      return true;
    }
    if (existing.status === "resolved") {
      json(res, 409, { ok: false, error: "Resolved request cannot transition" });
      return true;
    }

    const updated = await prisma.serviceRequest.update({
      where: { id: requestId },
      data: {
        status: nextStatus,
        resolvedAt: nextStatus === "resolved" ? new Date() : null
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
        createdAt: true,
        resolvedAt: true
      }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
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
        tenantId: context.tenantId,
        serviceRequestId: updated.id,
        fromStatus: existing.status,
        toStatus: nextStatus,
        changedByUserId: context.userId
      }
    });

    // Attribution (#167): a resolved request is an attributed outcome. Best-effort
    // — a recording hiccup must never fail the status change. Idempotent by source.
    if (nextStatus === "resolved") {
      const tRow = await prisma.tenant.findUnique({ where: { id: context.tenantId }, select: { industry: true } });
      await recordServiceRequestResolution({
        tenantId: context.tenantId,
        industry: tRow?.industry ?? null,
        serviceRequestId: updated.id,
        category: updated.category,
        occurredAt: updated.resolvedAt ?? undefined,
      }).catch((e) => console.warn("[attribution] record resolution failed:", e instanceof Error ? e.message : e));
    }

    broadcastSSEEvent(context.tenantId, { type: "sr_updated", data: { id: updated.id, status: nextStatus } });
    json(res, 200, { ok: true, item: updated });
    return true;
  }

  const assignRequestId = parseServiceRequestAssignPath(req.url);
  if (assignRequestId && req.method === "PATCH") {
    const auth = await authorize(req, res, "PATCH /service-requests/:id/assign");
    if (!auth.ok) return true;
    const context = auth.context;

    const body = (await parseBody(req)) as { assigneeEmail?: unknown };
    const assigneeEmail = asTrimmedString(body.assigneeEmail)?.toLowerCase();
    if (!assigneeEmail) {
      json(res, 400, { ok: false, error: "assigneeEmail is required" });
      return true;
    }

    const assignee = await prisma.user.findFirst({
      where: { tenantId: context.tenantId, email: assigneeEmail, isActive: true },
      select: { id: true, email: true }
    });
    if (!assignee) {
      json(res, 404, { ok: false, error: "Assignee not found in this hotel" });
      return true;
    }

    const existing = await prisma.serviceRequest.findFirst({
      where: { id: assignRequestId, tenantId: context.tenantId },
      select: { id: true, assignedToUserId: true }
    });
    if (!existing) {
      json(res, 404, { ok: false, error: "Service request not found" });
      return true;
    }

    const updated = await prisma.serviceRequest.update({
      where: { id: assignRequestId },
      data: { assignedToUserId: assignee.id },
      select: { id: true, assignedToUserId: true }
    });

    await prisma.auditLog.create({
      data: {
        tenantId: context.tenantId,
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
    return true;
  }

  if (req.url?.startsWith("/service-requests/") && req.url.endsWith("/transitions") && req.method === "GET") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const context = auth.context;
    // Viewing a request's transition history requires the same permission as
    // viewing requests (F-7: this check was missing while the route was dead).
    if (!canAccess(context.permissions, "GET /service-requests")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" });
      return true;
    }
    const transitionRequestId = /^\/service-requests\/([^/]+)\/transitions$/.exec(req.url)?.[1];
    if (!transitionRequestId) {
      json(res, 400, { ok: false, error: "Invalid path" });
      return true;
    }

    const exists = await prisma.serviceRequest.findFirst({
      where: { id: transitionRequestId, tenantId: context.tenantId },
      select: { id: true }
    });
    if (!exists) {
      json(res, 404, { ok: false, error: "Service request not found" });
      return true;
    }

    const parsedUrl = parseUrl(req.url);
    const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
    const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
    const [items, total] = await Promise.all([
      prisma.serviceRequestTransition.findMany({
        where: { tenantId: context.tenantId, serviceRequestId: transitionRequestId },
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
        where: { tenantId: context.tenantId, serviceRequestId: transitionRequestId }
      })
    ]);

    json(res, 200, {
      ok: true,
      items,
      page: { limit, offset, total, hasMore: offset + items.length < total }
    });
    return true;
  }

  return false;
}
