// Directory domain router (#164) — the read-only people/records listings behind
// Settings and the CRM-lite views: the tenant's users, its audit log, and its
// contacts ("guests") as a list and per-contact profile. Extracted verbatim from
// server.ts; returns true when it handled the request, false to let the dispatcher
// continue. Every route is a tenant-authorized read.
//
// The /guests/:id profile is matched before the broad /guests list, exactly as in
// the original dispatcher (the list's startsWith("/guests") would otherwise shadow
// the profile).
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, ensureTenantAccess } from "../authz";
import { json, parseUrl, asTrimmedString, asSafeLimit, asSafeOffset } from "../../http/helpers";

export async function handleDirectoryRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url?.startsWith("/users") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /users");
    if (!auth.ok) return true;
    const context = auth.context;

    const parsedUrl = parseUrl(req.url);
    const roleFilter = asTrimmedString(parsedUrl.searchParams.get("role"));
    const isActiveFilter = asTrimmedString(parsedUrl.searchParams.get("isActive"));
    const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 50, 200);
    const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));

    const where: { tenantId: string; role?: string; isActive?: boolean } = {
      tenantId: context.tenantId
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
    return true;
  }

  if (req.url === "/audit" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /audit");
    if (!auth.ok) return true;
    const context = auth.context;
    const hasAccess = await ensureTenantAccess(context.tenantId);
    if (!hasAccess) {
      json(res, 403, { ok: false, error: "Hotel not found or access denied" });
      return true;
    }

    const parsedUrl = parseUrl(req.url);
    const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
    const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where: { tenantId: context.tenantId },
        orderBy: { createdAt: "desc" },
        skip: offset,
        take: limit,
        select: {
          id: true,
          tenantId: true,
          actorRole: true,
          action: true,
          entityType: true,
          entityId: true,
          metadata: true,
          createdAt: true
        }
      }),
      prisma.auditLog.count({ where: { tenantId: context.tenantId } })
    ]);

    json(res, 200, {
      ok: true,
      items,
      page: { limit, offset, total, hasMore: offset + items.length < total }
    });
    return true;
  }

  // GET /guests/:id — per-contact profile (stays, requests, connector events, spend).
  const guestIdMatch = /^\/guests\/([^/?]+)/.exec(req.url ?? "");
  if (guestIdMatch && req.method === "GET") {
    const auth = await authorize(req, res, "GET /guests/:id");
    if (!auth.ok) return true;
    const guestId = guestIdMatch[1]!;
    const { tenantId } = auth.context;
    const guest = await prisma.contact.findFirst({
      where: { id: guestId, tenantId },
      include: {
        stays: { orderBy: { checkInAt: "desc" }, take: 5 },
        serviceRequests: {
          orderBy: { createdAt: "desc" },
          take: 10,
          include: { assignedTo: { select: { fullName: true } } }
        }
      }
    });
    if (!guest) { json(res, 404, { ok: false, error: "Guest not found" }); return true; }
    const connectorEvents = await prisma.connectorEvent.findMany({
      where: { tenantId, guestId },
      orderBy: { createdAt: "desc" },
      take: 10,
      select: { id: true, connectorKey: true, aiCategory: true, aiSummary: true, aiSentiment: true, replyStatus: true, createdAt: true }
    });
    const totalSpend = await prisma.offerEvent.aggregate({
      where: { tenantId, guestId, status: "accepted" },
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
    return true;
  }

  // GET /guests — contact list with search + last-stay/status derivation.
  if (req.url?.startsWith("/guests") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /guests");
    if (!auth.ok) return true;
    const context = auth.context;
    const parsedUrl = parseUrl(req.url);
    const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
    const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
    const search = asTrimmedString(parsedUrl.searchParams.get("search"));
    const where = {
      tenantId: context.tenantId,
      ...(search ? { OR: [
        { fullName: { contains: search, mode: "insensitive" as const } },
        { phoneE164: { contains: search, mode: "insensitive" as const } }
      ] } : {})
    };
    const [guests, total] = await Promise.all([
      prisma.contact.findMany({
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
      prisma.contact.count({ where })
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
    return true;
  }

  return false;
}
