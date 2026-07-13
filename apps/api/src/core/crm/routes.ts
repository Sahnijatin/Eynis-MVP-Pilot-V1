// CRM domain router (5.1) — extracted verbatim from server.ts. Returns true
// when the request was handled (response written); false lets the main dispatcher
// continue. Authorization goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess, ensureTenantAccess } from "../authz";
import { hasPermission } from "../rbac";
import { parseAIProvider } from "../ai/provider-param";
import { json, parseBody, parseObjectBody, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset, normalizePhoneE164, dateOrNull } from "../../http/helpers";

const parseCrmIdPath = (url: string | undefined, base: string): string | null => {
  if (!url) return null;
  const match = new RegExp(`^/${base}/([^/]+)$`).exec(parseUrl(url).pathname);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

// CRM contact sub-routes: /contacts/:id/{timeline,activities,score}
const parseContactSubPath = (url: string | undefined): { id: string; action: string } | null => {
  if (!url) return null;
  const m = /^\/contacts\/([^/]+)\/(timeline|activities|score)$/.exec(parseUrl(url).pathname);
  return m && m[1] ? { id: decodeURIComponent(m[1]), action: m[2] } : null;
};

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

// Voice campaign routing: /campaigns, /campaigns/:id, /campaigns/:id/:action
;

export async function handleCrmRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(["/pipelines", "/deals", "/contacts", "/companies", "/tasks", "/activities"].some((p) => routePath === p || routePath.startsWith(p + "/")))) return false;

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

    // ── CRM: Contacts — create + list ───────────────────────────────────────
    if (parseUrl(req.url).pathname === "/contacts" && (req.method === "POST" || req.method === "GET")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }
      const { validateContactCreate, serializeContact } = await import("./contacts");

      if (req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /contacts")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
        const body = await parseObjectBody(req);
        const validated = validateContactCreate(body);
        if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return true; }
        const v = validated.value;
        if (v.companyId && !(await prisma.company.findFirst({ where: { id: v.companyId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Company not found" }); return true;
        }
        if (v.ownerId && !(await prisma.user.findFirst({ where: { id: v.ownerId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Owner not found" }); return true;
        }
        const created = await prisma.contact.create({
          data: {
            tenantId, fullName: v.fullName, phoneE164: v.phoneE164, email: v.email,
            lifecycleStage: v.lifecycleStage, leadStatus: v.leadStatus,
            companyId: v.companyId, ownerId: v.ownerId, tags: v.tags, source: v.source, notes: v.notes,
          },
          include: { company: true, owner: true, _count: { select: { deals: true } } },
        });
        json(res, 201, { ok: true, contact: serializeContact(created) });
        return true;
      }

      // GET /contacts — list with CRM filters
      if (!canAccess(auth.context.permissions, "GET /contacts")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
      const qs = parseUrl(req.url).searchParams;
      const limit = asSafeLimit(qs.get("limit"), 50, 200);
      const offset = asSafeOffset(qs.get("offset"));
      const search = asTrimmedString(qs.get("search"));
      const where: Record<string, unknown> = { tenantId };
      const lifecycleStage = qs.get("lifecycleStage"); if (lifecycleStage) where.lifecycleStage = lifecycleStage;
      const leadStatus = qs.get("leadStatus"); if (leadStatus) where.leadStatus = leadStatus;
      const companyId = qs.get("companyId"); if (companyId) where.companyId = companyId;
      const ownerId = qs.get("ownerId"); if (ownerId) where.ownerId = ownerId;
      const tag = asTrimmedString(qs.get("tag")); if (tag) where.tags = { has: tag };
      if (search) where.OR = [
        { fullName: { contains: search, mode: "insensitive" as const } },
        { phoneE164: { contains: search, mode: "insensitive" as const } },
        { email: { contains: search, mode: "insensitive" as const } },
      ];
      const [rows, total] = await Promise.all([
        prisma.contact.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit, skip: offset, include: { company: true, owner: true, _count: { select: { deals: true } } } }),
        prisma.contact.count({ where }),
      ]);
      json(res, 200, { ok: true, items: rows.map(serializeContact), page: { limit, offset, total, hasMore: offset + rows.length < total } });
      return true;
    }

    // ── CRM: Contact timeline / activities / AI score (Increment C) ──────────
    {
      const sub = parseContactSubPath(req.url);
      if (sub) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return true;
        const tenantId = auth.context.tenantId;
        const contact = await prisma.contact.findFirst({ where: { id: sub.id, tenantId }, select: { id: true } });

        // GET /contacts/:id/timeline
        if (sub.action === "timeline" && req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /contacts/:id/timeline")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return true; }
          const { buildContactTimeline } = await import("./timeline");
          const items = await buildContactTimeline(tenantId, sub.id);
          json(res, 200, { ok: true, items });
          return true;
        }

        // POST /contacts/:id/activities — log a note / task / meeting
        if (sub.action === "activities" && req.method === "POST") {
          if (!canAccess(auth.context.permissions, "POST /contacts/:id/activities")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return true; }
          const { validateActivityCreate, serializeActivity } = await import("./activities");
          const body = await parseObjectBody(req);
          const validated = validateActivityCreate(body);
          if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return true; }
          const v = validated.value;
          if (v.dealId && !(await prisma.deal.findFirst({ where: { id: v.dealId, tenantId } }))) { json(res, 400, { ok: false, error: "Deal not found" }); return true; }
          const created = await prisma.activity.create({
            data: { tenantId, contactId: sub.id, dealId: v.dealId, userId: auth.context.userId, type: v.type, title: v.title, body: v.body, dueAt: v.dueAt, status: v.status },
            include: { user: { select: { id: true, fullName: true } } },
          });
          await prisma.contact.update({ where: { id: sub.id }, data: { lastActivityAt: new Date() } });
          json(res, 201, { ok: true, activity: serializeActivity(created) });
          return true;
        }

        // POST /contacts/:id/score — AI (or heuristic) lead score
        if (sub.action === "score" && req.method === "POST") {
          if (!canAccess(auth.context.permissions, "POST /contacts/:id/score")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return true; }
          const { scoreContact } = await import("./scoring");
          const provider = parseAIProvider(req.url);
          const result = await scoreContact(tenantId, sub.id, provider);
          if (!result) { json(res, 404, { ok: false, error: "Contact not found" }); return true; }
          json(res, 200, { ok: true, score: result });
          return true;
        }
      }
    }

    // ── CRM: Tasks (open activities across the tenant) ──────────────────────
    if (parseUrl(req.url).pathname === "/tasks" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /tasks");
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      const { serializeActivity } = await import("./activities");
      const qs = parseUrl(req.url).searchParams;
      const status = qs.get("status") ?? "open";
      const where: Record<string, unknown> = { tenantId, type: "task" };
      if (status !== "all") where.status = status;
      if (qs.get("mine") === "true") where.userId = auth.context.userId;
      const rows = await prisma.activity.findMany({ where, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 200, include: { user: { select: { id: true, fullName: true } }, contact: { select: { id: true, fullName: true } } } });
      json(res, 200, { ok: true, items: rows.map((a) => ({ ...serializeActivity(a), contactName: a.contact?.fullName ?? null })) });
      return true;
    }

    // ── CRM: Activity update / delete (complete a task, edit a note) ─────────
    if (parseUrl(req.url).pathname.startsWith("/activities/")) {
      const id = parseCrmIdPath(req.url, "activities");
      if (id) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return true;
        const tenantId = auth.context.tenantId;
        const activity = await prisma.activity.findFirst({ where: { id, tenantId } });

        if (req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /activities/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!activity) { json(res, 404, { ok: false, error: "Activity not found" }); return true; }
          const { buildActivityUpdate, serializeActivity } = await import("./activities");
          const body = await parseObjectBody(req);
          const update = buildActivityUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return true; }
          const updated = await prisma.activity.update({ where: { id }, data: update.value, include: { user: { select: { id: true, fullName: true } } } });
          json(res, 200, { ok: true, activity: serializeActivity(updated) });
          return true;
        }
        if (req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /activities/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!activity) { json(res, 404, { ok: false, error: "Activity not found" }); return true; }
          await prisma.activity.delete({ where: { id } });
          json(res, 200, { ok: true });
          return true;
        }
      }
    }

    // ── CRM: Contacts — single / update / delete ────────────────────────────
    if (parseUrl(req.url).pathname.startsWith("/contacts/")) {
      const id = parseCrmIdPath(req.url, "contacts");
      if (id) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return true;
        const tenantId = auth.context.tenantId;
        const { buildContactUpdate, serializeContact } = await import("./contacts");
        const { serializeDeal } = await import("./deals");
        const contact = await prisma.contact.findFirst({ where: { id, tenantId } });

        if (req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /contacts/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return true; }
          const [full, deals] = await Promise.all([
            prisma.contact.findFirst({ where: { id, tenantId }, include: { company: true, owner: true, _count: { select: { deals: true } } } }),
            prisma.deal.findMany({ where: { tenantId, contactId: id }, orderBy: { updatedAt: "desc" }, include: { stage: true, contact: true, company: true, owner: true } }),
          ]);
          json(res, 200, { ok: true, contact: serializeContact(full!), deals: deals.map(serializeDeal) });
          return true;
        }

        if (req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /contacts/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return true; }
          const body = await parseObjectBody(req);
          const update = buildContactUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return true; }
          if (update.value.companyId && !(await prisma.company.findFirst({ where: { id: update.value.companyId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Company not found" }); return true;
          }
          if (update.value.ownerId && !(await prisma.user.findFirst({ where: { id: update.value.ownerId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Owner not found" }); return true;
          }
          const updated = await prisma.contact.update({ where: { id }, data: update.value, include: { company: true, owner: true, _count: { select: { deals: true } } } });
          json(res, 200, { ok: true, contact: serializeContact(updated) });
          return true;
        }

        if (req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /contacts/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return true; }
          await prisma.contact.delete({ where: { id } });
          json(res, 200, { ok: true });
          return true;
        }
      }
    }

    // ── CRM: Companies — create + list ──────────────────────────────────────
    if (parseUrl(req.url).pathname === "/companies" && (req.method === "POST" || req.method === "GET")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return true; }
      const { validateCompanyCreate, serializeCompany } = await import("./companies");

      if (req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /companies")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
        const body = await parseObjectBody(req);
        const validated = validateCompanyCreate(body);
        if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return true; }
        const v = validated.value;
        if (v.ownerId && !(await prisma.user.findFirst({ where: { id: v.ownerId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Owner not found" }); return true;
        }
        const created = await prisma.company.create({
          data: { tenantId, name: v.name, domain: v.domain, industry: v.industry, size: v.size, ownerId: v.ownerId, tags: v.tags, notes: v.notes },
          include: { owner: true, _count: { select: { contacts: true, deals: true } } },
        });
        json(res, 201, { ok: true, company: serializeCompany(created) });
        return true;
      }

      // GET /companies — list
      if (!canAccess(auth.context.permissions, "GET /companies")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
      const qs = parseUrl(req.url).searchParams;
      const limit = asSafeLimit(qs.get("limit"), 50, 200);
      const offset = asSafeOffset(qs.get("offset"));
      const search = asTrimmedString(qs.get("search"));
      const where: Record<string, unknown> = { tenantId };
      if (search) where.OR = [
        { name: { contains: search, mode: "insensitive" as const } },
        { domain: { contains: search, mode: "insensitive" as const } },
      ];
      const [rows, total] = await Promise.all([
        prisma.company.findMany({ where, orderBy: { updatedAt: "desc" }, take: limit, skip: offset, include: { owner: true, _count: { select: { contacts: true, deals: true } } } }),
        prisma.company.count({ where }),
      ]);
      json(res, 200, { ok: true, items: rows.map(serializeCompany), page: { limit, offset, total, hasMore: offset + rows.length < total } });
      return true;
    }

    // ── CRM: Companies — single / update / delete ───────────────────────────
    if (parseUrl(req.url).pathname.startsWith("/companies/")) {
      const id = parseCrmIdPath(req.url, "companies");
      if (id) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return true;
        const tenantId = auth.context.tenantId;
        const { buildCompanyUpdate, serializeCompany } = await import("./companies");
        const { serializeContact } = await import("./contacts");
        const { serializeDeal } = await import("./deals");
        const company = await prisma.company.findFirst({ where: { id, tenantId } });

        if (req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /companies/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!company) { json(res, 404, { ok: false, error: "Company not found" }); return true; }
          const [full, contacts, deals] = await Promise.all([
            prisma.company.findFirst({ where: { id, tenantId }, include: { owner: true, _count: { select: { contacts: true, deals: true } } } }),
            prisma.contact.findMany({ where: { tenantId, companyId: id }, orderBy: { updatedAt: "desc" }, include: { company: true, owner: true } }),
            prisma.deal.findMany({ where: { tenantId, companyId: id }, orderBy: { updatedAt: "desc" }, include: { stage: true, contact: true, company: true, owner: true } }),
          ]);
          json(res, 200, { ok: true, company: serializeCompany(full!), contacts: contacts.map(serializeContact), deals: deals.map(serializeDeal) });
          return true;
        }

        if (req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /companies/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!company) { json(res, 404, { ok: false, error: "Company not found" }); return true; }
          const body = await parseObjectBody(req);
          const update = buildCompanyUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return true; }
          if (update.value.ownerId && !(await prisma.user.findFirst({ where: { id: update.value.ownerId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Owner not found" }); return true;
          }
          const updated = await prisma.company.update({ where: { id }, data: update.value, include: { owner: true, _count: { select: { contacts: true, deals: true } } } });
          json(res, 200, { ok: true, company: serializeCompany(updated) });
          return true;
        }

        if (req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /companies/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return true; }
          if (!company) { json(res, 404, { ok: false, error: "Company not found" }); return true; }
          await prisma.company.delete({ where: { id } });
          json(res, 200, { ok: true });
          return true;
        }
      }
    }


  return false;
}
