// Reports domain router (5.1) — extracted verbatim from server.ts. Returns true
// when the request was handled (response written); false lets the main dispatcher
// continue. Authorization goes through the shared authorize()/permissionMap contract.
import type { IncomingMessage, ServerResponse } from "node:http";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { hasPermission } from "../rbac";
import { json, parseBody, asTrimmedString, parseUrl, sendDoc, sendBinary } from "../../http/helpers";
import { REPORT_SOURCES, getReportSource, runReportDefinition, validateDefinition, type ReportDefinition } from "./reports";
import { loadReportBrand } from "../export/brand";
import { brandedCsv } from "../export/csv";
import { renderBrandedReportHtml, type ReportBlock } from "../export/report-html";
import { renderBrandedReportPdf } from "../export/report-pdf";

export async function handleReportRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/reports" || routePath.startsWith("/reports/"))) return false;

    // ── Reports: custom report builder (E-16) ────────────────────────────────
    // Module gated by view_reports; every run/save ALSO checks the user holds the
    // chosen source's own permission (per-source RBAC) so a report can't surface
    // data the user otherwise can't see. All queries are tenant-scoped.
    {
      const rpath = parseUrl(req.url).pathname;
      const parseDef = (s: string): ReportDefinition | null => {
        try { const d = JSON.parse(s) as ReportDefinition; return d && typeof d === "object" ? d : null; } catch { return null; }
      };

      // The share principals that apply to a viewer: themselves, plus their role
      // (a role grant covers everyone holding that role). Used by both the list
      // filter and the single-report visibility check (E-16 Phase B ACL).
      const sharePrincipals = (userId: string, roleKey: string | null): Array<{ principalType: string; principalId: string }> => {
        const p: Array<{ principalType: string; principalId: string }> = [{ principalType: "user", principalId: userId }];
        if (roleKey) p.push({ principalType: "role", principalId: roleKey });
        return p;
      };

      // A user can view (open/run/export) a report if they own it, it's shared
      // tenant-wide, or an explicit grant names them or their role. Editing and
      // deleting stay creator-only regardless of grants.
      const canViewReport = async (
        report: { shared: boolean; createdById: string | null },
        reportId: string, tenantId: string, userId: string, roleKey: string | null,
      ): Promise<boolean> => {
        if (report.createdById === userId || report.shared) return true;
        const grant = await prisma.reportShare.findFirst({
          where: { reportId, tenantId, OR: sharePrincipals(userId, roleKey) },
          select: { id: true },
        });
        return grant !== null;
      };

      if (rpath === "/reports/sources" && req.method === "GET") {
        const auth = await authorize(req, res, "GET /reports/sources"); if (!auth.ok) return true;
        json(res, 200, { ok: true, sources: REPORT_SOURCES });
        return true;
      }

      // POST /reports/run — execute an ad-hoc definition (builder live preview).
      if (rpath === "/reports/run" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /reports/run"); if (!auth.ok) return true;
        const { permissions, tenantId } = auth.context;
        const body = (await parseBody(req)) as { definition?: ReportDefinition };
        const def = body.definition;
        if (!def || typeof def !== "object") { json(res, 400, { ok: false, error: "definition is required" }); return true; }
        const source = getReportSource(def.source);
        if (!source) { json(res, 400, { ok: false, error: "Unknown data source" }); return true; }
        if (!hasPermission(permissions, source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${source.label}` }); return true; }
        const result = await runReportDefinition(tenantId, def);
        json(res, result.ok ? 200 : 400, result);
        return true;
      }

      // GET /reports — list saved reports the user can see (own + shared).
      if (rpath === "/reports" && req.method === "GET") {
        const auth = await authorize(req, res, "GET /reports"); if (!auth.ok) return true;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        const rows = await prisma.report.findMany({
          where: {
            tenantId,
            OR: [
              { shared: true },
              { createdById: userId },
              { shares: { some: { OR: sharePrincipals(userId, roleKey) } } },
            ],
          },
          orderBy: { updatedAt: "desc" },
          select: { id: true, name: true, description: true, source: true, shared: true, createdById: true, createdAt: true, updatedAt: true },
        });
        json(res, 200, { ok: true, items: rows.map((r) => ({ ...r, isOwner: r.createdById === userId })) });
        return true;
      }

      // POST /reports — save a new report.
      if (rpath === "/reports" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /reports"); if (!auth.ok) return true;
        const { permissions, tenantId, userId } = auth.context;
        const body = (await parseBody(req)) as { name?: unknown; description?: unknown; shared?: unknown; definition?: ReportDefinition };
        const name = asTrimmedString(body.name);
        if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
        const def = body.definition;
        if (!def || typeof def !== "object") { json(res, 400, { ok: false, error: "definition is required" }); return true; }
        const valid = validateDefinition(def);
        if (!valid.ok) { json(res, 400, valid); return true; }
        if (!hasPermission(permissions, valid.source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${valid.source.label}` }); return true; }
        const created = await prisma.report.create({
          data: {
            tenantId, name, description: asTrimmedString(body.description),
            source: valid.source.key, definitionJson: JSON.stringify(def),
            shared: body.shared === true, createdById: userId,
          },
          select: { id: true },
        });
        json(res, 201, { ok: true, id: created.id });
        return true;
      }

      const runMatch = /^\/reports\/([^/]+)\/run$/.exec(rpath);
      const exportMatch = /^\/reports\/([^/]+)\/export$/.exec(rpath);
      const sharesMatch = /^\/reports\/([^/]+)\/shares$/.exec(rpath);
      const idMatch = /^\/reports\/([^/]+)$/.exec(rpath);

      // GET /reports/:id/run — run a saved report.
      if (runMatch && req.method === "GET") {
        const auth = await authorize(req, res, "GET /reports/:id/run"); if (!auth.ok) return true;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        const id = decodeURIComponent(runMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId } });
        if (!report || !(await canViewReport(report, id, tenantId, userId, roleKey))) { json(res, 404, { ok: false, error: "Report not found" }); return true; }
        const def = parseDef(report.definitionJson);
        const source = def && getReportSource(def.source);
        if (!def || !source) { json(res, 400, { ok: false, error: "Invalid report definition" }); return true; }
        if (!hasPermission(permissions, source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${source.label}` }); return true; }
        const result = await runReportDefinition(tenantId, def);
        if (!result.ok) { json(res, 400, result); return true; }
        json(res, 200, { ...result, name: report.name });
        return true;
      }

      // GET /reports/:id/export?format=csv — branded CSV of a saved report.
      if (exportMatch && req.method === "GET") {
        const auth = await authorize(req, res, "GET /reports/:id/export"); if (!auth.ok) return true;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        const id = decodeURIComponent(exportMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId } });
        if (!report || !(await canViewReport(report, id, tenantId, userId, roleKey))) { json(res, 404, { ok: false, error: "Report not found" }); return true; }
        const def = parseDef(report.definitionJson);
        const source = def && getReportSource(def.source);
        if (!def || !source) { json(res, 400, { ok: false, error: "Invalid report definition" }); return true; }
        if (!hasPermission(permissions, source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${source.label}` }); return true; }
        const result = await runReportDefinition(tenantId, def);
        if (!result.ok) { json(res, 400, result); return true; }
        const brand = await loadReportBrand(tenantId);
        const labelOf = (key: string) => source.columns.find((c) => c.key === key)?.label ?? key;
        let header: string[];
        let rows: Array<Array<unknown>>;
        if (result.grouped) {
          header = [labelOf(def.groupBy as string), "Count", ...(source.metric ? [source.metric.label] : [])];
          rows = result.grouped.map((g) => [g.group, g.count, ...(source.metric ? [g.sum ?? 0] : [])]);
        } else {
          header = result.columns.map((c) => c.label);
          rows = result.rows.map((row) => result.columns.map((c) => row[c.key] ?? ""));
        }
        const safeName = report.name.replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "") || "report";
        const fmtRaw = parseUrl(req.url).searchParams.get("format");
        const format = fmtRaw === "pdf" ? "pdf" : fmtRaw === "html" ? "html" : "csv";

        if (format === "csv") {
          sendDoc(res, "text/csv; charset=utf-8", brandedCsv(brand, report.name, { header, rows }), `${safeName}.csv`);
          return true;
        }
        // html / pdf render the result as a single branded table block (E-16 Phase B).
        const tableRows: Array<Array<string | number>> = rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : typeof c === "number" ? c : String(c))));
        const blocks: ReportBlock[] = [{ kind: "table", header, rows: tableRows }];
        const subtitle = report.description ?? undefined;
        if (format === "html") {
          sendDoc(res, "text/html; charset=utf-8", renderBrandedReportHtml(brand, { title: report.name, subtitle, blocks }));
          return true;
        }
        const pdf = await renderBrandedReportPdf(brand, { title: report.name, subtitle, blocks });
        sendBinary(res, "application/pdf", pdf, `${safeName}.pdf`);
        return true;
      }

      // GET /reports/:id — fetch a saved report's definition.
      if (idMatch && req.method === "GET") {
        const auth = await authorize(req, res, "GET /reports/:id"); if (!auth.ok) return true;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        const id = decodeURIComponent(idMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId } });
        if (!report || !(await canViewReport(report, id, tenantId, userId, roleKey))) { json(res, 404, { ok: false, error: "Report not found" }); return true; }
        json(res, 200, {
          ok: true,
          report: {
            id: report.id, name: report.name, description: report.description, source: report.source,
            shared: report.shared, isOwner: report.createdById === userId, definition: parseDef(report.definitionJson),
          },
        });
        return true;
      }

      // GET /reports/:id/shares — current grants + pickable users/roles. Creator
      // only: sharing is a management action, not something a viewer can inspect.
      if (sharesMatch && req.method === "GET") {
        const auth = await authorize(req, res, "GET /reports/:id/shares"); if (!auth.ok) return true;
        const { permissions, tenantId, userId } = auth.context;
        const id = decodeURIComponent(sharesMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!report) { json(res, 404, { ok: false, error: "Report not found" }); return true; }
        if (report.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can manage sharing" }); return true; }
        const [shares, users, roles] = await Promise.all([
          prisma.reportShare.findMany({ where: { reportId: id, tenantId }, select: { principalType: true, principalId: true } }),
          prisma.user.findMany({ where: { tenantId, isActive: true }, select: { id: true, fullName: true, email: true }, orderBy: { fullName: "asc" } }),
          prisma.role.findMany({ where: { tenantId }, select: { key: true, displayName: true }, orderBy: { displayName: "asc" } }),
        ]);
        // The owner already has access — no point offering to share with themselves.
        json(res, 200, { ok: true, shares, users: users.filter((u) => u.id !== userId), roles });
        return true;
      }

      // PUT /reports/:id/shares — replace the full grant set (creator only).
      // Body: { shares: [{ principalType: "user"|"role", principalId }] }.
      if (sharesMatch && req.method === "PUT") {
        const auth = await authorize(req, res, "PUT /reports/:id/shares"); if (!auth.ok) return true;
        const { permissions, tenantId, userId } = auth.context;
        const id = decodeURIComponent(sharesMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!report) { json(res, 404, { ok: false, error: "Report not found" }); return true; }
        if (report.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can manage sharing" }); return true; }
        const body = (await parseBody(req)) as { shares?: Array<{ principalType?: unknown; principalId?: unknown }> };
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
        await prisma.$transaction([
          prisma.reportShare.deleteMany({ where: { reportId: id, tenantId } }),
          ...(valid.length ? [prisma.reportShare.createMany({ data: valid.map((v) => ({ tenantId, reportId: id, ...v })) })] : []),
        ]);
        json(res, 200, { ok: true, shares: valid });
        return true;
      }

      // PUT /reports/:id — update (creator only).
      if (idMatch && req.method === "PUT") {
        const auth = await authorize(req, res, "PUT /reports/:id"); if (!auth.ok) return true;
        const { permissions, tenantId, userId } = auth.context;
        const id = decodeURIComponent(idMatch[1] as string);
        const existing = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!existing) { json(res, 404, { ok: false, error: "Report not found" }); return true; }
        if (existing.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can edit it" }); return true; }
        const body = (await parseBody(req)) as { name?: unknown; description?: unknown; shared?: unknown; definition?: ReportDefinition };
        const data: Record<string, unknown> = {};
        const name = asTrimmedString(body.name);
        if (name) data.name = name;
        if ("description" in body) data.description = asTrimmedString(body.description);
        if (typeof body.shared === "boolean") data.shared = body.shared;
        if (body.definition && typeof body.definition === "object") {
          const valid = validateDefinition(body.definition);
          if (!valid.ok) { json(res, 400, valid); return true; }
          if (!hasPermission(permissions, valid.source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${valid.source.label}` }); return true; }
          data.source = valid.source.key;
          data.definitionJson = JSON.stringify(body.definition);
        }
        await prisma.report.update({ where: { id }, data });
        json(res, 200, { ok: true });
        return true;
      }

      // DELETE /reports/:id — delete (creator only).
      if (idMatch && req.method === "DELETE") {
        const auth = await authorize(req, res, "DELETE /reports/:id"); if (!auth.ok) return true;
        const { permissions, tenantId, userId } = auth.context;
        const id = decodeURIComponent(idMatch[1] as string);
        const existing = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!existing) { json(res, 404, { ok: false, error: "Report not found" }); return true; }
        if (existing.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can delete it" }); return true; }
        await prisma.report.delete({ where: { id } });
        json(res, 200, { ok: true });
        return true;
      }
    }


  return false;
}
