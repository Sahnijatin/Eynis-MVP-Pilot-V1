import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { prisma } from "./db/prisma";
import { Prisma } from "@prisma/client";
import { isValidConsentSource } from "@eynis/shared";
import { parseBearerToken, verifyAuthToken, assertJwtSecretConfigured, assertTokenExchangeConfigured } from "./core/auth";
import { handleConnectorMessagingRoutes } from "./core/connectors/messaging-routes";
import { handleAuthRoutes } from "./core/auth-routes";
import { handlePublicWebhookRoutes } from "./core/webhooks/routes";
import { handleInternalRoutes } from "./core/internal/routes";
import { eventBus } from "./events/bus";
import { startAutomationWorker } from "./core/automations/engine";
import { listInventory, applyMovement, updateItem, deleteItem, listMovements, yieldSummary, toPaise, type MovementType } from "./core/inventory/service";
import * as quotes from "./core/quotes/service";
import type { FollowupResult } from "./core/quotes/followup";
import { assertSecretsEncryptionConfigured } from "./core/crypto/secrets";
import { backfillIndustryDefaults } from "./core/quotes/provision";
import { backfillAllTenantsValueEvents } from "./core/attribution/recorder";
import { rateLimit } from "./core/rate-limit";
import { startCampaignDispatchWorker } from "./core/campaigns/dispatch";
import { startCampaignWorker } from "./core/campaigns/worker";
import { startSequenceWorker } from "./core/campaigns/sequence-runner";
import { registerSSEClient, removeSSEClient } from "./sse/clients";
import { webhookEnforcement } from "./core/connectors/webhook-verify";
import { syncSystemRolePermissions } from "./core/rbac";
import { enforceLicenseFeature } from "./core/license";
import { type Permission } from "./core/permissions";
import { sanitizeCustomCss } from "./core/css-sanitize";
import { loadReportBrand } from "./core/export/brand";
import { brandedCsv } from "./core/export/csv";
import { REPORT_SOURCES, getReportSource, runReportDefinition, validateDefinition, type ReportDefinition } from "./core/reports/reports";
import { renderBrandedReportHtml, type ReportBlock } from "./core/export/report-html";
import { renderBrandedReportPdf } from "./core/export/report-pdf";
import { listTemplates, getTemplateDetail, loadTemplateForRun } from "./core/research/store";
import { validateTemplateDef, RESEARCH_SOURCE_CATALOG, SUBJECT_TYPES, SECTION_OUTPUTS, type SubjectType } from "./core/research/types";
import { isBuiltinId } from "./core/research/templates";
import { searchProvidersAvailable } from "./core/research/sources/search";
import { resolveAiCredentials, aiConfigured, chooseProvider, providerKey } from "./core/research/ai-credentials";
import { buildReportBlocks, buildReportCsv } from "./core/research/render";
import type { SynthResult } from "./core/research/synthesize";
import { startResearchWorker } from "./core/research/worker";
import { startResearchScheduleWorker, isCadence, advanceCadence, type Cadence } from "./core/research/schedule";
import { json, sendDoc, sendBinary, parseBody, hasString, asTrimmedString, parseUrl, asSafeLimit, asSafeOffset, numOrNull, numUndef, dateOrNull, normalizePhoneE164, clientIp, PayloadTooLargeError } from "./http/helpers";
import { authorize, getAuthenticatedContext, canAccess, type RouteContext } from "./core/authz";
import { handleInventoryRoutes } from "./core/inventory/routes";
import { handleMenuRoutes } from "./core/menu/routes";
import { handleBookingRoutes } from "./core/bookings/routes";
import { handlePatientRoutes } from "./core/patients/routes";
import { handleAppointmentRoutes } from "./core/appointments/routes";
import { handleQuoteRoutes } from "./core/quotes/routes";
import { handlePublicQuoteRoutes, handlePublicQuoteImageRoutes } from "./core/quotes/public-routes";
import { handleOrderRoutes } from "./core/orders/routes";
import { handleReportRoutes } from "./core/reports/routes";
import { handleResearchRoutes } from "./core/research/routes";
import { handleMarketingRoutes } from "./core/campaigns/marketing-routes";
import { handleCrmRoutes } from "./core/crm/routes";
import { handleCrmDealRoutes } from "./core/crm/deals-routes";
import { handleCampaignRoutes } from "./core/campaigns/routes";
import { handleCampaignSubRoutes } from "./core/campaigns/subresource-routes";
import { handleAIRoutes } from "./core/ai/routes";
import { handleTeamRoutes } from "./core/team/routes";
import { handleAnalyticsRoutes } from "./core/analytics/routes";
import { handleAutomationRoutes } from "./core/automations/routes";
import { handleIntakeRoutes } from "./core/connectors/intake-routes";
import { handleConnectorConfigRoutes } from "./core/connectors/config-routes";
import { handleDashboardRoutes } from "./core/dashboard/routes";
import { handleServiceRequestRoutes } from "./core/service-requests/routes";
import { handleDirectoryRoutes } from "./core/directory/routes";
import { handleTenantMeRoutes } from "./core/tenant/routes";
import { ensureTenantAccess } from "./core/authz";
// Compat re-exports: tests (authz-matrix) and any older imports keep working.
export { permissionMap } from "./core/authz";
export type { RouteContext } from "./core/authz";

