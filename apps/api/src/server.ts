import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { prisma } from "./db/prisma";
import { Prisma } from "@prisma/client";
import { isValidConsentSource } from "@eynis/shared";
import { parseBearerToken, verifyAuthToken, assertJwtSecretConfigured, assertTokenExchangeConfigured } from "./core/auth";
import { handleConnectorMessagingRoutes } from "./core/connectors/messaging-routes";
import { handleAuthRoutes } from "./core/auth-routes";
import { handlePublicWebhookRoutes } from "./core/webhooks/routes";
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
import { enforceLicenseFeature, planOptions, isValidPlan, VALID_PLANS, DEFAULT_SEATS_FOR_PLAN, type PlanKey } from "./core/license";
import { type Permission } from "./core/permissions";
import { verifyPlatformAdmin, isPlatformAdminConfigured } from "./core/platform-admin";
import { isValidIndustry, industryOptions, VALID_INDUSTRIES } from "./core/industries";
import { isValidTier, tierOptions, WHITELABEL_TIERS } from "./core/whitelabel";
import { sanitizeCustomCss } from "./core/css-sanitize";
import { loadReportBrand } from "./core/export/brand";
import { brandedCsv } from "./core/export/csv";
import { REPORT_SOURCES, getReportSource, runReportDefinition, validateDefinition, type ReportDefinition } from "./core/reports/reports";
import { renderBrandedReportHtml, type ReportBlock } from "./core/export/report-html";
import { renderBrandedReportPdf } from "./core/export/report-pdf";
import { provisionSendingDomain, refreshSendingDomain, isValidSendingDomain, isValidLocalPart } from "./core/email/domains";
import { listTemplates, getTemplateDetail, loadTemplateForRun } from "./core/research/store";
import { validateTemplateDef, RESEARCH_SOURCE_CATALOG, SUBJECT_TYPES, SECTION_OUTPUTS, type SubjectType } from "./core/research/types";
import { isBuiltinId } from "./core/research/templates";
import { searchProvidersAvailable } from "./core/research/sources/search";
import { resolveAiCredentials, aiConfigured, chooseProvider, providerKey } from "./core/research/ai-credentials";
import { buildReportBlocks, buildReportCsv } from "./core/research/render";
import type { SynthResult } from "./core/research/synthesize";
import { startResearchWorker } from "./core/research/worker";
import { startResearchScheduleWorker, isCadence, advanceCadence, type Cadence } from "./core/research/schedule";
import { json, sendDoc, sendBinary, parseBody, hasString, asTrimmedString, asPositiveInt, parseUrl, asSafeLimit, asSafeOffset, numOrNull, numUndef, dateOrNull, normalizePhoneE164, clientIp, PayloadTooLargeError } from "./http/helpers";
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
import { handleCampaignRoutes } from "./core/campaigns/routes";
import { handleAIRoutes } from "./core/ai/routes";
import { handleTeamRoutes } from "./core/team/routes";
import { handleAnalyticsRoutes } from "./core/analytics/routes";
import { computeScoreboard } from "./core/analytics/scoreboard";
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



// Gate for the internal provisioning console (E-8). This is the platform-staff
// boundary — completely separate from tenant RBAC above. Writes its own response
// and returns false when the caller is not an authenticated staff member.
const requirePlatformAdmin = (req: IncomingMessage, res: ServerResponse): boolean => {
  if (!isPlatformAdminConfigured()) {
    json(res, 503, { ok: false, error: "Provisioning console is not configured (PLATFORM_ADMIN_SECRET unset)" });
    return false;
  }
  if (!verifyPlatformAdmin(req)) {
    json(res, 401, { ok: false, error: "Invalid platform admin credentials" });
    return false;
  }
  return true;
};

