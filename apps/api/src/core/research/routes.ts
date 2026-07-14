// Research Studio domain router (5.1) — extracted verbatim from server.ts. Returns true
// when the request was handled (response written); false lets the main dispatcher
// continue. Authorization goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { hasPermission } from "../rbac";
import { json, parseBody, parseObjectBody, asTrimmedString, parseUrl, asSafeLimit, sendDoc, sendBinary } from "../../http/helpers";
import { loadReportBrand } from "../export/brand";
import { brandedCsv } from "../export/csv";
import { renderBrandedReportHtml, type ReportBlock } from "../export/report-html";
import { renderBrandedReportPdf } from "../export/report-pdf";
import { broadcastSSEEvent } from "../../sse/clients";
import { enforceLicenseFeature } from "../license";
import { resolveAiCredentials, aiConfigured } from "../research/ai-credentials";
import { validateTemplateDef, RESEARCH_SOURCE_CATALOG, SUBJECT_TYPES, SECTION_OUTPUTS, type SubjectType } from "./types";
import { isBuiltinId } from "./templates";
import { listTemplates, getTemplateDetail, loadTemplateForRun } from "./store";
import { searchProvidersAvailable } from "./sources/search";
import type { SynthResult } from "./synthesize";
import { buildReportBlocks, buildReportCsv } from "./render";
import { isCadence, advanceCadence, type Cadence } from "./schedule";

