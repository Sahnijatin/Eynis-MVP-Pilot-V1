// Marketing (templates/sequences/segments) domain router (5.1) — extracted verbatim from server.ts. Returns true
// when the request was handled (response written); false lets the main dispatcher
// continue. Authorization goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize, canAccess } from "../authz";
import { hasPermission } from "../rbac";
import { json, parseBody, parseObjectBody, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset } from "../../http/helpers";

const parseSegmentPath = (
  url: string | undefined,
): { id: string | null; preview: boolean } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  if (pathname === "/segments") return { id: null, preview: false };
  const match = /^\/segments\/([^/]+)(?:\/(preview))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  return { id: decodeURIComponent(match[1]), preview: match[2] === "preview" };
};

// Templates routing: /templates, /templates/:id, /templates/:id/submit
const parseTemplatePath = (
  url: string | undefined,
): { id: string | null; submit: boolean } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  if (pathname === "/templates") return { id: null, submit: false };
  const match = /^\/templates\/([^/]+)(?:\/(submit))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  return { id: decodeURIComponent(match[1]), submit: match[2] === "submit" };
};

// Sequences routing: /sequences, /sequences/:id, /sequences/:id/{enroll,enrollments}
const parseSequencePath = (
  url: string | undefined,
): { id: string | null; sub: "enroll" | "enrollments" | null } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  if (pathname === "/sequences") return { id: null, sub: null };
  const match = /^\/sequences\/([^/]+)(?:\/(enroll|enrollments))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  return { id: decodeURIComponent(match[1]), sub: (match[2] as "enroll" | "enrollments") ?? null };
};

// Lead routing: /campaigns/:id/leads, /campaigns/:id/leads/import, /campaigns/:id/leads/:leadId