// Connector-config helpers + routes (registry, configs, test, PUT/DELETE) were
// extracted to core/connectors/config-routes.ts (#164).

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse
) => {
  try {
    // ── Auth / identity / registration router (#164): extracted to core/auth-routes.ts
    if (await handleAuthRoutes(req, res)) return;


    // ── Internal provisioning console (E-8) ─────────────────────────────────────
    // Eynis-staff-only, cross-tenant surface that sets a tenant's industry (and,
    // per E-9/E-10, white-label tier + custom domain on the same console). Gated by
    // `requirePlatformAdmin` — the platform-staff secret, NOT tenant RBAC — so a
    // customer admin can never reach it. Every mutation is audit-logged.
    {
      const internalPath = parseUrl(req.url).pathname;

      // GET /internal/tenants — list every tenant for the console picker. Optional
      // ?search= matches name / id / slug (case-insensitive).
      if (internalPath === "/internal/tenants" && req.method === "GET") {
        if (!requirePlatformAdmin(req, res)) return;
        const search = asTrimmedString(parseUrl(req.url).searchParams.get("search"));
        const tenants = await prisma.tenant.findMany({
          where: search
            ? {
                OR: [
                  { name: { contains: search, mode: "insensitive" } },
                  { id: { contains: search, mode: "insensitive" } },
                  { slug: { contains: search, mode: "insensitive" } }
                ]
              }
            : undefined,
          select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true, license: { select: { plan: true } } },
          orderBy: { createdAt: "desc" },
          take: 200
        });
        const items = tenants.map(({ license, ...rest }) => ({ ...rest, plan: license?.plan ?? "starter" }));
        json(res, 200, { ok: true, items, industries: industryOptions(), tiers: tierOptions(), plans: planOptions() });
        return;
      }

      // GET /internal/scoreboard — the experiment scoreboard (#163). Cross-tenant,
      // per-vertical rollup of the five lock-decision metrics (activation, weekly
      // active operators, attributed value, willingness-to-pay, sales-cycle length)
      // so "lock 1 primary vertical + shadow 1" becomes a data call. Staff-only.
      if (internalPath === "/internal/scoreboard" && req.method === "GET") {
        if (!requirePlatformAdmin(req, res)) return;
        json(res, 200, await computeScoreboard());
        return;
      }

      // PATCH /internal/tenants/:id/industry — set a tenant's industry.
      const industryMatch = /^\/internal\/tenants\/([^/]+)\/industry$/.exec(internalPath);
      if (industryMatch && req.method === "PATCH") {
        if (!requirePlatformAdmin(req, res)) return;
        const tenantId = decodeURIComponent(industryMatch[1] as string);
        const body = (await parseBody(req)) as { industry?: unknown; actor?: unknown };
        const industry = asTrimmedString(body.industry);
        if (!industry || !isValidIndustry(industry)) {
          json(res, 400, { ok: false, error: `industry must be one of: ${VALID_INDUSTRIES.join(", ")}` });
          return;
        }
        const existing = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, industry: true }
        });
        if (!existing) {
          json(res, 404, { ok: false, error: "Tenant not found" });
          return;
        }
        const tenant = await prisma.tenant.update({
          where: { id: tenantId },
          data: { industry },
          select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
        });
        // Audit on the affected tenant. `actor` is a free-text label the console can
        // pass to attribute the change to a specific staff member.
        await prisma.auditLog.create({
          data: {
            tenantId,
            actorRole: "platform_staff",
            action: "tenant.industry_changed",
            entityType: "tenant",
            entityId: tenantId,
            metadata: JSON.stringify({
              from: existing.industry,
              to: industry,
              actor: asTrimmedString(body.actor) ?? "platform_console"
            })
          }
        });
        json(res, 200, { ok: true, tenant });
        return;
      }

      // PATCH /internal/tenants/:id/whitelabel-tier — set a tenant's white-label tier (E-9).
      const tierMatch = /^\/internal\/tenants\/([^/]+)\/whitelabel-tier$/.exec(internalPath);
      if (tierMatch && req.method === "PATCH") {
        if (!requirePlatformAdmin(req, res)) return;
        const tenantId = decodeURIComponent(tierMatch[1] as string);
        const body = (await parseBody(req)) as { tier?: unknown; actor?: unknown };
        const tier = asTrimmedString(body.tier);
        if (!tier || !isValidTier(tier)) {
          json(res, 400, { ok: false, error: `tier must be one of: ${WHITELABEL_TIERS.join(", ")}` });
          return;
        }
        const existing = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, whitelabelTier: true }
        });
        if (!existing) {
          json(res, 404, { ok: false, error: "Tenant not found" });
          return;
        }
        const tenant = await prisma.tenant.update({
          where: { id: tenantId },
          data: { whitelabelTier: tier },
          select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
        });
        await prisma.auditLog.create({
          data: {
            tenantId,
            actorRole: "platform_staff",
            action: "tenant.whitelabel_tier_changed",
            entityType: "tenant",
            entityId: tenantId,
            metadata: JSON.stringify({
              from: existing.whitelabelTier,
              to: tier,
              actor: asTrimmedString(body.actor) ?? "platform_console"
            })
          }
        });
        json(res, 200, { ok: true, tenant });
        return;
      }

      // PATCH /internal/tenants/:id/plan — set a tenant's billing plan (which gates
      // features like Research Studio / advanced analytics). Staff-provisioned with
      // NO payment step, so a demo / per-deal instance can be moved to Growth or
      // Enterprise without a Razorpay flow. Upserts the license + audit-logs.
      const planMatch = /^\/internal\/tenants\/([^/]+)\/plan$/.exec(internalPath);
      if (planMatch && req.method === "PATCH") {
        if (!requirePlatformAdmin(req, res)) return;
        const tenantId = decodeURIComponent(planMatch[1] as string);
        const body = (await parseBody(req)) as { plan?: unknown; maxSeats?: unknown; actor?: unknown };
        const plan = asTrimmedString(body.plan);
        if (!plan || !isValidPlan(plan)) {
          json(res, 400, { ok: false, error: `plan must be one of: ${VALID_PLANS.join(", ")}` });
          return;
        }
        const existingTenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
        if (!existingTenant) {
          json(res, 404, { ok: false, error: "Tenant not found" });
          return;
        }
        const existingLicense = await prisma.license.findUnique({ where: { tenantId }, select: { plan: true, maxSeats: true } });
        const fromPlan = existingLicense?.plan ?? "starter";
        // Use an explicit seat count if given; otherwise keep the larger of the
        // current count and the new plan's default (never silently shrink seats).
        const requestedSeats = asPositiveInt(body.maxSeats);
        const maxSeats = requestedSeats ?? Math.max(existingLicense?.maxSeats ?? 0, DEFAULT_SEATS_FOR_PLAN[plan as PlanKey]);
        await prisma.license.upsert({
          where: { tenantId },
          update: { plan, maxSeats },
          create: { tenantId, plan, maxSeats, renewsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000) }
        });
        await prisma.auditLog.create({
          data: {
            tenantId,
            actorRole: "platform_staff",
            action: "tenant.plan_changed",
            entityType: "tenant",
            entityId: tenantId,
            metadata: JSON.stringify({ from: fromPlan, to: plan, maxSeats, actor: asTrimmedString(body.actor) ?? "platform_console" })
          }
        });
        const tenant = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
        });
        json(res, 200, { ok: true, tenant: { ...tenant, plan } });
        return;
      }

      // PATCH /internal/tenants/:id/domains — set a tenant's routing identity
      // (subdomain slug + custom domain). Provider-managed per E-10: customers
      // self-serve their *.eynis.com subdomain, but the custom CNAME domain is set
      // here by staff, who also own the DNS/SSL provisioning for it.
      const domainsMatch = /^\/internal\/tenants\/([^/]+)\/domains$/.exec(internalPath);
      if (domainsMatch && req.method === "PATCH") {
        if (!requirePlatformAdmin(req, res)) return;
        const tenantId = decodeURIComponent(domainsMatch[1] as string);
        const existing = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { id: true, slug: true, customDomain: true }
        });
        if (!existing) {
          json(res, 404, { ok: false, error: "Tenant not found" });
          return;
        }
        const body = (await parseBody(req)) as { slug?: unknown; customDomain?: unknown; actor?: unknown };
        const data: { slug?: string | null; customDomain?: string | null } = {};
        if ("slug" in body) {
          const s = asTrimmedString(body.slug)?.toLowerCase() ?? null;
          if (s !== null && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(s)) {
            json(res, 400, { ok: false, error: "slug must be 2–32 chars: lowercase letters, numbers, hyphens" });
            return;
          }
          data.slug = s;
        }
        if ("customDomain" in body) {
          const d = asTrimmedString(body.customDomain)?.toLowerCase() ?? null;
          const platform = (process.env.PLATFORM_APP_DOMAIN ?? "eynis.com").toLowerCase();
          if (d !== null && (!/^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/.test(d) || d.endsWith(`.${platform}`) || d === platform)) {
            json(res, 400, { ok: false, error: "customDomain must be a valid hostname on the tenant's own domain (not an eynis.com host)" });
            return;
          }
          data.customDomain = d;
        }
        if (Object.keys(data).length === 0) {
          json(res, 400, { ok: false, error: "Provide slug and/or customDomain" });
          return;
        }
        try {
          const tenant = await prisma.tenant.update({
            where: { id: tenantId },
            data,
            select: { id: true, name: true, industry: true, whitelabelTier: true, slug: true, customDomain: true, createdAt: true }
          });
          await prisma.auditLog.create({
            data: {
              tenantId,
              actorRole: "platform_staff",
              action: "tenant.domains_changed",
              entityType: "tenant",
              entityId: tenantId,
              metadata: JSON.stringify({
                from: { slug: existing.slug, customDomain: existing.customDomain },
                to: { slug: tenant.slug, customDomain: tenant.customDomain },
                actor: asTrimmedString(body.actor) ?? "platform_console"
              })
            }
          });
          json(res, 200, { ok: true, tenant });
        } catch (e) {
          if ((e as { code?: string }).code === "P2002") {
            json(res, 409, { ok: false, error: "That slug or domain is already in use" });
            return;
          }
          throw e;
        }
        return;
      }

      // ── Sending domain (E-9, white-label Model B) ────────────────────────────
      // GET /internal/tenants/:id/sending-domain — read current config.
      const sdGet = /^\/internal\/tenants\/([^/]+)\/sending-domain$/.exec(internalPath);
      if (sdGet && req.method === "GET") {
        if (!requirePlatformAdmin(req, res)) return;
        const tenantId = decodeURIComponent(sdGet[1] as string);
        const sd = await prisma.sendingDomain.findUnique({ where: { tenantId } });
        json(res, 200, { ok: true, sendingDomain: sd ? { ...sd, dnsRecords: sd.dnsRecords ? JSON.parse(sd.dnsRecords) : [] } : null });
        return;
      }

      // PUT /internal/tenants/:id/sending-domain — set/replace the domain. Registers
      // it with the provider (Resend) when a key is present, stores the DNS records
      // the tenant must publish, and resets status to the provider's answer.
      const sdPut = /^\/internal\/tenants\/([^/]+)\/sending-domain$/.exec(internalPath);
      if (sdPut && req.method === "PUT") {
        if (!requirePlatformAdmin(req, res)) return;
        const tenantId = decodeURIComponent(sdPut[1] as string);
        if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return; }
        const body = (await parseBody(req)) as { domain?: unknown; fromLocalPart?: unknown; fromName?: unknown; actor?: unknown };
        const domain = asTrimmedString(body.domain)?.toLowerCase() ?? null;
        if (!domain || !isValidSendingDomain(domain)) {
          json(res, 400, { ok: false, error: "domain must be a valid hostname, e.g. mail.acme.com" });
          return;
        }
        const localPartInput = asTrimmedString(body.fromLocalPart) ?? "notifications";
        if (!isValidLocalPart(localPartInput)) {
          json(res, 400, { ok: false, error: "fromLocalPart must be a valid email local part, e.g. campaigns" });
          return;
        }
        const fromName = asTrimmedString(body.fromName);
        // If the domain is unchanged and already registered with the provider, don't
        // re-create it (the provider errors on a duplicate, which would wrongly flip
        // the status to "failed") — just re-check its status. Only (re)provision when
        // the domain is new or changed; editing the from-identity alone is fine.
        const existingSd = await prisma.sendingDomain.findUnique({ where: { tenantId } });
        const reuse = existingSd && existingSd.domain === domain && !!existingSd.resendDomainId;
        let resendDomainId: string | null;
        let status: string;
        let dnsRecords: unknown[];
        let live: boolean;
        if (reuse) {
          const refreshed = await refreshSendingDomain(existingSd!.resendDomainId, domain);
          resendDomainId = existingSd!.resendDomainId;
          status = refreshed.status;
          dnsRecords = refreshed.dnsRecords ?? (existingSd!.dnsRecords ? JSON.parse(existingSd!.dnsRecords) : []);
          live = refreshed.live;
        } else {
          const provision = await provisionSendingDomain(domain);
          resendDomainId = provision.resendDomainId;
          status = provision.status;
          dnsRecords = provision.dnsRecords;
          live = provision.live;
        }
        const data = { domain, fromLocalPart: localPartInput, fromName, resendDomainId, status, dnsRecords: JSON.stringify(dnsRecords), lastCheckedAt: new Date() };
        const sd = await prisma.sendingDomain.upsert({ where: { tenantId }, create: { tenantId, ...data }, update: data });
        await prisma.auditLog.create({
          data: {
            tenantId, actorRole: "platform_staff", action: "tenant.sending_domain_set",
            entityType: "sending_domain", entityId: sd.id,
            metadata: JSON.stringify({ domain, status, live, actor: asTrimmedString(body.actor) ?? "platform_console" })
          }
        });
        json(res, 200, { ok: true, sendingDomain: { ...sd, dnsRecords }, live });
        return;
      }

      // POST /internal/tenants/:id/sending-domain/verify — re-check verification.
      const sdVerify = /^\/internal\/tenants\/([^/]+)\/sending-domain\/verify$/.exec(internalPath);
      if (sdVerify && req.method === "POST") {
        if (!requirePlatformAdmin(req, res)) return;
        const tenantId = decodeURIComponent(sdVerify[1] as string);
        const existing = await prisma.sendingDomain.findUnique({ where: { tenantId } });
        if (!existing) { json(res, 404, { ok: false, error: "No sending domain configured" }); return; }
        const result = await refreshSendingDomain(existing.resendDomainId, existing.domain);
        const sd = await prisma.sendingDomain.update({
          where: { tenantId },
          data: {
            status: result.status,
            lastCheckedAt: new Date(),
            ...(result.dnsRecords ? { dnsRecords: JSON.stringify(result.dnsRecords) } : {})
          }
        });
        await prisma.auditLog.create({
          data: {
            tenantId, actorRole: "platform_staff", action: "tenant.sending_domain_verified",
            entityType: "sending_domain", entityId: sd.id,
            metadata: JSON.stringify({ domain: sd.domain, status: result.status, live: result.live })
          }
        });
        json(res, 200, { ok: true, sendingDomain: { ...sd, dnsRecords: sd.dnsRecords ? JSON.parse(sd.dnsRecords) : [] }, live: result.live });
        return;
      }
    }

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
    if (await handleCrmRoutes(req, res)) return;
    if (await handleCampaignRoutes(req, res)) return;

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