eventBus.subscribe("service_request.created", (event) => {
  // Placeholder for upcoming Day 3 worker hooks.
  void event;
});

// Date-only guard, still used by the branded-export routes below. (The reporting
// -window parser moved to core/analytics/routes.ts with the analytics routes, #164.)
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;




// Connector-config helpers + routes (registry, configs, test, PUT/DELETE) were
// extracted to core/connectors/config-routes.ts (#164).

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse
) => {
  try {
    // ── Auth / identity / registration router (#164): extracted to core/auth-routes.ts
    if (await handleAuthRoutes(req, res)) return;


    // ── Internal provisioning console router (#164, E-8): extracted to core/internal/routes.ts
    if (await handleInternalRoutes(req, res)) return;

    // ── Branded exports (E-9) ───────────────────────────────────────────────────
    // Declared early so they can't be shadowed by the broad /service-requests or
    // /night-audit/latest list handlers below. Both render the tenant brand
    // (logo/colors/support) and respect the `brandReports` flag + white-label tier.

    // GET /night-audit/export?format=html|csv — latest night-audit report.
    if (parseUrl(req.url).pathname === "/night-audit/export" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /night-audit/export");
      if (!auth.ok) return;
      const lic = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
      if (!lic.ok) { json(res, 403, { ok: false, error: lic.error }); return; }
      const { tenantId } = auth.context;
      // Export a specific date when ?date=YYYY-MM-DD is given (E-15), else latest.
      const exportDate = asTrimmedString(parseUrl(req.url).searchParams.get("date"));
      const report = exportDate && DATE_ONLY_RE.test(exportDate)
        ? await prisma.nightAuditReport.findUnique({ where: { tenantId_reportDate: { tenantId, reportDate: exportDate } } })
        : await prisma.nightAuditReport.findFirst({ where: { tenantId }, orderBy: { generatedAt: "desc" } });
      if (!report) { json(res, 404, { ok: false, error: "No night audit report found" }); return; }
      let content: {
        headline?: string; executiveSummary?: string; operationalScore?: number;
        highlights?: string[]; concerns?: string[]; tomorrowRecommendations?: string[];
      } = {};
      try { content = JSON.parse(report.contentJson); } catch { content = {}; }
      const brand = await loadReportBrand(tenantId);
      const fmtRaw = parseUrl(req.url).searchParams.get("format");
      const format = fmtRaw === "csv" ? "csv" : fmtRaw === "html" ? "html" : "pdf";
      const subtitle = `Report date: ${report.reportDate}`;

      if (format === "csv") {
        const rows: Array<Array<unknown>> = [
          ["Headline", content.headline ?? ""],
          ["Operational score", content.operationalScore ?? ""],
          ["Executive summary", content.executiveSummary ?? ""],
          ...(content.highlights ?? []).map((h, i) => [`Highlight ${i + 1}`, h]),
          ...(content.concerns ?? []).map((c, i) => [`Concern ${i + 1}`, c]),
          ...(content.tomorrowRecommendations ?? []).map((r, i) => [`Action ${i + 1}`, r])
        ];
        const csv = brandedCsv(brand, "Night Audit Report", { header: ["Field", "Value"], rows }, report.generatedAt);
        sendDoc(res, "text/csv; charset=utf-8", csv, `night-audit-${report.reportDate}.csv`);
        return;
      }

      const blocks: ReportBlock[] = [
        { kind: "headline", text: content.headline ?? "—", score: content.operationalScore },
        { kind: "section", heading: "Executive Summary", body: content.executiveSummary ?? "—" },
        { kind: "list", heading: "Highlights", items: content.highlights ?? [] },
        { kind: "list", heading: "Concerns", items: content.concerns ?? [] },
        { kind: "list", heading: "Tomorrow's Action Plan", items: content.tomorrowRecommendations ?? [] }
      ];

      if (format === "html") {
        // Print preview kept for convenience; the real download is the PDF below.
        const html = renderBrandedReportHtml(brand, { title: "Night Audit Report", subtitle, generatedAt: report.generatedAt, blocks });
        sendDoc(res, "text/html; charset=utf-8", html);
        return;
      }

      const pdf = await renderBrandedReportPdf(brand, { title: "Night Audit Report", subtitle, generatedAt: report.generatedAt, blocks });
      sendBinary(res, "application/pdf", pdf, `night-audit-${report.reportDate}.pdf`);
      return;
    }


    if (req.url === "/health" && req.method === "GET") {
      json(res, 200, {
        ok: true,
        service: "eynis-api",
        timestamp: new Date().toISOString()
      });
      return;
    }

    // ── Vapi end-of-call webhook (public; verified by x-vapi-secret) ─────────
    // ── Public webhooks + intake router (#164): vapi / events / public-requests /
    // resend / pms extracted to core/webhooks/routes.ts
    if (await handlePublicWebhookRoutes(req, res)) return;


    // ── GET /sse/live-feed — real-time event stream ───────────────────────────
    if (req.url?.startsWith("/sse/live-feed") && req.method === "GET") {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;

      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "X-Accel-Buffering": "no"
      });

      const clientId = registerSSEClient(res, auth.context.tenantId);
      res.write(`data: ${JSON.stringify({ type: "connected", clientId })}\n\n`);

      const heartbeat = setInterval(() => {
        try { res.write(`: heartbeat\n\n`); } catch { clearInterval(heartbeat); removeSSEClient(clientId); }
      }, 25000);

      req.on("close", () => { clearInterval(heartbeat); removeSSEClient(clientId); });
      return;
    }

    // ── Tenant/self settings router (#164): extracted to core/tenant/routes.ts
    if (await handleTenantMeRoutes(req, res)) return;


    // ── Connector messaging router (#164): whatsapp webhook + connector events + send
    // extracted to core/connectors/messaging-routes.ts
    if (await handleConnectorMessagingRoutes(req, res)) return;


    // ── Service-requests router (#164): extracted to core/service-requests/routes.ts
    if (await handleServiceRequestRoutes(req, res)) return;

    // ── Dashboard router (#164): extracted to core/dashboard/routes.ts ───────
    if (await handleDashboardRoutes(req, res)) return;

    // ── Analytics router (#164): extracted to core/analytics/routes.ts ───────
    if (await handleAnalyticsRoutes(req, res)) return;

    // ── Connector-config router (#164): extracted to core/connectors/config-routes.ts ─
    if (await handleConnectorConfigRoutes(req, res)) return;

    // ── Directory router (#164): users + audit + guests extracted to core/directory/routes.ts
    if (await handleDirectoryRoutes(req, res)) return;

    // ── Automations router (#164): extracted to core/automations/routes.ts ───
    if (await handleAutomationRoutes(req, res)) return;

    // ── Extracted domain routers (5.1): each returns true when it handled ─────
    if (await handleIntakeRoutes(req, res)) return;
    if (await handleReportRoutes(req, res)) return;
    if (await handleResearchRoutes(req, res)) return;

    if (await handlePublicQuoteRoutes(req, res)) return;
    if (await handlePublicQuoteImageRoutes(req, res)) return;
    if (await handleInventoryRoutes(req, res)) return;
    if (await handleMenuRoutes(req, res)) return;
    if (await handleBookingRoutes(req, res)) return;
    if (await handlePatientRoutes(req, res)) return;
    if (await handleAppointmentRoutes(req, res)) return;
    if (await handleQuoteRoutes(req, res)) return;
    if (await handleOrderRoutes(req, res)) return;

    // ── AI + Night Audit routers (#164): extracted to core/ai/routes.ts ──────
    if (await handleAIRoutes(req, res)) return;


    // ── Team router (#164): extracted to core/team/routes.ts ─────────────────
    if (await handleTeamRoutes(req, res)) return;

    if (await handleMarketingRoutes(req, res)) return;
    if (await handleCrmDealRoutes(req, res)) return;
    if (await handleCrmRoutes(req, res)) return;
    if (await handleCampaignRoutes(req, res)) return;
    if (await handleCampaignSubRoutes(req, res)) return;

    json(res, 404, { ok: false, error: "Not found" });
  } catch (_error) {
    if (_error instanceof PayloadTooLargeError) {
      json(res, 413, { ok: false, error: "Request body too large" });
      return;
    }
    json(res, 500, { ok: false, error: "Internal server error" });
  }
};

