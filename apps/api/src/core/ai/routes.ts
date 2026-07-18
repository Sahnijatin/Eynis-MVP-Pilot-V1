// AI + Night Audit domain router (#164) — extracted verbatim from server.ts so the
// dispatcher stays small. Returns true when it handled the request (response
// written); false lets the main dispatcher continue. Authorization goes through the
// shared authorize()/permissionMap contract, unchanged.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { json, parseBody, asTrimmedString, parseUrl, asSafeLimit } from "../../http/helpers";
import { enforceLicenseFeature } from "../license";
import { computeSentimentAnalytics } from "../analytics/sentiment";
import { parseAIProvider } from "./provider-param";
import {
  AiResponseError,
  AI_AVAILABLE,
  CLAUDE_AVAILABLE,
  OPENAI_AVAILABLE,
  type AIProvider,
  type NightAuditData,
  classifyInboundEvent,
  generateSmartInsights,
  generateGuestIntelligence,
  generateRevenueInsights,
  generateNightAuditReport,
} from "./intelligence";

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

// Uniform AI failure response: log the cause, return a safe 502 (never leak an
// upstream stack). AiResponseError carries a safe message worth surfacing.
const aiError = (res: ServerResponse, label: string, e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[AI] ${label} failed:`, message);
  json(res, 502, { ok: false, error: e instanceof AiResponseError ? `AI response error: ${message}` : "AI provider request failed" });
};

// /ai/guest-intelligence/:guestId → guestId (or null when the path doesn't match).
const parseGuestIntelligencePath = (url: string | undefined): string | null => {
  const m = /^\/ai\/guest-intelligence\/([^/?]+)/.exec(parseUrl(url).pathname);
  return m?.[1] ? decodeURIComponent(m[1]) : null;
};

export async function handleAIRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // ── AI: Provider Status ─────────────────────────────────────────────────
  if (req.url?.startsWith("/ai/providers") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /ai/providers");
    if (!auth.ok) return true;
    json(res, 200, { ok: true, claude: CLAUDE_AVAILABLE, openai: OPENAI_AVAILABLE });
    return true;
  }

  // ── AI: Smart Insights ──────────────────────────────────────────────────
  if (req.url?.startsWith("/ai/smart-insights") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /ai/smart-insights");
    if (!auth.ok) return true;
    const licInsights = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
    if (!licInsights.ok) { json(res, 403, { ok: false, error: licInsights.error }); return true; }
    const provider = parseAIProvider(req.url);
    if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return true; }
    if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return true; }
    if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return true; }

    const { tenantId } = auth.context;
    const todayStartInsights = new Date(); todayStartInsights.setHours(0, 0, 0, 0);
    const todayEndInsights = new Date(); todayEndInsights.setHours(23, 59, 59, 999);
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, industry: true } });
    const [openReqs, escalatedReqs, newContactsToday, sentiment] = await Promise.all([
      prisma.serviceRequest.count({ where: { tenantId, status: "open" } }),
      prisma.serviceRequest.count({ where: { tenantId, status: "escalated" } }),
      // Industry-agnostic "incoming" metric: contacts created today (every
      // industry has contacts; stays/check-ins are hospitality-only).
      prisma.contact.count({ where: { tenantId, createdAt: { gte: todayStartInsights, lte: todayEndInsights } } }),
      computeSentimentAnalytics(tenantId)
    ]);
    const topCategories = await prisma.serviceRequest.groupBy({
      by: ["category"],
      where: { tenantId, status: { in: ["open", "escalated"] } },
      _count: { category: true },
      orderBy: { _count: { category: "desc" } },
      take: 3
    });
    // Real sentiment from voice + inbound feedback; null when there is none, so
    // the prompt says "no feedback yet" rather than inventing a score (F-17).
    const avgSentimentScore = sentiment.totalFeedback > 0 ? sentiment.netScore : null;

    try {
      const insights = await generateSmartInsights({
        tenantName: tenant?.name ?? tenantId,
        industry: tenant?.industry ?? null,
        date: new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
        openRequests: openReqs,
        escalatedRequests: escalatedReqs,
        // Revenue requires an external billing/POS source we don't have yet — pass
        // null (rendered "not available") instead of fabricated constants (F-17).
        todayRevenue: null,
        newContacts: newContactsToday,
        avgSentimentScore,
        topPendingCategories: topCategories.map((c) => c.category)
      }, provider);
      json(res, 200, { ok: true, provider, insights, generatedAt: new Date().toISOString() });
    } catch (e) {
      aiError(res, "smart-insights", e);
    }
    return true;
  }

  // ── AI: Classify Inbound Event ──────────────────────────────────────────
  if (req.url?.startsWith("/ai/classify-event") && req.method === "POST") {
    const auth = await authorize(req, res, "POST /ai/classify-event");
    if (!auth.ok) return true;
    const body = (await parseBody(req)) as { text?: unknown; provider?: unknown };
    const text = asTrimmedString(body.text);
    if (!text) { json(res, 400, { ok: false, error: "text is required" }); return true; }
    const provider: AIProvider = asTrimmedString(body.provider) === "openai" ? "openai" : "claude";
    if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return true; }
    if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return true; }
    if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return true; }

    try {
      const classification = await classifyInboundEvent(auth.context.tenantId, text, provider);
      json(res, 200, { ok: true, provider, classification });
    } catch (e) {
      aiError(res, "classify-event", e);
    }
    return true;
  }

  // ── AI: Guest Intelligence ──────────────────────────────────────────────
  if (parseGuestIntelligencePath(req.url) && req.method === "GET") {
    const auth = await authorize(req, res, "GET /ai/guest-intelligence/:guestId");
    if (!auth.ok) return true;
    const licGuest = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
    if (!licGuest.ok) { json(res, 403, { ok: false, error: licGuest.error }); return true; }
    const provider = parseAIProvider(req.url);
    if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return true; }
    if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return true; }
    if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return true; }

    const guestId = parseGuestIntelligencePath(req.url)!;
    const { tenantId } = auth.context;

    const guest = await prisma.contact.findFirst({
      where: { id: guestId, tenantId },
      select: { id: true, fullName: true, visitCount: true }
    });
    if (!guest) { json(res, 404, { ok: false, error: "Guest not found" }); return true; }

    const [guestRequests, guestOffers, openCount] = await Promise.all([
      prisma.serviceRequest.findMany({
        where: { guestId, tenantId },
        select: { category: true, createdAt: true },
        orderBy: { createdAt: "desc" },
        take: 20
      }),
      prisma.offerEvent.findMany({
        where: { guestId, tenantId },
        select: { status: true, revenueInr: true },
        take: 30
      }),
      prisma.serviceRequest.count({ where: { guestId, tenantId, status: { in: ["open", "accepted"] } } })
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

    try {
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
    } catch (e) {
      aiError(res, "guest-intelligence", e);
    }
    return true;
  }

  // ── AI: Revenue Insights ────────────────────────────────────────────────
  if (req.url?.startsWith("/ai/revenue-insights") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /ai/revenue-insights");
    if (!auth.ok) return true;
    const licRevInsights = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
    if (!licRevInsights.ok) { json(res, 403, { ok: false, error: licRevInsights.error }); return true; }
    const provider = parseAIProvider(req.url);
    if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return true; }
    if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return true; }
    if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return true; }

    const { tenantId } = auth.context;
    const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

    const offerStats = await prisma.offerEvent.groupBy({
      by: ["offerType"],
      where: { tenantId },
      _count: { offerType: true },
      _sum: { revenueInr: true },
      orderBy: { _sum: { revenueInr: "desc" } },
      take: 5
    });

    const accepted = await prisma.offerEvent.count({ where: { tenantId, status: "accepted" } });
    const total = await prisma.offerEvent.count({ where: { tenantId } });

    try {
      const insights = await generateRevenueInsights({
        hotelName: hotel?.name ?? tenantId,
        // Occupancy / ADR / RevPAR / room availability need a PMS source we don't
        // have — pass null (rendered "not available") rather than fabricated
        // constants. The model bases recommendations on the real upsell data (F-17).
        occupancyPct: null,
        adrInr: null,
        revParInr: null,
        upsellConversionPct: total > 0 ? Math.round((accepted / total) * 100) : 0,
        topCategories: offerStats.map((o) => ({
          name: o.offerType,
          revenueInr: o._sum.revenueInr ?? 0
        })),
        weekTrend: "up",
        availableRooms: null
      }, provider);
      json(res, 200, { ok: true, provider, insights });
    } catch (e) {
      aiError(res, "revenue-insights", e);
    }
    return true;
  }

  // ── POST /night-audit/generate ───────────────────────────────────────────
  if (req.url === "/night-audit/generate" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /night-audit/generate");
    if (!auth.ok) return true;
    const licNightGen = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
    if (!licNightGen.ok) { json(res, 403, { ok: false, error: licNightGen.error }); return true; }
    if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return true; }

    const body = (await parseBody(req)) as { provider?: unknown };
    const provider: "claude" | "openai" = asTrimmedString(body.provider) === "openai" ? "openai" : "claude";
    if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured" }); return true; }
    if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured" }); return true; }

    const { tenantId } = auth.context;
    const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
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
        where: { tenantId, status: "resolved", resolvedAt: { gte: todayStart, lte: todayEnd } },
        select: { createdAt: true, resolvedAt: true }
      }),
      prisma.serviceRequest.count({ where: { tenantId, status: "escalated" } }),
      prisma.serviceRequest.count({ where: { tenantId, status: { not: "resolved" } } }),
      prisma.stay.count({ where: { tenantId, checkInAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.stay.count({ where: { tenantId, checkOutAt: { gte: todayStart, lte: todayEnd } } }),
      prisma.stay.count({ where: { tenantId, checkInAt: { lte: today }, checkOutAt: { gte: today } } }),
      prisma.automationExecution.count({ where: { tenantId, executedAt: { gte: todayStart } } }),
      prisma.automationExecution.count({ where: { tenantId, executedAt: { gte: todayStart }, actionResult: "success" } }),
      prisma.connectorEvent.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
      prisma.connectorEvent.count({ where: { tenantId, createdAt: { gte: todayStart }, aiSentiment: "negative" } }),
      prisma.offerEvent.aggregate({ where: { tenantId, status: "accepted", createdAt: { gte: todayStart } }, _sum: { revenueInr: true } }),
      prisma.serviceRequest.groupBy({
        by: ["category"],
        where: { tenantId },
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
      hotelName: hotel?.name ?? tenantId,
      reportDate,
      // No room-capacity source → report in-house guests (real) and leave
      // occupancy % null rather than dividing by a magic room count (F-17).
      occupancyPct: null,
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

    let result;
    try {
      result = await generateNightAuditReport(auditData, provider);
    } catch (e) {
      // Don't persist a malformed report (F-11/F-12) — fail cleanly instead.
      aiError(res, "night-audit", e);
      return true;
    }
    await prisma.nightAuditReport.upsert({
      where: { tenantId_reportDate: { tenantId, reportDate } },
      create: { tenantId, reportDate, contentJson: JSON.stringify(result), provider },
      update: { contentJson: JSON.stringify(result), provider }
    });

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorRole: auth.context.role,
        action: "night_audit.generated",
        entityType: "night_audit_report",
        metadata: JSON.stringify({ reportDate, provider })
      }
    });

    json(res, 200, { ok: true, reportDate, provider, report: result });
    return true;
  }

  // ── GET /night-audit/latest ──────────────────────────────────────────────
  if (req.url?.startsWith("/night-audit/latest") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /night-audit/latest");
    if (!auth.ok) return true;
    const licNightLatest = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
    if (!licNightLatest.ok) { json(res, 403, { ok: false, error: licNightLatest.error }); return true; }
    const { tenantId } = auth.context;
    const report = await prisma.nightAuditReport.findFirst({
      where: { tenantId },
      orderBy: { generatedAt: "desc" }
    });
    if (!report) { json(res, 404, { ok: false, error: "No night audit report found" }); return true; }
    let content: unknown = null;
    try { content = JSON.parse(report.contentJson); } catch { content = null; }
    json(res, 200, { ok: true, reportDate: report.reportDate, provider: report.provider, generatedAt: report.generatedAt, report: content });
    return true;
  }

  // ── GET /night-audit/history — browsable list of past reports by date (E-15) ──
  if (req.url?.startsWith("/night-audit/history") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /night-audit/history");
    if (!auth.ok) return true;
    const licNightHist = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
    if (!licNightHist.ok) { json(res, 403, { ok: false, error: licNightHist.error }); return true; }
    const { tenantId } = auth.context;
    const limit = asSafeLimit(parseUrl(req.url).searchParams.get("limit"), 90, 365);
    const reports = await prisma.nightAuditReport.findMany({
      where: { tenantId },
      orderBy: { reportDate: "desc" },
      take: limit,
      select: { reportDate: true, provider: true, generatedAt: true }
    });
    json(res, 200, { ok: true, items: reports });
    return true;
  }

  // ── GET /night-audit/report?date=YYYY-MM-DD — a specific past report (E-15) ──
  if (req.url?.startsWith("/night-audit/report") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /night-audit/report");
    if (!auth.ok) return true;
    const licNightByDate = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
    if (!licNightByDate.ok) { json(res, 403, { ok: false, error: licNightByDate.error }); return true; }
    const { tenantId } = auth.context;
    const reportDate = asTrimmedString(parseUrl(req.url).searchParams.get("date"));
    if (!reportDate || !DATE_ONLY_RE.test(reportDate)) {
      json(res, 400, { ok: false, error: "date must be provided as YYYY-MM-DD" });
      return true;
    }
    const report = await prisma.nightAuditReport.findUnique({
      where: { tenantId_reportDate: { tenantId, reportDate } }
    });
    if (!report) { json(res, 404, { ok: false, error: "No night audit report for that date" }); return true; }
    let content: unknown = null;
    try { content = JSON.parse(report.contentJson); } catch { content = null; }
    json(res, 200, { ok: true, reportDate: report.reportDate, provider: report.provider, generatedAt: report.generatedAt, report: content });
    return true;
  }

  return false;
}
