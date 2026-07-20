// Dashboard domain router (#164) — the read-only operational-overview aggregations
// behind the home dashboard: the KPI overview, the open-queue summary, the
// created-vs-resolved trend series, and the live feed. Extracted verbatim from
// server.ts; returns true when it handled the request, false to let the dispatcher
// continue. All four are tenant-authorized reads over ServiceRequest.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { json, parseUrl, asSafeLimit } from "../../http/helpers";

export async function handleDashboardRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url === "/dashboard/overview" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /dashboard/overview");
    if (!auth.ok) return true;
    const context = auth.context;
    const [openCount, resolvedTodayCount, escalatedOpenCount, slaBreachedOpenCount] =
      await Promise.all([
        prisma.serviceRequest.count({
          where: { tenantId: context.tenantId, status: { not: "resolved" } }
        }),
        prisma.serviceRequest.count({
          where: {
            tenantId: context.tenantId,
            status: "resolved",
            resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
          }
        }),
        prisma.serviceRequest.count({
          where: { tenantId: context.tenantId, status: "escalated" }
        }),
        prisma.serviceRequest.count({
          where: {
            tenantId: context.tenantId,
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
    return true;
  }

  if (req.url === "/dashboard/queue-summary" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /dashboard/queue-summary");
    if (!auth.ok) return true;
    const context = auth.context;

    const rows = await prisma.serviceRequest.findMany({
      where: { tenantId: context.tenantId, status: { not: "resolved" } },
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
    return true;
  }

  if (req.url?.startsWith("/dashboard/trends") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /dashboard/overview");
    if (!auth.ok) return true;
    const context = auth.context;

    const parsedUrl = parseUrl(req.url);
    const days = asSafeLimit(parsedUrl.searchParams.get("days"), 7, 30);
    const now = new Date();
    const windowStart = new Date(now);
    windowStart.setHours(0, 0, 0, 0);
    windowStart.setDate(windowStart.getDate() - (days - 1));

    const [createdRows, resolvedRows] = await Promise.all([
      prisma.serviceRequest.findMany({
        where: { tenantId: context.tenantId, createdAt: { gte: windowStart } },
        select: { createdAt: true }
      }),
      prisma.serviceRequest.findMany({
        where: {
          tenantId: context.tenantId,
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
    return true;
  }

  if (req.url?.startsWith("/dashboard/live-feed") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /dashboard/live-feed");
    if (!auth.ok) return true;
    const context = auth.context;
    const items = await prisma.serviceRequest.findMany({
      where: { tenantId: context.tenantId, status: { not: "resolved" } },
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
    return true;
  }

  return false;
}
