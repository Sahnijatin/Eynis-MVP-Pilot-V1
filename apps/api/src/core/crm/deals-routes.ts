// CRM deals sub-router (#164) — the deal/pipeline surface split out of
// core/crm/routes.ts so no routing file exceeds ~600 lines: pipelines, forecast,
// deals CRUD, stage moves, timeline, and the safe-mode AI stage suggestions.
// Extracted verbatim; returns true when it handled the request, false otherwise.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess, ensureTenantAccess } from "../authz";
import { parseAIProvider } from "../ai/provider-param";
import { json, parseObjectBody, parseUrl, asSafeLimit, asSafeOffset } from "../../http/helpers";

// CRM deal suggestion routing: /deals/suggestions/:id/{accept,dismiss}
const parseSuggestionPath = (url: string | undefined): { id: string; action: string } | null => {
  if (!url) return null;
  const m = /^\/deals\/suggestions\/([^/]+)\/(accept|dismiss)$/.exec(parseUrl(url).pathname);
  return m && m[1] ? { id: decodeURIComponent(m[1]), action: m[2] } : null;
};

// CRM deal routing: /deals/:id, /deals/:id/{move,timeline,suggest}  (note: /deals,
// /deals/forecast and /deals/suggestions are matched as exact paths beforehand).
const DEAL_ACTIONS = new Set(["move", "timeline", "suggest"]);
const parseDealPath = (
  url: string | undefined,
): { id: string; action: string | null } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  const match = /^\/deals\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  const action = match[2] ? decodeURIComponent(match[2]) : null;
  if (action !== null && !DEAL_ACTIONS.has(action)) return null;
  return { id: decodeURIComponent(match[1]), action };
};

