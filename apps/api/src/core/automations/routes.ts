// Automations domain router (#164) — list rules, executions log, and toggle a rule.
// Extracted verbatim from server.ts. Returns true when it handled the request;
// false lets the dispatcher continue. (The rule-evaluation engine lives in
// ./engine.ts; this is just the HTTP surface.)
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { json, parseBody, parseUrl, asSafeLimit, asSafeOffset } from "../../http/helpers";
import { enforceLicenseFeature } from "../license";

export async function handleAutomationRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // ── PATCH /automations/:id — pause / resume a rule ───────────────────────
  // The automation engine only fires rules with isActive: true, so toggling
  // this genuinely starts/stops the rule on the next 60s cycle.
  const autoPatchMatch = req.method === "PATCH" ? /^\/automations\/([^/]+)$/.exec(parseUrl(req.url).pathname) : null;
  if (autoPatchMatch) {
    const auth = await authorize(req, res, "PATCH /automations/:id");
    if (!auth.ok) return true;
    const context = auth.context;
    const licAuto = await enforceLicenseFeature(context.tenantId, "automations");
    if (!licAuto.ok) { json(res, 403, { ok: false, error: licAuto.error }); return true; }
    const ruleId = decodeURIComponent(autoPatchMatch[1] as string);
    const body = (await parseBody(req)) as { isActive?: unknown };
    if (typeof body.isActive !== "boolean") { json(res, 400, { ok: false, error: "isActive (boolean) is required" }); return true; }
    const existing = await prisma.automationRule.findFirst({ where: { id: ruleId, tenantId: context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Automation not found" }); return true; }
    const updated = await prisma.automationRule.update({ where: { id: ruleId }, data: { isActive: body.isActive }, select: { id: true, isActive: true } });
    json(res, 200, { ok: true, rule: updated });
    return true;
  }

  // ── GET /automations/executions ──────────────────────────────────────────
  if (req.url?.startsWith("/automations/executions") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /automations/executions");
    if (!auth.ok) return true;
    const licExec = await enforceLicenseFeature(auth.context.tenantId, "automations");
    if (!licExec.ok) { json(res, 403, { ok: false, error: licExec.error }); return true; }
    const u = parseUrl(req.url);
    const limit = asSafeLimit(u.searchParams.get("limit"), 20, 100);
    const offset = asSafeOffset(u.searchParams.get("offset"));
    const [execs, total] = await Promise.all([
      prisma.automationExecution.findMany({
        where: { tenantId: auth.context.tenantId },
        orderBy: { executedAt: "desc" },
        skip: offset,
        take: limit
      }),
      prisma.automationExecution.count({ where: { tenantId: auth.context.tenantId } })
    ]);
    json(res, 200, {
      ok: true,
      items: execs.map((e) => ({
        id: e.id, ruleId: e.ruleId, ruleCode: e.ruleCode,
        triggerType: e.triggerType, triggerEntityId: e.triggerEntityId,
        actionType: e.actionType, actionResult: e.actionResult,
        resultDetail: e.resultDetail, executedAt: e.executedAt
      })),
      page: { limit, offset, total, hasMore: offset + execs.length < total }
    });
    return true;
  }

  // ── GET /automations ─────────────────────────────────────────────────────
  if (req.url?.startsWith("/automations") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /automations");
    if (!auth.ok) return true;
    const context = auth.context;
    const licAuto = await enforceLicenseFeature(context.tenantId, "automations");
    if (!licAuto.ok) { json(res, 403, { ok: false, error: licAuto.error }); return true; }
    const rules = await prisma.automationRule.findMany({
      where: { tenantId: context.tenantId },
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
      where: { tenantId: context.tenantId },
      _count: { id: true }
    });
    const successCounts = await prisma.automationExecution.groupBy({
      by: ["ruleId"],
      where: { tenantId: context.tenantId, actionResult: "success" },
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
    return true;
  }

  return false;
}