export const buildServer = () =>
  createServer((req, res) => {
    void handleRequest(req, res);
  });

export const startServer = (port = Number(process.env.PORT ?? 4000)) => {
  assertJwtSecretConfigured(); // refuse to boot prod with the default/blank JWT secret (F-22)
  assertSecretsEncryptionConfigured(); // refuse to boot prod that would store connector secrets in plaintext (H6)
  assertTokenExchangeConfigured(); // refuse to boot prod with a publicly mintable /auth/token (C1)
  // Not fatal (inbound WhatsApp may legitimately be unused), but loud: a prod
  // deploy accepting unsigned provider webhooks should be a conscious choice.
  if (process.env.NODE_ENV === "production" && !webhookEnforcement().any) {
    console.warn(
      "[Startup] WhatsApp webhook signature verification is OFF — configure INTERAKT_WEBHOOK_SECRET " +
      "or TWILIO_AUTH_TOKEN + TWILIO_WEBHOOK_URL/EYNIS_PUBLIC_URL (or set VERIFY_WEBHOOKS=true) to enforce it",
    );
  }
  const server = buildServer();
  server.listen(port, () => {
    console.log("Eynis API listening on port " + port);
    // Back-fill any tenant whose system roles predate newer permissions (e.g. CRM).
    void syncSystemRolePermissions()
      .then(() => console.log("Eynis system-role permissions synced"))
      .catch((err) => console.error("system-role permission sync failed", err));
    // Back-fill industry quote templates for tenants created before auto-provisioning
    // existed (their "Start from template" dropdown would otherwise be empty).
    void backfillIndustryDefaults()
      .then((n) => { if (n) console.log(`Eynis provisioned quote templates for ${n} existing tenant(s)`); })
      .catch((err) => console.error("industry defaults backfill failed", err));
    // Back-fill attribution value events from already-resolved requests / accepted
    // offers, so the attribution number reflects historical data (#167). Idempotent.
    void backfillAllTenantsValueEvents()
      .then(() => console.log("Eynis attribution value events backfilled"))
      .catch((err) => console.error("attribution backfill failed", err));
    startAutomationWorker(60_000);
    console.log("Eynis AutomationEngine started — 60s cycle");
    startCampaignDispatchWorker();
    startCampaignWorker();
    startSequenceWorker();
    startResearchWorker();
    startResearchScheduleWorker();
    console.log("Eynis ResearchWorker started");
  });
  return server;
};

if (process.env.START_SERVER === "true") {
  const port = Number(process.env.PORT ?? 4000);
  startServer(port);
}