export async function handleCrmDealRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (routePath !== "/pipelines" && routePath !== "/deals" && !routePath.startsWith("/deals/")) return false;

  // ── CRM: Pipelines ──────────────────────────────────────────────────────
  // GET /pipelines — list the tenant's pipelines (lazily seeding the standard
  // default one on first use so the board always has stages).
  if (parseUrl(req.url).pathname === "/pipelines" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /pipelines");
    if (!auth.ok) return true;
    const tenantId = auth.context.tenantId;
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }
    const { ensureDefaultPipeline, serializePipeline } = await import("./pipeline");
    await ensureDefaultPipeline(tenantId);
    const pipelines = await prisma.pipeline.findMany({
      where: { tenantId, archived: false },
      orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
      include: { stages: { orderBy: { order: "asc" } } },
    });
    json(res, 200, { ok: true, items: pipelines.map(serializePipeline) });
    return true;
  }

  // ── CRM: Forecast ───────────────────────────────────────────────────────
  // GET /deals/forecast — must be matched before /deals/:id.
  if (parseUrl(req.url).pathname === "/deals/forecast" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /deals/forecast");
    if (!auth.ok) return true;
    const tenantId = auth.context.tenantId;
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }
    const { computeForecast } = await import("./forecast");
    const pipelineId = parseUrl(req.url).searchParams.get("pipelineId") || undefined;
    const forecast = await computeForecast(tenantId, pipelineId ? { pipelineId } : {});
    json(res, 200, { ok: true, forecast });
    return true;
  }

  // ── CRM: Deals — create + list ──────────────────────────────────────────
  if (parseUrl(req.url).pathname === "/deals" && (req.method === "POST" || req.method === "GET")) {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    const tenantId = auth.context.tenantId;
    if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }
    const { validateDealCreate, serializeDeal } = await import("./deals");
    const { ensureDefaultPipeline } = await import("./pipeline");

    if (req.method === "POST") {
      if (!canAccess(auth.context.permissions, "POST /deals")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      const body = await parseObjectBody(req);
      const validated = validateDealCreate(body);
      if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return true; }
      const v = validated.value;

      // Resolve the pipeline (explicit, scoped to tenant) or the default.
      const pipeline = v.pipelineId
        ? await prisma.pipeline.findFirst({ where: { id: v.pipelineId, tenantId }, include: { stages: { orderBy: { order: "asc" } } } })
        : await ensureDefaultPipeline(tenantId);
      if (!pipeline) { json(res, 404, { ok: false, error: "Pipeline not found" }); return true; }
      const stage = v.stageId ? pipeline.stages.find((s) => s.id === v.stageId) : pipeline.stages[0];
      if (!stage) { json(res, 400, { ok: false, error: "Invalid stage for this pipeline" }); return true; }

      // Validate optional links belong to the same tenant.
      if (v.contactId && !(await prisma.contact.findFirst({ where: { id: v.contactId, tenantId } }))) {
        json(res, 400, { ok: false, error: "Contact not found" }); return true;
      }
      if (v.companyId && !(await prisma.company.findFirst({ where: { id: v.companyId, tenantId } }))) {
        json(res, 400, { ok: false, error: "Company not found" }); return true;
      }
      if (v.ownerId && !(await prisma.user.findFirst({ where: { id: v.ownerId, tenantId } }))) {
        json(res, 400, { ok: false, error: "Owner not found" }); return true;
      }

      const status = stage.isWon ? "won" : stage.isLost ? "lost" : "open";
      const created = await prisma.deal.create({
        data: {
          tenantId, title: v.title, value: v.value, currency: v.currency,
          pipelineId: pipeline.id, stageId: stage.id,
          contactId: v.contactId, companyId: v.companyId, ownerId: v.ownerId,
          expectedCloseAt: v.expectedCloseAt, source: v.source,
          status, closedAt: status === "open" ? null : new Date(),
          transitions: { create: { tenantId, toStageId: stage.id, changedById: auth.context.userId } },
        },
        include: { stage: true, contact: true, company: true, owner: true },
      });
      json(res, 201, { ok: true, deal: serializeDeal(created) });
      return true;
    }

    // GET /deals — list with filters
    if (!canAccess(auth.context.permissions, "GET /deals")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
    }
    const qs = parseUrl(req.url).searchParams;
    const limit = asSafeLimit(qs.get("limit"), 100, 500);
    const offset = asSafeOffset(qs.get("offset"));
    const where: Record<string, unknown> = { tenantId };
    const pipelineId = qs.get("pipelineId"); if (pipelineId) where.pipelineId = pipelineId;
    const stageId = qs.get("stageId"); if (stageId) where.stageId = stageId;
    const status = qs.get("status"); if (status) where.status = status;
    const ownerId = qs.get("ownerId"); if (ownerId) where.ownerId = ownerId;
    const [rows, total] = await Promise.all([
      prisma.deal.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit, skip: offset, include: { stage: true, contact: true, company: true, owner: true } }),
      prisma.deal.count({ where }),
    ]);
    json(res, 200, { ok: true, items: rows.map(serializeDeal), page: { limit, offset, total, hasMore: offset + rows.length < total } });
    return true;
  }

  // ── CRM: Deal AI suggestions — list (safe mode) ─────────────────────────
  if (parseUrl(req.url).pathname === "/deals/suggestions" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /deals/suggestions");
    if (!auth.ok) return true;
    const tenantId = auth.context.tenantId;
    const { serializeSuggestion } = await import("./suggestions");
    const status = parseUrl(req.url).searchParams.get("status") ?? "pending";
    const where: Record<string, unknown> = { tenantId };
    if (status !== "all") where.status = status;
    const rows = await prisma.dealSuggestion.findMany({
      where, orderBy: { createdAt: "desc" }, take: 100,
      include: { deal: { select: { title: true, pipeline: { select: { stages: { orderBy: { order: "asc" } } } } } } },
    });
    const items = rows.map((s) => serializeSuggestion(s, s.deal.title, s.deal.pipeline.stages));
    json(res, 200, { ok: true, items });
    return true;
  }

  // ── CRM: Deal AI suggestions — accept / dismiss ─────────────────────────
  {
    const sp = parseSuggestionPath(req.url);
    if (sp && req.method === "POST") {
      const permKey = sp.action === "accept" ? "POST /deals/suggestions/:id/accept" : "POST /deals/suggestions/:id/dismiss";
      const auth = await authorize(req, res, permKey);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      const { acceptSuggestion, dismissSuggestion } = await import("./suggestions");
      const result = sp.action === "accept"
        ? await acceptSuggestion(tenantId, sp.id, auth.context.userId)
        : await dismissSuggestion(tenantId, sp.id, auth.context.userId);
      if (!result.ok) { json(res, result.status, { ok: false, error: result.error }); return true; }
      json(res, 200, { ok: true });
      return true;
    }
  }

  // ── CRM: Deals — single / update / delete / move ────────────────────────
  if (parseUrl(req.url).pathname.startsWith("/deals/")) {
    const parsed = parseDealPath(req.url);
    if (parsed) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      const { id, action } = parsed;
      const { buildDealUpdate, serializeDeal } = await import("./deals");
      const deal = await prisma.deal.findFirst({ where: { id, tenantId } });

      // GET /deals/:id
      if (action === null && req.method === "GET") {
        if (!canAccess(auth.context.permissions, "GET /deals/:id")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
        }
        if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return true; }
        const full = await prisma.deal.findFirst({
          where: { id, tenantId },
          include: { stage: true, contact: true, company: true, owner: true, transitions: { orderBy: { createdAt: "desc" } } },
        });
        json(res, 200, {
          ok: true,
          deal: serializeDeal(full!),
          transitions: (full!.transitions).map((t) => ({
            id: t.id, fromStageId: t.fromStageId, toStageId: t.toStageId,
            changedById: t.changedById, note: t.note, createdAt: t.createdAt.toISOString(),
          })),
        });
        return true;
      }

      // PATCH /deals/:id
      if (action === null && req.method === "PATCH") {
        if (!canAccess(auth.context.permissions, "PATCH /deals/:id")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
        }
        if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return true; }
        const body = await parseObjectBody(req);
        const update = buildDealUpdate(body);
        if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return true; }
        if (update.value.contactId && !(await prisma.contact.findFirst({ where: { id: update.value.contactId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Contact not found" }); return true;
        }
        if (update.value.companyId && !(await prisma.company.findFirst({ where: { id: update.value.companyId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Company not found" }); return true;
        }
        if (update.value.ownerId && !(await prisma.user.findFirst({ where: { id: update.value.ownerId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Owner not found" }); return true;
        }
        const updated = await prisma.deal.update({
          where: { id }, data: update.value, include: { stage: true, contact: true, company: true, owner: true },
        });
        json(res, 200, { ok: true, deal: serializeDeal(updated) });
        return true;
      }

      // DELETE /deals/:id
      if (action === null && req.method === "DELETE") {
        if (!canAccess(auth.context.permissions, "DELETE /deals/:id")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
        }
        if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return true; }
        await prisma.deal.delete({ where: { id } });
        json(res, 200, { ok: true });
        return true;
      }

      // POST /deals/:id/move — change stage (logs a transition, auto-sets won/lost)
      if (action === "move" && req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /deals/:id/move")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
        }
        if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return true; }
        const body = await parseObjectBody(req);
        const toStageId = typeof body.stageId === "string" ? body.stageId : null;
        if (!toStageId) { json(res, 400, { ok: false, error: "stageId is required" }); return true; }
        // Target stage must belong to THIS deal's pipeline and tenant.
        const toStage = await prisma.stage.findFirst({ where: { id: toStageId, tenantId, pipelineId: deal.pipelineId } });
        if (!toStage) { json(res, 400, { ok: false, error: "Target stage is not in this deal's pipeline" }); return true; }
        if (toStage.id === deal.stageId) {
          const same = await prisma.deal.findFirst({ where: { id, tenantId }, include: { stage: true, contact: true, company: true, owner: true } });
          json(res, 200, { ok: true, deal: serializeDeal(same!) });
          return true;
        }
        const status = toStage.isWon ? "won" : toStage.isLost ? "lost" : "open";
        const lostReason = status === "lost" && typeof body.lostReason === "string" ? body.lostReason : deal.lostReason;
        const updated = await prisma.deal.update({
          where: { id },
          data: {
            stageId: toStage.id, status, lostReason,
            closedAt: status === "open" ? null : (deal.closedAt ?? new Date()),
            transitions: { create: { tenantId, fromStageId: deal.stageId, toStageId: toStage.id, changedById: auth.context.userId } },
          },
          include: { stage: true, contact: true, company: true, owner: true },
        });
        json(res, 200, { ok: true, deal: serializeDeal(updated) });
        return true;
      }

      // GET /deals/:id/timeline
      if (action === "timeline" && req.method === "GET") {
        if (!canAccess(auth.context.permissions, "GET /deals/:id/timeline")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
        if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return true; }
        const { buildContactTimeline } = await import("./timeline");
        const dealActivities = await prisma.activity.findMany({ where: { tenantId, dealId: id }, include: { user: { select: { fullName: true } } }, orderBy: { createdAt: "desc" } });
        const contactItems = deal.contactId ? await buildContactTimeline(tenantId, deal.contactId) : [];
        // De-dupe: an activity linked to both this deal and its contact is returned
        // by both sources — keep one (keyed by kind+id).
        const seen = new Set<string>();
        const items = [
          ...dealActivities.map((a) => ({ id: a.id, kind: a.type, title: a.title, body: a.body, direction: a.direction, sentiment: null as string | null, status: a.status, at: a.createdAt.toISOString() })),
          ...contactItems,
        ]
          .filter((it) => { const k = it.kind + ":" + it.id; if (seen.has(k)) return false; seen.add(k); return true; })
          .sort((x, y) => y.at.localeCompare(x.at));
        json(res, 200, { ok: true, items });
        return true;
      }

      // POST /deals/:id/suggest — generate a safe-mode AI stage suggestion
      if (action === "suggest" && req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /deals/:id/suggest")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
        if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return true; }
        const { generateDealSuggestion } = await import("./suggestions");
        const provider = parseAIProvider(req.url);
        const suggestion = await generateDealSuggestion(tenantId, id, provider);
        json(res, 200, { ok: true, suggestion });
        return true;
      }
    }
  }
  return false;
}
