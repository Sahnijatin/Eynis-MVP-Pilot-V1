// Analytics domain router (#164) — revenue-intelligence, staff-performance,
// sentiment, and upsell-campaigns. Extracted verbatim from server.ts. Returns true
// when it handled the request; false lets the dispatcher continue. All four routes
// share the reporting-window parser, moved here with them (no other consumer).
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { json, parseUrl } from "../../http/helpers";
import { computeSentimentAnalytics } from "./sentiment";
import { computeUpsellAnalytics } from "./upsell";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Parse a from/to reporting window from the query string (E-15). Returns null when
// NEITHER param is present so each endpoint keeps its own default window. Accepts
// YYYY-MM-DD (date-only — `to` is end-of-day, inclusive) or full ISO timestamps. If
// only one bound is given, the other defaults (to=now, from=to−30d). Swaps if from > to.
const parseDateRange = (req: IncomingMessage): { from: Date; to: Date } | null => {
  const sp = parseUrl(req.url).searchParams;
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  if (!fromRaw && !toRaw) return null;
  const parse = (v: string | null, endOfDay: boolean): Date | null => {
    if (!v) return null;
    const iso = DATE_ONLY_RE.test(v) ? `${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : v;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  let to = parse(toRaw, true) ?? new Date();
  let from = parse(fromRaw, false) ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from.getTime() > to.getTime()) { const t = from; from = to; to = t; }
  return { from, to };
};

export async function handleAnalyticsRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (parseUrl(req.url).pathname === "/analytics/revenue-intelligence" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /analytics/revenue-intelligence");
    if (!auth.ok) return true;
    const context = auth.context;
    // Optional reporting window (E-15); null → all-time (prior behaviour).
    const revRange = parseDateRange(req);
    const revCreatedAt = revRange ? { createdAt: { gte: revRange.from, lte: revRange.to } } : {};

    const [offerEvents, openRequests] = await Promise.all([
      prisma.offerEvent.findMany({
        where: { tenantId: context.tenantId, ...revCreatedAt },
        select: { offerType: true, status: true, revenueInr: true }
      }),
      prisma.serviceRequest.count({
        where: { tenantId: context.tenantId, status: { not: "resolved" }, ...revCreatedAt }
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
    return true;
  }

  if (parseUrl(req.url).pathname === "/analytics/staff-performance" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /analytics/staff-performance");
    if (!auth.ok) return true;
    const context = auth.context;
    // Optional reporting window (E-15); null → all-time (prior behaviour).
    const staffRange = parseDateRange(req);
    const staffCreatedAt = staffRange ? { createdAt: { gte: staffRange.from, lte: staffRange.to } } : {};

    const [users, requests, staffSentiment] = await Promise.all([
      prisma.user.findMany({
        where: { tenantId: context.tenantId, isActive: true },
        select: { id: true, fullName: true, role: true }
      }),
      prisma.serviceRequest.findMany({
        where: { tenantId: context.tenantId, ...staffCreatedAt },
        select: { status: true, assignedToUserId: true, createdAt: true, resolvedAt: true }
      }),
      computeSentimentAnalytics(context.tenantId, staffRange ?? undefined)
    ]);
    // Real guest rating derived from sentiment feedback (0..100 net score → 0..5),
    // or null when there's no feedback — never a hardcoded 0 (F-17).
    const avgGuestRating = staffSentiment.totalFeedback > 0
      ? Math.round((staffSentiment.netScore / 20) * 10) / 10
      : null;

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
        avgGuestRating,
        utilizationRate
      },
      leaderboard,
      workloadByRole,
      alerts
    });
    return true;
  }

  // ── GET /analytics/sentiment ─────────────────────────────────────────────
  if (req.url?.startsWith("/analytics/sentiment") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /analytics/sentiment");
    if (!auth.ok) return true;
    const context = auth.context;
    json(res, 200, await computeSentimentAnalytics(context.tenantId, parseDateRange(req) ?? undefined));
    return true;
  }

  // ── GET /analytics/upsell-campaigns ─────────────────────────────────────
  if (req.url?.startsWith("/analytics/upsell-campaigns") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /analytics/upsell-campaigns");
    if (!auth.ok) return true;
    const context = auth.context;
    json(res, 200, await computeUpsellAnalytics(context.tenantId, parseDateRange(req) ?? undefined));
    return true;
  }

  return false;
}
