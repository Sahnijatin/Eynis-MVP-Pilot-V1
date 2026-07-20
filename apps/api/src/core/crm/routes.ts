// CRM domain router (5.1) — extracted verbatim from server.ts. Returns true
// when the request was handled (response written); false lets the main dispatcher
// continue. Authorization goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess, ensureTenantAccess } from "../authz";
import { parseAIProvider } from "../ai/provider-param";
import { json, parseObjectBody, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset } from "../../http/helpers";

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

export async function handleCrmRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(["/contacts", "/companies", "/tasks", "/activities"].some((p) => routePath === p || routePath.startsWith(p + "/")))) return false;

    // ── CRM: Customer intelligence (Phase 7) ─────────────────────────────────
    // Per-contact commercial picture from REAL records: accepted-quote totals,
    // last win, and open fulfillment orders. Declared before the /contacts/:id
    // matchers so "intel" is never mistaken for a contact id.
    if (routePath === "/contacts/intel" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /contacts/intel");
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      const [accepted, sent, openOrders] = await Promise.all([
        prisma.quote.groupBy({
          by: ["contactId"],
          where: { tenantId, status: "accepted", contactId: { not: null } },
          _sum: { totalPaise: true }, _count: { _all: true }, _max: { acceptedAt: true },
        }),
        prisma.quote.groupBy({
          by: ["contactId"],
          where: { tenantId, status: "sent", contactId: { not: null } },
          _count: { _all: true },
        }),
        prisma.order.groupBy({
          by: ["contactId"],
          where: { tenantId, stage: { not: "delivered" }, contactId: { not: null } },
          _count: { _all: true },
        }),
      ]);
      const sentBy = new Map(sent.map((g) => [g.contactId as string, g._count._all]));
      const ordersBy = new Map(openOrders.map((g) => [g.contactId as string, g._count._all]));
      const ids = [...new Set([...accepted.map((g) => g.contactId as string), ...sentBy.keys(), ...ordersBy.keys()])];
      const contacts = ids.length
        ? await prisma.contact.findMany({ where: { tenantId, id: { in: ids } }, select: { id: true, fullName: true, phoneE164: true, email: true } })
        : [];
      const acceptedBy = new Map(accepted.map((g) => [g.contactId as string, g]));
      const items = contacts.map((c) => {
        const a = acceptedBy.get(c.id);
        return {
          id: c.id, fullName: c.fullName, phoneE164: c.phoneE164, email: c.email,
          acceptedTotalPaise: a?._sum.totalPaise ?? 0,
          acceptedCount: a?._count._all ?? 0,
          lastAcceptedAt: a?._max.acceptedAt ?? null,
          pendingQuotes: sentBy.get(c.id) ?? 0,
          openOrders: ordersBy.get(c.id) ?? 0,
        };
      }).sort((x, y) => y.acceptedTotalPaise - x.acceptedTotalPaise);
      json(res, 200, { ok: true, items });
      return true;
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