export async function handleMarketingRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/templates" || routePath.startsWith("/templates/") || routePath === "/sequences" || routePath.startsWith("/sequences/") || routePath === "/segments" || routePath.startsWith("/segments/"))) return false;

    // ── Message Templates: reusable library + approval status ───────────────
    const tplPath = parseTemplatePath(req.url);
    if (tplPath) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      if (!hasPermission(auth.context.permissions, "manage_campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      const tplMod = await import("./templates");
      const ser = (t: any) => ({ ...t, variables: (() => { try { const v = JSON.parse(t.variables); return Array.isArray(v) ? v : []; } catch { return []; } })() });

      // Collection
      if (tplPath.id === null) {
        if (req.method === "GET") {
          const qs = parseUrl(req.url).searchParams;
          const where = {
            tenantId,
            ...(asTrimmedString(qs.get("channel")) ? { channel: asTrimmedString(qs.get("channel"))! } : {}),
            ...(asTrimmedString(qs.get("status")) ? { status: asTrimmedString(qs.get("status"))! } : {}),
          };
          const rows = await prisma.messageTemplate.findMany({ where, orderBy: { updatedAt: "desc" } });
          json(res, 200, { ok: true, items: rows.map(ser) });
          return true;
        }
        if (req.method === "POST") {
          const body = await parseObjectBody(req);
          const v = tplMod.validateTemplateCreate(body);
          if (!v.ok) { json(res, 400, { ok: false, error: v.error }); return true; }
          const created = await prisma.messageTemplate.create({
            data: { tenantId, name: v.value.name, channel: v.value.channel, category: v.value.category, language: v.value.language, subject: v.value.subject, body: v.value.body, variables: JSON.stringify(v.value.variables) },
          });
          json(res, 201, { ok: true, template: ser(created) });
          return true;
        }
        json(res, 405, { ok: false, error: "Method not allowed" }); return true;
      }

      const tpl = await prisma.messageTemplate.findFirst({ where: { id: tplPath.id, tenantId } });
      if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return true; }

      // POST /templates/:id/submit — draft → submitted
      if (tplPath.submit && req.method === "POST") {
        if (tpl.status !== "draft" && tpl.status !== "rejected") { json(res, 409, { ok: false, error: "Only draft/rejected templates can be submitted" }); return true; }
        const updated = await prisma.messageTemplate.update({ where: { id: tpl.id }, data: { status: "submitted", submittedAt: new Date(), rejectionReason: null } });
        json(res, 200, { ok: true, template: ser(updated) });
        return true;
      }
      if (tplPath.submit) { json(res, 405, { ok: false, error: "Method not allowed" }); return true; }

      if (req.method === "GET") { json(res, 200, { ok: true, template: ser(tpl) }); return true; }
      if (req.method === "PATCH") {
        const body = await parseObjectBody(req);
        const data: Record<string, unknown> = {};
        // Content edits (allowed while not approved).
        for (const f of ["name", "category", "language", "subject", "body"] as const) {
          if (f in body) { const s = asTrimmedString(body[f]); if (f !== "subject" && !s) { json(res, 400, { ok: false, error: `${f} must be a non-empty string` }); return true; } data[f] = s; }
        }
        if ("variables" in body) data.variables = JSON.stringify(Array.isArray(body.variables) ? body.variables.filter((x): x is string => typeof x === "string") : []);
        // Status lifecycle.
        if ("status" in body) {
          const sc = tplMod.validateStatusChange(tpl.channel, String(body.status), { providerTemplateId: body.providerTemplateId as string | null, rejectionReason: body.rejectionReason as string | null });
          if (!sc.ok) { json(res, 400, { ok: false, error: sc.error }); return true; }
          Object.assign(data, sc.value);
        }
        if (Object.keys(data).length === 0) { json(res, 400, { ok: false, error: "No updatable fields provided" }); return true; }
        const updated = await prisma.messageTemplate.update({ where: { id: tpl.id }, data });
        json(res, 200, { ok: true, template: ser(updated) });
        return true;
      }
      if (req.method === "DELETE") {
        await prisma.messageTemplate.delete({ where: { id: tpl.id } });
        json(res, 200, { ok: true, deleted: tpl.id });
        return true;
      }
      json(res, 405, { ok: false, error: "Method not allowed" }); return true;
    }

    // ── Drip Sequences: multi-step automation ───────────────────────────────
    const seqPath = parseSequencePath(req.url);
    if (seqPath) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      if (!hasPermission(auth.context.permissions, "manage_campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      const seqMod = await import("./sequences");
      const serializeStep = (s: { whatsappVariables: string } & Record<string, unknown>) => ({ ...s, whatsappVariables: (() => { try { const v = JSON.parse(s.whatsappVariables); return Array.isArray(v) ? v : []; } catch { return []; } })() });
      const serializeSeq = (s: any) => ({
        id: s.id, name: s.name, status: s.status, exitOn: seqMod.parseExitOn(s.exitOn),
        createdAt: s.createdAt, updatedAt: s.updatedAt,
        ...(s.steps ? { steps: [...s.steps].sort((a: any, b: any) => a.order - b.order).map(serializeStep) } : {}),
        ...(s._count ? { stepCount: s._count.steps, enrollmentCount: s._count.enrollments } : {}),
      });

      // Collection
      if (seqPath.id === null) {
        if (req.method === "GET") {
          const rows = await prisma.sequence.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" }, include: { _count: { select: { steps: true, enrollments: true } } } });
          json(res, 200, { ok: true, items: rows.map(serializeSeq) });
          return true;
        }
        if (req.method === "POST") {
          const body = await parseObjectBody(req);
          const name = asTrimmedString(body.name);
          if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
          const stepsV = seqMod.validateSequenceSteps(body.steps);
          if (!stepsV.ok) { json(res, 400, { ok: false, error: stepsV.error }); return true; }
          const exitOn = seqMod.parseExitOn(body.exitOn ?? ["opted_out", "replied"]);
          const created = await prisma.sequence.create({
            data: {
              tenantId, name, exitOn: JSON.stringify(exitOn),
              steps: { create: stepsV.value.map((s) => ({ order: s.order, waitMinutes: s.waitMinutes, channel: s.channel, whatsappContentSid: s.whatsappContentSid, whatsappTemplateId: s.whatsappTemplateId, whatsappTemplateBody: s.whatsappTemplateBody, whatsappVariables: JSON.stringify(s.whatsappVariables), emailSubject: s.emailSubject, emailBody: s.emailBody })) },
            },
            include: { steps: true },
          });
          json(res, 201, { ok: true, sequence: serializeSeq(created) });
          return true;
        }
        json(res, 405, { ok: false, error: "Method not allowed" }); return true;
      }

      const sequence = await prisma.sequence.findFirst({ where: { id: seqPath.id, tenantId } });
      if (!sequence) { json(res, 404, { ok: false, error: "Sequence not found" }); return true; }

      // POST /sequences/:id/enroll
      if (seqPath.sub === "enroll" && req.method === "POST") {
        const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: sequence.id }, orderBy: { order: "asc" } });
        if (steps.length === 0) { json(res, 400, { ok: false, error: "Sequence has no steps" }); return true; }
        const body = await parseObjectBody(req);
        const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter((x): x is string => typeof x === "string") : [];
        const segmentId = asTrimmedString(body.segmentId);
        const campaignId = asTrimmedString(body.campaignId);
        let where: Record<string, unknown> = { tenantId };
        if (leadIds.length > 0) where = { tenantId, id: { in: leadIds } };
        else if (segmentId) {
          const seg = await prisma.leadSegment.findFirst({ where: { id: segmentId, tenantId }, select: { rules: true } });
          if (!seg) { json(res, 404, { ok: false, error: "Segment not found" }); return true; }
          const { parseSegmentRules, buildLeadWhere } = await import("./segments");
          where = { tenantId, ...(campaignId ? { campaignId } : {}), ...buildLeadWhere(parseSegmentRules(seg.rules)) };
        } else if (campaignId) where = { tenantId, campaignId };
        else { json(res, 400, { ok: false, error: "Provide leadIds, segmentId, or campaignId" }); return true; }

        const targets = await prisma.campaignLead.findMany({ where, take: 5000, select: { id: true } });
        if (targets.length === 0) { json(res, 200, { ok: true, enrolled: 0, skipped: 0 }); return true; }
        const nextRunAt = seqMod.nextRunFrom(new Date(), steps[0].waitMinutes);
        const result = await prisma.sequenceEnrollment.createMany({
          data: targets.map((t) => ({ sequenceId: sequence.id, tenantId, leadId: t.id, currentStepOrder: 0, nextRunAt })),
          skipDuplicates: true,
        });
        json(res, 200, { ok: true, enrolled: result.count, skipped: targets.length - result.count });
        return true;
      }

      // GET /sequences/:id/enrollments
      if (seqPath.sub === "enrollments" && req.method === "GET") {
        const qs = parseUrl(req.url).searchParams;
        const limit = asSafeLimit(qs.get("limit"), 50, 200);
        const offset = asSafeOffset(qs.get("offset"));
        const [items, total] = await Promise.all([
          prisma.sequenceEnrollment.findMany({
            where: { sequenceId: sequence.id }, orderBy: { updatedAt: "desc" }, take: limit, skip: offset,
            select: { id: true, status: true, currentStepOrder: true, nextRunAt: true, stoppedReason: true, createdAt: true, lead: { select: { firstName: true, lastName: true, company: true, phone: true } } },
          }),
          prisma.sequenceEnrollment.count({ where: { sequenceId: sequence.id } }),
        ]);
        json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
        return true;
      }

      if (seqPath.sub) { json(res, 405, { ok: false, error: "Method not allowed" }); return true; }

      // Item GET / PATCH / DELETE
      if (req.method === "GET") {
        const full = await prisma.sequence.findUnique({ where: { id: sequence.id }, include: { steps: true, _count: { select: { steps: true, enrollments: true } } } });
        json(res, 200, { ok: true, sequence: serializeSeq(full) });
        return true;
      }
      if (req.method === "PATCH") {
        const body = await parseObjectBody(req);
        const data: Record<string, unknown> = {};
        if (body.name !== undefined) { const n = asTrimmedString(body.name); if (!n) { json(res, 400, { ok: false, error: "name must be non-empty" }); return true; } data.name = n; }
        if (body.status !== undefined) {
          const st = asTrimmedString(body.status);
          if (!st || !["draft", "active", "archived"].includes(st)) { json(res, 400, { ok: false, error: "status must be draft|active|archived" }); return true; }
          // Activating: every WhatsApp step must reference an approved template.
          if (st === "active") {
            const { isApprovedWhatsappTemplate } = await import("./whatsapp-template");
            const waSteps = await prisma.sequenceStep.findMany({ where: { sequenceId: sequence.id, channel: "whatsapp" }, select: { order: true, whatsappTemplateId: true, whatsappTemplate: { select: { channel: true, status: true, providerTemplateId: true } } } });
            const bad = waSteps.find((s) => !isApprovedWhatsappTemplate(s.whatsappTemplate));
            if (bad) { json(res, 400, { ok: false, error: `Step ${bad.order + 1} (WhatsApp) needs an approved template before the sequence can be activated.` }); return true; }
          }
          data.status = st;
        }
        if (body.exitOn !== undefined) data.exitOn = JSON.stringify(seqMod.parseExitOn(body.exitOn));
        // Replace steps wholesale when provided.
        if (body.steps !== undefined) {
          const stepsV = seqMod.validateSequenceSteps(body.steps);
          if (!stepsV.ok) { json(res, 400, { ok: false, error: stepsV.error }); return true; }
          await prisma.sequenceStep.deleteMany({ where: { sequenceId: sequence.id } });
          data.steps = { create: stepsV.value.map((s) => ({ order: s.order, waitMinutes: s.waitMinutes, channel: s.channel, whatsappContentSid: s.whatsappContentSid, whatsappTemplateId: s.whatsappTemplateId, whatsappTemplateBody: s.whatsappTemplateBody, whatsappVariables: JSON.stringify(s.whatsappVariables), emailSubject: s.emailSubject, emailBody: s.emailBody })) };
        }
        if (Object.keys(data).length === 0) { json(res, 400, { ok: false, error: "No updatable fields provided" }); return true; }
        const updated = await prisma.sequence.update({ where: { id: sequence.id }, data, include: { steps: true } });
        json(res, 200, { ok: true, sequence: serializeSeq(updated) });
        return true;
      }
      if (req.method === "DELETE") {
        await prisma.sequence.delete({ where: { id: sequence.id } });
        json(res, 200, { ok: true, deleted: sequence.id });
        return true;
      }
      json(res, 405, { ok: false, error: "Method not allowed" }); return true;
    }

    // ── Lead Segments: saved tenant-wide audience filters ───────────────────
    const segPath = parseSegmentPath(req.url);
    if (segPath) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return true;
      const tenantId = auth.context.tenantId;
      if (!hasPermission(auth.context.permissions, "manage_campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
      }
      const { parseSegmentRules, buildLeadWhere } = await import("./segments");

      // Collection: GET (list) / POST (create)
      if (segPath.id === null) {
        if (req.method === "GET") {
          const rows = await prisma.leadSegment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
          const items = rows.map((s) => ({ id: s.id, name: s.name, rules: parseSegmentRules(s.rules), createdAt: s.createdAt, updatedAt: s.updatedAt }));
          json(res, 200, { ok: true, items });
          return true;
        }
        if (req.method === "POST") {
          const body = await parseObjectBody(req);
          const name = asTrimmedString(body.name);
          if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
          const rules = parseSegmentRules(body.rules);
          const created = await prisma.leadSegment.create({ data: { tenantId, name, rules: JSON.stringify(rules) } });
          json(res, 201, { ok: true, segment: { id: created.id, name: created.name, rules, createdAt: created.createdAt, updatedAt: created.updatedAt } });
          return true;
        }
        json(res, 405, { ok: false, error: "Method not allowed" }); return true;
      }

      // Item must belong to the tenant.
      const segment = await prisma.leadSegment.findFirst({ where: { id: segPath.id, tenantId } });
      if (!segment) { json(res, 404, { ok: false, error: "Segment not found" }); return true; }

      // GET /segments/:id/preview?campaignId= — count + sample of matching leads
      if (segPath.preview && req.method === "GET") {
        const qs = parseUrl(req.url).searchParams;
        const campaignId = asTrimmedString(qs.get("campaignId"));
        const where = {
          tenantId,
          ...(campaignId ? { campaignId } : {}),
          ...buildLeadWhere(parseSegmentRules(segment.rules)),
        };
        const [total, sample] = await Promise.all([
          prisma.campaignLead.count({ where }),
          prisma.campaignLead.findMany({
            where, orderBy: { createdAt: "desc" }, take: 10,
            select: { id: true, firstName: true, lastName: true, company: true, phone: true, status: true, tags: true },
          }),
        ]);
        json(res, 200, { ok: true, total, sample });
        return true;
      }

      if (segPath.preview) { json(res, 405, { ok: false, error: "Method not allowed" }); return true; }

      if (req.method === "GET") {
        json(res, 200, { ok: true, segment: { id: segment.id, name: segment.name, rules: parseSegmentRules(segment.rules), createdAt: segment.createdAt, updatedAt: segment.updatedAt } });
        return true;
      }
      if (req.method === "PATCH") {
        const body = await parseObjectBody(req);
        const data: Record<string, unknown> = {};
        if (body.name !== undefined) {
          const name = asTrimmedString(body.name);
          if (!name) { json(res, 400, { ok: false, error: "name must be a non-empty string" }); return true; }
          data.name = name;
        }
        if (body.rules !== undefined) data.rules = JSON.stringify(parseSegmentRules(body.rules));
        if (Object.keys(data).length === 0) { json(res, 400, { ok: false, error: "No updatable fields provided" }); return true; }
        const updated = await prisma.leadSegment.update({ where: { id: segment.id }, data });
        json(res, 200, { ok: true, segment: { id: updated.id, name: updated.name, rules: parseSegmentRules(updated.rules), createdAt: updated.createdAt, updatedAt: updated.updatedAt } });
        return true;
      }
      if (req.method === "DELETE") {
        await prisma.leadSegment.delete({ where: { id: segment.id } }); // campaigns.segmentId → SetNull
        json(res, 200, { ok: true, deleted: segment.id });
        return true;
      }
      json(res, 405, { ok: false, error: "Method not allowed" }); return true;
    }


  return false;
}