export async function handleResearchRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/research" || routePath.startsWith("/research/"))) return false;

    // ── Research Studio: configurable research & report module (RS-1) ─────────
    // Gated by the research_studio license feature + per-action permissions
    // (view_research / run_research / manage_research). Runs execute async on the
    // research worker; the UI polls GET /research/runs/:id (and the global SSE feed
    // carries "research_run" progress events). All queries are tenant-scoped.
    {
      const rpath = parseUrl(req.url).pathname;
      if (rpath === "/research" || rpath.startsWith("/research/")) {
        const ensureResearchLicense = async (tenantId: string): Promise<boolean> => {
          const lic = await enforceLicenseFeature(tenantId, "research_studio");
          if (!lic.ok) { json(res, 402, lic); return false; }
          return true;
        };

        // Per-run share ACL (RS-3), mirroring ReportShare. A run is viewable when:
        // the requester created it, it's shared tenant-wide, an explicit grant names
        // them or their role, OR they hold manage_research (admin/manager oversight —
        // research can incur cost, so managers always retain visibility). Managing a
        // run's sharing stays creator-only; re-running additionally needs run_research.
        const runSharePrincipals = (userId: string, roleKey: string | null) => {
          const p: Array<{ principalType: string; principalId: string }> = [{ principalType: "user", principalId: userId }];
          if (roleKey) p.push({ principalType: "role", principalId: roleKey });
          return p;
        };
        const canViewRun = async (
          run: { shared: boolean; createdById: string | null },
          runId: string, tenantId: string, userId: string, roleKey: string | null, permissions: string[],
        ): Promise<boolean> => {
          if (run.createdById === userId || run.shared || hasPermission(permissions, "manage_research")) return true;
          const grant = await prisma.researchShare.findFirst({
            where: { runId, tenantId, OR: runSharePrincipals(userId, roleKey) },
            select: { id: true },
          });
          return grant !== null;
        };

        // GET /research/sources — source catalog + enums for the builder UI.
        if (rpath === "/research/sources" && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/sources"); if (!auth.ok) return true;
          const [searchProviders, aiCreds] = await Promise.all([
            searchProvidersAvailable(auth.context.tenantId),
            resolveAiCredentials(auth.context.tenantId),
          ]);
          json(res, 200, {
            ok: true, sources: RESEARCH_SOURCE_CATALOG, subjectTypes: SUBJECT_TYPES, outputs: SECTION_OUTPUTS,
            searchConfigured: searchProviders.searxng || searchProviders.tavily, searchProviders,
            aiConfigured: aiConfigured(aiCreds),
          });
          return true;
        }

        // GET /research/templates — built-ins + tenant templates.
        if (rpath === "/research/templates" && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/templates"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          if (!(await ensureResearchLicense(tenantId))) return true;
          const items = await listTemplates(tenantId);
          json(res, 200, { ok: true, items: items.map((t) => ({ ...t, isOwner: t.createdById === userId })) });
          return true;
        }

        // POST /research/templates — create a saved template.
        if (rpath === "/research/templates" && req.method === "POST") {
          const auth = await authorize(req, res, "POST /research/templates"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          if (!(await ensureResearchLicense(tenantId))) return true;
          const body = await parseObjectBody(req);
          const valid = validateTemplateDef(body);
          if (!valid.ok) { json(res, 400, valid); return true; }
          const def = valid.def;
          const created = await prisma.researchTemplate.create({
            data: {
              tenantId, name: def.name, description: def.description ?? null, subjectType: def.subjectType,
              inputsJson: JSON.stringify(def.inputs), sourcesJson: JSON.stringify(def.sources), sectionsJson: JSON.stringify(def.sections),
              createdById: userId,
            },
            select: { id: true },
          });
          json(res, 201, { ok: true, id: created.id });
          return true;
        }

        // ── Auto-run triggers (RS-3): deal stage → research ─────────────────────
        // Stored as a list inside one AutomationRule (code "research_on_stage"),
        // since the rule table is unique per (tenant, code). The automation engine
        // evaluates these every cycle and enqueues runs for open deals in the stage.
        const RESEARCH_RULE_CODE = "research_on_stage";
        const readTriggers = (configJson: string): Array<{ stageId: string; templateId: string; fast?: boolean }> => {
          try {
            const cfg = JSON.parse(configJson) as { triggers?: Array<{ stageId: string; templateId: string; fast?: boolean }> };
            return Array.isArray(cfg.triggers) ? cfg.triggers : [];
          } catch { return []; }
        };

        if (rpath === "/research/triggers" && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/triggers"); if (!auth.ok) return true;
          const { permissions, tenantId } = auth.context;
          const rule = await prisma.automationRule.findUnique({ where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } } });
          json(res, 200, { ok: true, triggers: rule ? readTriggers(rule.configJson) : [], isActive: rule?.isActive ?? false });
          return true;
        }

        if (rpath === "/research/triggers" && req.method === "POST") {
          const auth = await authorize(req, res, "POST /research/triggers"); if (!auth.ok) return true;
          const { permissions, tenantId } = auth.context;
          if (!(await ensureResearchLicense(tenantId))) return true;
          const body = (await parseBody(req)) as { stageId?: unknown; templateId?: unknown; fast?: unknown };
          const stageId = asTrimmedString(body.stageId);
          const templateId = asTrimmedString(body.templateId);
          if (!stageId || !templateId) { json(res, 400, { ok: false, error: "stageId and templateId are required" }); return true; }
          const stage = await prisma.stage.findFirst({ where: { id: stageId, tenantId }, select: { id: true } });
          if (!stage) { json(res, 404, { ok: false, error: "Stage not found" }); return true; }
          const tpl = await loadTemplateForRun(tenantId, templateId);
          if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
          const existing = await prisma.automationRule.findUnique({ where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } } });
          const triggers = existing ? readTriggers(existing.configJson).filter((t) => t.stageId !== stageId) : [];
          triggers.push({ stageId, templateId, fast: body.fast !== false });
          await prisma.automationRule.upsert({
            where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } },
            update: { configJson: JSON.stringify({ triggers }), isActive: true },
            create: { tenantId, code: RESEARCH_RULE_CODE, name: "Auto-run research on deal stage", isActive: true, configJson: JSON.stringify({ triggers }) },
          });
          json(res, 200, { ok: true, triggers });
          return true;
        }

        const triggerDelMatch = /^\/research\/triggers\/([^/]+)$/.exec(rpath);
        if (triggerDelMatch && req.method === "DELETE") {
          const auth = await authorize(req, res, "DELETE /research/triggers/:stageId"); if (!auth.ok) return true;
          const { permissions, tenantId } = auth.context;
          const stageId = decodeURIComponent(triggerDelMatch[1] as string);
          const existing = await prisma.automationRule.findUnique({ where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } } });
          if (existing) {
            const triggers = readTriggers(existing.configJson).filter((t) => t.stageId !== stageId);
            await prisma.automationRule.update({
              where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } },
              data: { configJson: JSON.stringify({ triggers }), isActive: triggers.length > 0 },
            });
          }
          json(res, 200, { ok: true });
          return true;
        }

        const tplMatch = /^\/research\/templates\/([^/]+)$/.exec(rpath);
        const runExportMatch = /^\/research\/runs\/([^/]+)\/export$/.exec(rpath);
        const runScheduleMatch = /^\/research\/runs\/([^/]+)\/schedule$/.exec(rpath);
        const scheduleIdMatch = /^\/research\/schedules\/([^/]+)$/.exec(rpath);
        const runSharesMatch = /^\/research\/runs\/([^/]+)\/shares$/.exec(rpath);
        const runIdMatch = /^\/research\/runs\/([^/]+)$/.exec(rpath);

        // The active schedule (if any) matching a run's subject: keyed by the
        // persistent subject when present, else by the freeform run signature.
        const scheduleMatchFor = (run: { tenantId: string; subjectType: string; subjectId: string | null; templateName: string; subjectLabel: string | null; inputsJson: string }) =>
          run.subjectId
            ? { tenantId: run.tenantId, subjectType: run.subjectType, subjectId: run.subjectId }
            : { tenantId: run.tenantId, subjectType: run.subjectType, subjectId: null, templateName: run.templateName, subjectLabel: run.subjectLabel, inputsJson: run.inputsJson };
        const serializeSchedule = (s: { id: string; cadence: string; isActive: boolean; nextRunAt: Date; lastRunAt: Date | null; lastRunId: string | null; subjectType: string; subjectLabel: string | null; templateName: string; createdById: string | null }) => ({
          id: s.id, cadence: s.cadence, isActive: s.isActive,
          nextRunAt: s.nextRunAt.toISOString(), lastRunAt: s.lastRunAt ? s.lastRunAt.toISOString() : null,
          lastRunId: s.lastRunId, subjectType: s.subjectType, subjectLabel: s.subjectLabel, templateName: s.templateName,
        });

        // GET /research/templates/:id — full definition for the editor.
        if (tplMatch && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/templates/:id"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          const id = decodeURIComponent(tplMatch[1] as string);
          const detail = await getTemplateDetail(tenantId, id);
          if (!detail) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
          json(res, 200, { ok: true, template: { id: detail.id, isBuiltIn: detail.isBuiltIn, isOwner: detail.createdById === userId, ...detail.def } });
          return true;
        }

        // PUT /research/templates/:id — update (built-ins are read-only; clone instead).
        if (tplMatch && req.method === "PUT") {
          const auth = await authorize(req, res, "PUT /research/templates/:id"); if (!auth.ok) return true;
          const { permissions, tenantId } = auth.context;
          const id = decodeURIComponent(tplMatch[1] as string);
          if (isBuiltinId(id)) { json(res, 400, { ok: false, error: "Built-in templates can't be edited — duplicate it first" }); return true; }
          const existing = await prisma.researchTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
          if (!existing) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
          const body = await parseObjectBody(req);
          const valid = validateTemplateDef(body);
          if (!valid.ok) { json(res, 400, valid); return true; }
          const def = valid.def;
          await prisma.researchTemplate.update({
            where: { id },
            data: {
              name: def.name, description: def.description ?? null, subjectType: def.subjectType,
              inputsJson: JSON.stringify(def.inputs), sourcesJson: JSON.stringify(def.sources), sectionsJson: JSON.stringify(def.sections),
            },
          });
          json(res, 200, { ok: true });
          return true;
        }

        // DELETE /research/templates/:id — delete (built-ins read-only).
        if (tplMatch && req.method === "DELETE") {
          const auth = await authorize(req, res, "DELETE /research/templates/:id"); if (!auth.ok) return true;
          const { permissions, tenantId } = auth.context;
          const id = decodeURIComponent(tplMatch[1] as string);
          if (isBuiltinId(id)) { json(res, 400, { ok: false, error: "Built-in templates can't be deleted" }); return true; }
          const existing = await prisma.researchTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
          if (!existing) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
          await prisma.researchTemplate.delete({ where: { id } });
          json(res, 200, { ok: true });
          return true;
        }

        // POST /research/runs — enqueue a run against a template.
        if (rpath === "/research/runs" && req.method === "POST") {
          const auth = await authorize(req, res, "POST /research/runs"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          if (!(await ensureResearchLicense(tenantId))) return true;
          const body = (await parseBody(req)) as {
            templateId?: unknown; inputs?: unknown; subjectType?: unknown; subjectId?: unknown; subjectLabel?: unknown; fast?: unknown;
          };
          const templateId = asTrimmedString(body.templateId);
          if (!templateId) { json(res, 400, { ok: false, error: "templateId is required" }); return true; }
          const tpl = await loadTemplateForRun(tenantId, templateId);
          if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return true; }
          const def = body.fast === true ? { ...tpl.def, fast: true } : tpl.def;

          // Coerce inputs to a flat string map (allow-listed keys only).
          const inputs: Record<string, string> = {};
          if (body.inputs && typeof body.inputs === "object") {
            for (const [k, v] of Object.entries(body.inputs as Record<string, unknown>)) {
              const key = k.replace(/[^a-zA-Z0-9_]/g, "");
              if (key && (typeof v === "string" || typeof v === "number" || typeof v === "boolean")) inputs[key] = String(v).slice(0, 500);
            }
          }
          const subjectType: SubjectType = SUBJECT_TYPES.includes(body.subjectType as SubjectType) ? (body.subjectType as SubjectType) : def.subjectType;
          const subjectLabel = asTrimmedString(body.subjectLabel) ?? (inputs.name ? inputs.name : null);

          // A run's subjectId drives CRM write-back (timeline activity, lead score).
          // It MUST belong to this tenant — otherwise a caller could target another
          // tenant's record. Verify ownership and reject a foreign/unknown subject.
          const subjectId = asTrimmedString(body.subjectId);
          if (subjectId && (subjectType === "contact" || subjectType === "deal" || subjectType === "company")) {
            const owned =
              subjectType === "contact" ? await prisma.contact.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } })
              : subjectType === "deal" ? await prisma.deal.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } })
              : await prisma.company.findFirst({ where: { id: subjectId, tenantId }, select: { id: true } });
            if (!owned) { json(res, 404, { ok: false, error: "Subject not found" }); return true; }
          }

          const run = await prisma.researchRun.create({
            data: {
              tenantId,
              templateId: isBuiltinId(templateId) ? null : templateId,
              templateName: tpl.name,
              templateSnapshot: JSON.stringify(def),
              subjectType,
              subjectId,
              subjectLabel,
              inputsJson: JSON.stringify(inputs),
              status: "queued",
              createdById: userId,
            },
            select: { id: true },
          });
          broadcastSSEEvent(tenantId, { type: "research_run", data: { id: run.id, status: "queued", progress: 0, stage: "Queued" } });
          json(res, 201, { ok: true, id: run.id });
          return true;
        }

        // POST /research/runs/:id/rerun — re-run with the same snapshot/inputs/subject (RS-4).
        const runRerunMatch = /^\/research\/runs\/([^/]+)\/rerun$/.exec(rpath);
        if (runRerunMatch && req.method === "POST") {
          const auth = await authorize(req, res, "POST /research/runs/:id/rerun"); if (!auth.ok) return true;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          if (!(await ensureResearchLicense(tenantId))) return true;
          const id = decodeURIComponent(runRerunMatch[1] as string);
          const prev = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!prev || !(await canViewRun(prev, id, tenantId, userId, roleKey, permissions))) { json(res, 404, { ok: false, error: "Run not found" }); return true; }
          const fresh = await prisma.researchRun.create({
            data: {
              tenantId,
              templateId: prev.templateId,
              templateName: prev.templateName,
              templateSnapshot: prev.templateSnapshot,
              subjectType: prev.subjectType,
              subjectId: prev.subjectId,
              subjectLabel: prev.subjectLabel,
              inputsJson: prev.inputsJson,
              status: "queued",
              createdById: userId,
            },
            select: { id: true },
          });
          broadcastSSEEvent(tenantId, { type: "research_run", data: { id: fresh.id, status: "queued", progress: 0, stage: "Queued" } });
          json(res, 201, { ok: true, id: fresh.id });
          return true;
        }

        // GET /research/runs — list recent runs the requester can see (own + shared
        // tenant-wide + explicitly granted). Managers (manage_research) see all runs.
        if (rpath === "/research/runs" && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/runs"); if (!auth.ok) return true;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          const limit = asSafeLimit(parseUrl(req.url).searchParams.get("limit"), 50, 200);
          const visibility = hasPermission(permissions, "manage_research")
            ? {}
            : {
                OR: [
                  { shared: true },
                  { createdById: userId },
                  { shares: { some: { OR: runSharePrincipals(userId, roleKey) } } },
                ],
              };
          const rows = await prisma.researchRun.findMany({
            where: { tenantId, ...visibility },
            orderBy: { createdAt: "desc" },
            take: limit,
            select: { id: true, templateName: true, subjectType: true, subjectLabel: true, status: true, progress: true, stage: true, score: true, error: true, shared: true, createdById: true, createdAt: true, completedAt: true },
          });
          json(res, 200, { ok: true, items: rows.map((r) => ({ ...r, isOwner: r.createdById === userId })) });
          return true;
        }

        // GET /research/runs/:id/export?format=pdf|csv|html — branded export.
        if (runExportMatch && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/runs/:id/export"); if (!auth.ok) return true;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          const id = decodeURIComponent(runExportMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run || !(await canViewRun(run, id, tenantId, userId, roleKey, permissions))) { json(res, 404, { ok: false, error: "Run not found" }); return true; }
          if (run.status !== "ready" || !run.resultJson) { json(res, 409, { ok: false, error: "Report is not ready yet" }); return true; }
          const result = JSON.parse(run.resultJson) as SynthResult;
          const brand = await loadReportBrand(tenantId);
          const title = run.templateName;
          const subtitle = run.subjectLabel ?? undefined;
          const safeName = (run.subjectLabel ?? run.templateName).replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "") || "research";
          const fmt = parseUrl(req.url).searchParams.get("format");
          if (fmt === "csv") {
            sendDoc(res, "text/csv; charset=utf-8", brandedCsv(brand, title, buildReportCsv(result)), `${safeName}.csv`);
            return true;
          }
          const blocks: ReportBlock[] = buildReportBlocks({ title, subject: run.subjectLabel ?? "", score: run.score, result });
          if (fmt === "pdf") {
            const pdf = await renderBrandedReportPdf(brand, { title, subtitle, blocks });
            sendBinary(res, "application/pdf", pdf, `${safeName}.pdf`);
            return true;
          }
          sendDoc(res, "text/html; charset=utf-8", renderBrandedReportHtml(brand, { title, subtitle, blocks }));
          return true;
        }

        // GET /research/runs/:id/schedule — the active recurring schedule (if any)
        // for this run's subject, so the run view can show its auto-refresh state.
        if (runScheduleMatch && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/runs/:id/schedule"); if (!auth.ok) return true;
          const { permissions, tenantId } = auth.context;
          const id = decodeURIComponent(runScheduleMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return true; }
          const schedule = await prisma.researchSchedule.findFirst({ where: scheduleMatchFor(run), orderBy: { createdAt: "desc" } });
          json(res, 200, { ok: true, schedule: schedule ? serializeSchedule(schedule) : null });
          return true;
        }

        // POST /research/runs/:id/schedule — turn on (or update) recurring
        // re-research for this run's subject. Body: { cadence: daily|weekly|monthly }.
        // The clock-driven twin of /rerun: it snapshots the run's params.
        if (runScheduleMatch && req.method === "POST") {
          const auth = await authorize(req, res, "POST /research/runs/:id/schedule"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          if (!(await ensureResearchLicense(tenantId))) return true;
          const id = decodeURIComponent(runScheduleMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return true; }
          const body = (await parseBody(req)) as { cadence?: unknown };
          const cadence: Cadence = isCadence(body.cadence) ? body.cadence : "weekly";
          const nextRunAt = advanceCadence(new Date(), cadence);
          const existing = await prisma.researchSchedule.findFirst({ where: scheduleMatchFor(run) });
          const saved = existing
            ? await prisma.researchSchedule.update({ where: { id: existing.id }, data: { cadence, isActive: true, nextRunAt } })
            : await prisma.researchSchedule.create({
                data: {
                  tenantId, templateId: run.templateId, templateName: run.templateName, templateSnapshot: run.templateSnapshot,
                  subjectType: run.subjectType, subjectId: run.subjectId, subjectLabel: run.subjectLabel, inputsJson: run.inputsJson,
                  cadence, isActive: true, nextRunAt, createdById: userId,
                },
              });
          json(res, existing ? 200 : 201, { ok: true, schedule: serializeSchedule(saved) });
          return true;
        }

        // GET /research/schedules — all recurring schedules in the tenant.
        if (rpath === "/research/schedules" && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/schedules"); if (!auth.ok) return true;
          const { permissions, tenantId } = auth.context;
          const rows = await prisma.researchSchedule.findMany({ where: { tenantId }, orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }] });
          json(res, 200, { ok: true, items: rows.map(serializeSchedule) });
          return true;
        }

        // PATCH /research/schedules/:id — change cadence or pause/resume. Creator
        // or a manager (manage_research) only. DELETE removes it entirely.
        if (scheduleIdMatch && (req.method === "PATCH" || req.method === "DELETE")) {
          const auth = await authorize(req, res, req.method === "PATCH" ? "PATCH /research/schedules/:id" : "DELETE /research/schedules/:id"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          const id = decodeURIComponent(scheduleIdMatch[1] as string);
          const sched = await prisma.researchSchedule.findFirst({ where: { id, tenantId } });
          if (!sched) { json(res, 404, { ok: false, error: "Schedule not found" }); return true; }
          if (sched.createdById !== userId && !hasPermission(permissions, "manage_research")) {
            json(res, 403, { ok: false, error: "Only the schedule's creator or a manager can change it" }); return true;
          }
          if (req.method === "DELETE") {
            await prisma.researchSchedule.delete({ where: { id } });
            json(res, 200, { ok: true });
            return true;
          }
          const body = (await parseBody(req)) as { cadence?: unknown; isActive?: unknown };
          const data: { cadence?: string; isActive?: boolean; nextRunAt?: Date } = {};
          const cadence: Cadence = isCadence(body.cadence) ? body.cadence : (isCadence(sched.cadence) ? sched.cadence : "weekly");
          if (isCadence(body.cadence)) data.cadence = body.cadence;
          if (typeof body.isActive === "boolean") data.isActive = body.isActive;
          // Reactivating, or changing the cadence, reschedules the next fire from now.
          if (data.isActive === true || (data.cadence && sched.isActive)) data.nextRunAt = advanceCadence(new Date(), cadence);
          const saved = await prisma.researchSchedule.update({ where: { id }, data });
          json(res, 200, { ok: true, schedule: serializeSchedule(saved) });
          return true;
        }

        // GET /research/runs/:id/shares — current grants + pickable users/roles +
        // the tenant-wide `shared` flag. Creator only: sharing is a management action.
        if (runSharesMatch && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/runs/:id/shares"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          const id = decodeURIComponent(runSharesMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true, shared: true } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return true; }
          if (run.createdById !== userId) { json(res, 403, { ok: false, error: "Only the run's creator can manage sharing" }); return true; }
          const [shares, users, roles] = await Promise.all([
            prisma.researchShare.findMany({ where: { runId: id, tenantId }, select: { principalType: true, principalId: true } }),
            prisma.user.findMany({ where: { tenantId, isActive: true }, select: { id: true, fullName: true, email: true }, orderBy: { fullName: "asc" } }),
            prisma.role.findMany({ where: { tenantId }, select: { key: true, displayName: true }, orderBy: { displayName: "asc" } }),
          ]);
          json(res, 200, { ok: true, shared: run.shared, shares, users: users.filter((u) => u.id !== userId), roles });
          return true;
        }

        // PUT /research/runs/:id/shares — replace the grant set + set tenant-wide
        // visibility (creator only). Body: { shared?: boolean, shares: [{ principalType, principalId }] }.
        if (runSharesMatch && req.method === "PUT") {
          const auth = await authorize(req, res, "PUT /research/runs/:id/shares"); if (!auth.ok) return true;
          const { permissions, tenantId, userId } = auth.context;
          const id = decodeURIComponent(runSharesMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return true; }
          if (run.createdById !== userId) { json(res, 403, { ok: false, error: "Only the run's creator can manage sharing" }); return true; }
          const body = (await parseBody(req)) as { shared?: unknown; shares?: Array<{ principalType?: unknown; principalId?: unknown }> };
          const incoming = Array.isArray(body.shares) ? body.shares : [];
          // Validate every principal against real tenant members/roles so a grant can
          // never reference a user outside the tenant or a non-existent role.
          const [tenantUsers, tenantRoles] = await Promise.all([
            prisma.user.findMany({ where: { tenantId }, select: { id: true } }),
            prisma.role.findMany({ where: { tenantId }, select: { key: true } }),
          ]);
          const userIds = new Set(tenantUsers.map((u) => u.id));
          const roleKeys = new Set(tenantRoles.map((r) => r.key));
          const seen = new Set<string>();
          const valid: Array<{ principalType: string; principalId: string }> = [];
          for (const s of incoming) {
            const type = s.principalType === "role" ? "role" : s.principalType === "user" ? "user" : null;
            const pid = asTrimmedString(s.principalId);
            if (!type || !pid) continue;
            // Sharing to a non-member, the owner themselves, or an unknown role is dropped.
            if (type === "user" && (!userIds.has(pid) || pid === userId)) continue;
            if (type === "role" && !roleKeys.has(pid)) continue;
            const k = `${type}:${pid}`;
            if (seen.has(k)) continue;
            seen.add(k);
            valid.push({ principalType: type, principalId: pid });
          }
          const shared = body.shared === true;
          await prisma.$transaction([
            prisma.researchRun.update({ where: { id }, data: { shared } }),
            prisma.researchShare.deleteMany({ where: { runId: id, tenantId } }),
            ...(valid.length ? [prisma.researchShare.createMany({ data: valid.map((v) => ({ tenantId, runId: id, ...v })) })] : []),
          ]);
          json(res, 200, { ok: true, shared, shares: valid });
          return true;
        }

        // GET /research/runs/:id — run detail + result (for polling + preview).
        if (runIdMatch && req.method === "GET") {
          const auth = await authorize(req, res, "GET /research/runs/:id"); if (!auth.ok) return true;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          const id = decodeURIComponent(runIdMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run || !(await canViewRun(run, id, tenantId, userId, roleKey, permissions))) { json(res, 404, { ok: false, error: "Run not found" }); return true; }
          let result: SynthResult | null = null;
          let gathered: unknown = null;
          let usage: unknown = null;
          try { if (run.resultJson) result = JSON.parse(run.resultJson) as SynthResult; } catch { result = null; }
          try { if (run.gatheredJson) gathered = JSON.parse(run.gatheredJson); } catch { gathered = null; }
          try { if (run.usageJson) usage = JSON.parse(run.usageJson); } catch { usage = null; }
          json(res, 200, {
            ok: true,
            run: {
              id: run.id, templateName: run.templateName, subjectType: run.subjectType, subjectLabel: run.subjectLabel,
              status: run.status, progress: run.progress, stage: run.stage, score: run.score, error: run.error,
              shared: run.shared, isOwner: run.createdById === userId,
              createdAt: run.createdAt, completedAt: run.completedAt, result, gathered, usage,
            },
          });
          return true;
        }
      }
    }


  return false;
}
