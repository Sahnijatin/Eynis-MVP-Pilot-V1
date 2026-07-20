import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { InMemoryEventBus } from "./events/event-bus";
import { prisma } from "./db/prisma";
import { Prisma } from "@prisma/client";
import type { UserRole, SystemRoleKey } from "@eynis/shared";
import { isValidConsentSource } from "@eynis/shared";
import { createAuthToken, parseBearerToken, verifyAuthToken, assertJwtSecretConfigured, assertTokenExchangeConfigured, verifyTokenExchangeSecret } from "./core/auth";
import { normalizeWhatsappInbound } from "./core/connectors/whatsapp";
import { ingestConnectorEvent } from "./core/connectors/ingest";
import { startAutomationWorker } from "./core/automations/engine";
import { listInventory, applyMovement, updateItem, deleteItem, listMovements, yieldSummary, toPaise, type MovementType } from "./core/inventory/service";
import * as quotes from "./core/quotes/service";
import type { FollowupResult } from "./core/quotes/followup";
import { assertSecretsEncryptionConfigured } from "./core/crypto/secrets";
import { seedIndustryDefaults, backfillIndustryDefaults } from "./core/quotes/provision";
import { seedAutomationRulesForTenant } from "./core/automations/provision";
import { backfillAllTenantsValueEvents } from "./core/attribution/recorder";
import { rateLimit } from "./core/rate-limit";
import { startCampaignDispatchWorker } from "./core/campaigns/dispatch";
import { startCampaignWorker } from "./core/campaigns/worker";
import { startSequenceWorker } from "./core/campaigns/sequence-runner";
import { registerSSEClient, removeSSEClient, broadcastSSEEvent } from "./sse/clients";
import { checkWebhookSignature, verifySharedWebhookSecret, webhookEnforcement } from "./core/connectors/webhook-verify";
import { processResendEvent, verifyResendSignature } from "./core/email/resend-webhook";
import { randomBytes } from "node:crypto";
import { parsePermissions, getPermissionsForLegacyRole, seedDefaultRolesForHotel, seedLicenseForHotel, syncSystemRolePermissions } from "./core/rbac";
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
import { json, sendDoc, sendBinary, parseRawBody, parseBody, hasString, asTrimmedString, asPositiveInt, parseUrl, asSafeLimit, asSafeOffset, numOrNull, numUndef, dateOrNull, normalizePhoneE164, clientIp, PayloadTooLargeError } from "./http/helpers";
import { authorize, getAuthenticatedContext, canAccess, type RouteContext } from "./core/authz";
import { upsertContactByPhone } from "./core/crm/upsert-contact";
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
import { BRANDING_SELECT } from "./core/tenant/branding";
import { ensureTenantAccess } from "./core/authz";
// Compat re-exports: tests (authz-matrix) and any older imports keep working.
export { permissionMap } from "./core/authz";
export type { RouteContext } from "./core/authz";

const eventBus = new InMemoryEventBus();

eventBus.subscribe("service_request.created", (event) => {
  // Placeholder for upcoming Day 3 worker hooks.
  void event;
});

// Date-only guard, still used by the branded-export routes below. (The reporting
// -window parser moved to core/analytics/routes.ts with the analytics routes, #164.)
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

const normalizePhone = (value: string) => value.replace(/\s+/g, "");

const createServiceRequestForHotel = async (input: {
  tenantId: string;
  guestId: string;
  category: string;
  summary: string;
  source: string;
  priority?: string;
  slaMinutes?: number | null;
}) => {
  const safePriority = input.priority ?? "normal";
  const safeSlaDueAt =
    input.slaMinutes && input.slaMinutes > 0
      ? new Date(Date.now() + input.slaMinutes * 60 * 1000)
      : null;
  return prisma.serviceRequest.create({
    data: {
      tenantId: input.tenantId,
      guestId: input.guestId,
      category: input.category,
      status: "open",
      source: input.source,
      summary: input.summary,
      priority: safePriority,
      slaDueAt: safeSlaDueAt
    },
    select: {
      id: true,
      tenantId: true,
      guestId: true,
      category: true,
      status: true,
      source: true,
      summary: true,
      assignedToUserId: true,
      priority: true,
      slaDueAt: true,
      slaBreachedAt: true,
      createdAt: true
    }
  });
};

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
    if (req.url === "/auth/token" && req.method === "POST") {
      // Identity boundary (Phase 9 / C1): only the Clerk-authenticated web tier
      // may exchange an email for a tenant JWT. Enforced whenever the shared
      // secret is configured; production requires it at startup.
      if (!verifyTokenExchangeSecret(req)) {
        json(res, 401, { ok: false, error: "Invalid token exchange secret" });
        return;
      }
      const body = (await parseBody(req)) as { tenantId?: unknown; hotelId?: unknown; email?: unknown; role?: unknown; roleKey?: unknown };
      const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId); // accept legacy hotelId during transition
      const email = asTrimmedString(body.email)?.toLowerCase();
      const roleKey = asTrimmedString(body.roleKey);
      const role = asTrimmedString(body.role) as UserRole | null;
      if (!tenantId || !email || (!role && !roleKey)) {
        json(res, 400, { ok: false, error: "tenantId, email, and one of role|roleKey are required" });
        return;
      }
      // Match by the generic roleKey (the user's assigned system role) when given,
      // else fall back to the legacy hospitality role for backward compatibility.
      const user = await prisma.user.findFirst({
        where: {
          tenantId, email, isActive: true,
          ...(roleKey ? { systemRole: { key: roleKey } } : { role: role ?? undefined }),
        },
        select: {
          id: true, tenantId: true, email: true, role: true,
          systemRole: { select: { permissions: true, key: true } }
        }
      });
      if (!user) {
        json(res, 401, { ok: false, error: "Invalid user credentials" });
        return;
      }
      const permissions = user.systemRole
        ? parsePermissions(user.systemRole.permissions)
        : getPermissionsForLegacyRole(user.role);
      const token = await createAuthToken({
        sub: user.id,
        tenantId: user.tenantId,
        email: user.email,
        role: user.role as UserRole, // legacy claim (compat)
        roleKey: (user.systemRole?.key as SystemRoleKey | undefined) ?? null,
        permissions
      });
      json(res, 200, { ok: true, token });
      return;
    }

    // ── POST /auth/impersonate — start impersonating a real user (E-6) ──────────
    // Server-authoritative: issues a token that authenticates as the TARGET user
    // (their real role + permissions, loaded live from the DB) while recording the
    // original admin. Gated by `impersonate_users`, tenant-scoped, audit-logged.
    if (req.url === "/auth/impersonate" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /auth/impersonate");
      if (!auth.ok) return;
      // No nested impersonation: an impersonated session never carries the
      // permission (we strip it below), but guard explicitly for clarity.
      if (auth.context.impersonatorUserId) {
        json(res, 409, { ok: false, error: "Already impersonating — stop the current session first" });
        return;
      }
      const body = (await parseBody(req)) as { targetUserId?: unknown };
      const targetUserId = asTrimmedString(body.targetUserId);
      if (!targetUserId) {
        json(res, 400, { ok: false, error: "targetUserId is required" });
        return;
      }
      if (targetUserId === auth.context.userId) {
        json(res, 400, { ok: false, error: "You cannot impersonate yourself" });
        return;
      }
      // Tenant-scoped lookup: cross-tenant impersonation is impossible by construction.
      const target = await prisma.user.findFirst({
        where: { id: targetUserId, tenantId: auth.context.tenantId, isActive: true },
        select: {
          id: true, tenantId: true, email: true, role: true, fullName: true,
          systemRole: { select: { permissions: true, key: true, tenantId: true } }
        }
      });
      if (!target) {
        json(res, 404, { ok: false, error: "User not found in this tenant" });
        return;
      }
      const roleBelongsToHotel = target.systemRole?.tenantId === target.tenantId;
      const targetPermissions = target.systemRole && roleBelongsToHotel
        ? parsePermissions(target.systemRole.permissions)
        : getPermissionsForLegacyRole(target.role);
      // Never escalate beyond the target — and never let an impersonated session
      // start another impersonation, even if the target happens to be an admin.
      const sessionPermissions = targetPermissions.filter(p => p !== "impersonate_users");
      const token = await createAuthToken({
        sub: target.id,
        tenantId: target.tenantId,
        email: target.email,
        role: target.role as UserRole,
        roleKey: (target.systemRole?.key as SystemRoleKey | undefined) ?? null,
        permissions: sessionPermissions,
        impersonatorUserId: auth.context.userId,
        impersonatorEmail: auth.context.email
      });
      await prisma.auditLog.create({
        data: {
          tenantId: auth.context.tenantId,
          actorRole: auth.context.role,
          action: "impersonation.start",
          entityType: "user",
          entityId: target.id,
          metadata: JSON.stringify({
            impersonatorUserId: auth.context.userId,
            impersonatorEmail: auth.context.email,
            targetEmail: target.email,
            targetRoleKey: target.systemRole?.key ?? null
          })
        }
      });
      json(res, 200, {
        ok: true,
        token,
        target: { id: target.id, email: target.email, fullName: target.fullName, roleKey: target.systemRole?.key ?? null },
        impersonator: { id: auth.context.userId, email: auth.context.email, fullName: auth.context.fullName }
      });
      return;
    }

    // ── POST /auth/impersonate/stop — end an impersonation session (E-6) ────────
    // Any authenticated session may call this; it only logs when the caller is
    // actually impersonating. The web also clears its cookie regardless.
    if (req.url === "/auth/impersonate/stop" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /auth/impersonate/stop");
      if (!auth.ok) return;
      if (auth.context.impersonatorUserId) {
        await prisma.auditLog.create({
          data: {
            tenantId: auth.context.tenantId,
            actorRole: auth.context.role,
            action: "impersonation.stop",
            entityType: "user",
            entityId: auth.context.userId,
            metadata: JSON.stringify({
              impersonatorUserId: auth.context.impersonatorUserId,
              impersonatorEmail: auth.context.impersonatorEmail,
              targetEmail: auth.context.email
            })
          }
        });
      }
      json(res, 200, { ok: true });
      return;
    }

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

    // ── GET /auth/impersonations/recent — recent targets for the modal (E-6) ────
    // Derived from the audit log so we don't need a separate table; deduped by
    // target and scoped to the requesting admin.
    if (req.url?.startsWith("/auth/impersonations/recent") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /auth/impersonations/recent");
      if (!auth.ok) return;
      const logs = await prisma.auditLog.findMany({
        where: { tenantId: auth.context.tenantId, action: "impersonation.start" },
        orderBy: { createdAt: "desc" },
        take: 100,
        select: { entityId: true, metadata: true, createdAt: true }
      });
      const seen = new Set<string>();
      const recent: Array<{ userId: string; email: string | null; roleKey: string | null; at: Date }> = [];
      for (const log of logs) {
        let meta: { impersonatorUserId?: string; targetEmail?: string; targetRoleKey?: string } = {};
        try { meta = JSON.parse(log.metadata); } catch { /* skip malformed */ }
        if (meta.impersonatorUserId !== auth.context.userId) continue;
        if (!log.entityId || seen.has(log.entityId)) continue;
        seen.add(log.entityId);
        recent.push({ userId: log.entityId, email: meta.targetEmail ?? null, roleKey: meta.targetRoleKey ?? null, at: log.createdAt });
        if (recent.length >= 5) break;
      }
      json(res, 200, { ok: true, recent });
      return;
    }

    // ── GET /auth/identify — public: look up tenantId+role+industry by email ────────
    // Read-only: this endpoint MUST NOT mutate state. Invited users are connected via
    // the token-protected invite flow (POST /team/invitations/:token/accept), which
    // proves possession of the secret invite link. Auto-accepting by email alone here
    // would let anyone consume a pending invitation just by knowing the address, and a
    // GET must never have side effects.
    if (req.url?.startsWith("/auth/identify") && req.method === "GET") {
      // Throttle per client IP — this is an unauthenticated email→tenant lookup,
      // so without a limit it's an email-enumeration oracle (F-24).
      const ip = clientIp(req);
      if (!(await rateLimit(`identify:${ip}`, 20, 60_000))) {
        json(res, 429, { ok: false, error: "Too many requests" });
        return;
      }
      // Same identity boundary as /auth/token (Phase 9 / C1): with the shared
      // secret configured this stops being a public tenantId/roleKey oracle.
      if (!verifyTokenExchangeSecret(req)) {
        json(res, 401, { ok: false, error: "Invalid token exchange secret" });
        return;
      }
      const email = parseUrl(req.url).searchParams.get("email")?.toLowerCase().trim();
      if (!email) {
        json(res, 400, { ok: false, error: "email is required" });
        return;
      }

      // A single email can now be a member of multiple workspaces (one User row
      // per tenant). Return every active membership so the web can pick the
      // active one and offer a workspace switcher.
      const memberships = await prisma.user.findMany({
        where: { email, isActive: true },
        select: {
          tenantId: true,
          role: true,
          fullName: true,
          createdAt: true,
          systemRole: { select: { key: true } },
          tenant: { select: { industry: true, name: true, whitelabelTier: true, branding: { select: BRANDING_SELECT } } }
        },
        orderBy: { createdAt: "asc" }
      });

      if (memberships.length === 0) {
        // No active user record. Report whether a pending invitation exists so the web
        // can route the visitor to the invite-acceptance page — without creating
        // anything or revealing tenant details.
        const pendingInvite = await prisma.invitation.findFirst({
          where: { email, acceptedAt: null, expiresAt: { gt: new Date() } },
          select: { id: true }
        });
        json(res, 200, { ok: true, exists: false, hasPendingInvite: !!pendingInvite });
        return;
      }

      const workspaces = memberships.map(m => ({
        tenantId: m.tenantId,
        role: m.role,
        roleKey: m.systemRole?.key ?? null,
        industry: m.tenant.industry,
        propertyName: m.tenant.name,
        whitelabelTier: m.tenant.whitelabelTier,
        branding: m.tenant.branding ?? null,
        fullName: m.fullName
      }));
      // Top-level fields mirror the first workspace for backward compatibility
      // with any older caller; `workspaces` is the canonical list.
      json(res, 200, {
        ok: true,
        exists: true,
        workspaces,
        tenantId: workspaces[0].tenantId,
        role: workspaces[0].role,
        roleKey: workspaces[0].roleKey,
        industry: workspaces[0].industry,
        propertyName: workspaces[0].propertyName,
        whitelabelTier: workspaces[0].whitelabelTier,
        branding: workspaces[0].branding,
        fullName: workspaces[0].fullName
      });
      return;
    }

    // ── GET /tenant/resolve — public: map a host or slug to a tenant + branding ──
    // Lets the web theme the sign-in page on white-label subdomains / custom
    // domains BEFORE the user authenticates. Read-only; returns {found:false} for
    // the platform's own hosts so the default Eynis experience is used there.
    if (req.url?.startsWith("/tenant/resolve") && req.method === "GET") {
      const params = parseUrl(req.url).searchParams;
      const rawHost = params.get("host")?.toLowerCase().trim().replace(/:\d+$/, "") || null;
      let slug = params.get("slug")?.toLowerCase().trim() || null;
      let customDomain: string | null = null;

      const platform = (process.env.PLATFORM_APP_DOMAIN ?? "eynis.com").toLowerCase();
      if (rawHost) {
        const isPlatformHost = rawHost === platform || rawHost === `www.${platform}` || rawHost === `demo.${platform}` || rawHost === "localhost";
        if (isPlatformHost) { json(res, 200, { ok: true, found: false }); return; }
        if (rawHost.endsWith(`.${platform}`)) {
          slug = slug ?? rawHost.slice(0, rawHost.length - platform.length - 1).split(".").pop() ?? null;
        } else {
          customDomain = rawHost;
        }
      }
      if (!slug && !customDomain) { json(res, 200, { ok: true, found: false }); return; }

      const or = [customDomain ? { customDomain } : null, slug ? { slug } : null].filter(Boolean) as object[];
      const tenant = await prisma.tenant.findFirst({
        where: { OR: or },
        select: { id: true, industry: true, name: true, whitelabelTier: true, branding: { select: BRANDING_SELECT } },
      });
      if (!tenant) { json(res, 200, { ok: true, found: false }); return; }
      json(res, 200, {
        ok: true, found: true,
        tenantId: tenant.id, industry: tenant.industry, propertyName: tenant.name,
        whitelabelTier: tenant.whitelabelTier,
        branding: tenant.branding ?? null,
      });
      return;
    }

    // ── POST /hotels/register — public: create hotel, seed roles/license, issue JWT ─
    if (req.url === "/hotels/register" && req.method === "POST") {
      // Throttle per client IP — this is an unauthenticated endpoint that mints a
      // tenant + a live admin token, so without a limit it can be scripted to create
      // thousands of tenants / admin tokens for arbitrary emails (F-…). Registration
      // is a rare action, so a tight cap is safe.
      const rip = clientIp(req);
      if (!(await rateLimit(`register:${rip}`, 5, 60 * 60_000))) {
        json(res, 429, { ok: false, error: "Too many registration attempts. Please try again later." });
        return;
      }
      const body = (await parseBody(req)) as {
        propertyName?: unknown;
        ownerEmail?: unknown;
        ownerName?: unknown;
        timezone?: unknown;
        industry?: unknown;
      };
      const propertyName = asTrimmedString(body.propertyName);
      const ownerEmail = asTrimmedString(body.ownerEmail)?.toLowerCase();
      const timezone = asTrimmedString(body.timezone) ?? "Asia/Kolkata";
      const industry = asTrimmedString(body.industry) ?? "hospitality";
      const INDUSTRY_ADMIN_TITLE: Record<string, string> = {
        hospitality:   "Hotel Admin",
        manufacturing: "Plant Admin",
        fnb:           "Restaurant Admin",
        travel:        "Travel Desk Admin",
        healthcare:    "Clinic Admin",
        it_services:   "IT Admin",
      };
      const ownerName = asTrimmedString(body.ownerName) ?? INDUSTRY_ADMIN_TITLE[industry] ?? "Admin";

      if (!propertyName || !ownerEmail) {
        json(res, 400, { ok: false, error: "propertyName and ownerEmail are required" });
        return;
      }

      // Multi-workspace: an identity may own/belong to several workspaces, so we
      // no longer reject an email that already exists elsewhere. The new tenant
      // gets its own User row (unique per tenant+email). We only guard against a
      // duplicate workspace for the *same* owner with the same property name, to
      // avoid accidental double-submits creating identical workspaces.
      const dupName = await prisma.user.findFirst({
        where: { email: ownerEmail, tenant: { name: propertyName } },
        select: { id: true }
      });
      if (dupName) {
        json(res, 409, { ok: false, error: "You already have a workspace with this name" });
        return;
      }

      const tenantId = `hotel-${randomBytes(8).toString("hex")}`;

      await prisma.tenant.create({ data: { id: tenantId, name: propertyName, timezone, industry } });

      await seedDefaultRolesForHotel(tenantId);
      await seedLicenseForHotel(tenantId, "starter", 5);

      // Provision the industry "starter kit": quote templates, materials, follow-up
      // sequence + message templates, and the WhatsApp sales agent — all stamped with
      // the company name. Best-effort: a seeding hiccup must not block workspace creation.
      try {
        await seedIndustryDefaults(tenantId, industry, propertyName);
      } catch (err) {
        console.warn("[workspace-create] seedIndustryDefaults failed:", err instanceof Error ? err.message : err);
      }

      // Seed the industry pack's operational automation rules (#160). Best-effort:
      // a seeding hiccup must not block workspace creation.
      try {
        await seedAutomationRulesForTenant(tenantId, industry);
      } catch (err) {
        console.warn("[workspace-create] seedAutomationRulesForTenant failed:", err instanceof Error ? err.message : err);
      }

      const adminRole = await prisma.role.findUnique({
        where: { tenantId_key: { tenantId, key: "admin" } },
        select: { id: true, permissions: true }
      });

      const userId = `user-${randomBytes(8).toString("hex")}`;
      await prisma.user.create({
        data: {
          id: userId,
          tenantId,
          email: ownerEmail,
          fullName: ownerName,
          role: "owner",
          roleId: adminRole?.id ?? null,
          isActive: true
        }
      });

      const permissions = adminRole
        ? parsePermissions(adminRole.permissions)
        : getPermissionsForLegacyRole("owner");

      const token = await createAuthToken({
        sub: userId,
        tenantId,
        email: ownerEmail,
        role: "owner",
        roleKey: "admin", // the owner is always seeded as the admin system role
        permissions
      });

      json(res, 201, { ok: true, tenantId, token, email: ownerEmail, propertyName });
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
    if (req.url === "/webhooks/vapi" && req.method === "POST") {
      const rawBody = await parseRawBody(req);
      let payload: unknown = {};
      try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { json(res, 400, { ok: false, error: "Invalid JSON" }); return; }

      const { verifyWebhook, resolveVapiCredentials } = await import("./core/campaigns/vapi");
      const { normalizeVapiMessage, processVapiWebhook } = await import("./core/campaigns/webhook");

      // Resolve the expected secret per-tenant: assistants are provisioned with the
      // tenant's webhookSecret (ConnectorConfig, falling back to env), so verifying
      // only against the global env var rejects tenants with their own secret (F-16).
      // Mapping the call→tenant uses the unverified callId purely to pick which
      // secret to check against — the caller must still present that secret.
      let expectedSecret = asTrimmedString(process.env.VAPI_WEBHOOK_SECRET);
      const evt = normalizeVapiMessage(payload);
      if (evt.kind !== "ignore") {
        const call = await prisma.callRecord.findUnique({ where: { vapiCallId: evt.callId }, select: { tenantId: true } });
        if (call) {
          const creds = await resolveVapiCredentials(call.tenantId);
          if (creds.webhookSecret) expectedSecret = creds.webhookSecret;
        }
      }

      const verdict = verifyWebhook({
        provided: (req.headers["x-vapi-secret"] as string) ?? null,
        expected: expectedSecret,
        enforce: String(process.env.VERIFY_WEBHOOKS ?? "").toLowerCase() === "true",
      });
      if (!verdict.ok) { json(res, 401, { ok: false, error: verdict.reason ?? "Invalid webhook secret" }); return; }

      const result = await processVapiWebhook(payload);
      json(res, 200, { ok: true, ...result });
      return;
    }

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

    if (req.url === "/events/service-request-created" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /events/service-request-created");
      if (!auth.ok) return;
      const context = auth.context;

      const hasAccess = await ensureTenantAccess(context.tenantId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      eventBus.publish({
        type: "service_request.created",
        tenantId: context.tenantId,
        payload: { source: "api" },
        createdAt: new Date().toISOString()
      });

      await prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorRole: context.role,
          action: "service_request.created",
          entityType: "service_request",
          metadata: JSON.stringify({ source: "api" })
        }
      });

      json(res, 202, { ok: true });
      return;
    }

    if (req.url === "/public/requests" && req.method === "POST") {
      // Throttle per client IP — this is an unauthenticated write (creates a Contact +
      // ServiceRequest). Without a cap it can be scripted to flood a tenant's queue and
      // create unbounded Contact rows (F-…). A public intake form is low-frequency.
      const pip = clientIp(req);
      if (!(await rateLimit(`public-req:${pip}`, 10, 60_000))) {
        json(res, 429, { ok: false, error: "Too many requests. Please try again shortly." });
        return;
      }
      const body = (await parseBody(req)) as {
        tenantId?: unknown;
        hotelId?: unknown;
        guestName?: unknown;
        guestPhone?: unknown;
        category?: unknown;
        summary?: unknown;
        source?: unknown;
      };
      const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId); // accept legacy hotelId from existing public links
      const guestName = asTrimmedString(body.guestName);
      const guestPhoneRaw = asTrimmedString(body.guestPhone);
      const category = asTrimmedString(body.category) ?? "general";
      const summary = asTrimmedString(body.summary);
      const source = asTrimmedString(body.source) ?? "qr";
      const guestPhone = guestPhoneRaw ? normalizePhone(guestPhoneRaw) : null;

      if (!tenantId || !guestName || !guestPhone || !summary) {
        json(res, 400, {
          ok: false,
          error: "tenantId, guestName, guestPhone and summary are required"
        });
        return;
      }

      const hasAccess = await ensureTenantAccess(tenantId);
      if (!hasAccess) {
        json(res, 404, { ok: false, error: "Hotel not found" });
        return;
      }

      const guestId = await upsertContactByPhone(tenantId, guestName, guestPhone);
      const serviceRequest = await createServiceRequestForHotel({
        tenantId,
        guestId,
        category,
        summary,
        source,
        priority: "normal"
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          actorRole: "guest",
          action: "service_request.created.public",
          entityType: "service_request",
          entityId: serviceRequest.id,
          metadata: JSON.stringify({ source, guestPhone })
        }
      });

      json(res, 201, { ok: true, item: serviceRequest });
      return;
    }

    // ── POST /webhooks/resend — public: email delivery/bounce/complaint events ──
    // Feeds the per-tenant EmailSuppression list. Verified via the Svix signature
    // when RESEND_WEBHOOK_SECRET is set (accept-all in dev, mirroring VERIFY_WEBHOOKS).
    if (req.url === "/webhooks/resend" && req.method === "POST") {
      const rawBody = await parseRawBody(req);
      const secret = asTrimmedString(process.env.RESEND_WEBHOOK_SECRET);
      if (!secret) {
        // Fail closed in production: without the secret, forged bounce/complaint
        // events could suppress arbitrary recipients (F-10). Accept-all only in dev.
        if (process.env.NODE_ENV === "production") { json(res, 503, { ok: false, error: "Webhook secret not configured" }); return; }
      } else {
        const hdr = (k: string) => (typeof req.headers[k] === "string" ? (req.headers[k] as string) : null);
        const tsHeader = hdr("svix-timestamp");
        // Replay protection: reject stale or missing timestamps (Svix sends unix
        // seconds) so a captured signed payload can't be replayed forever (F-10).
        const tsSec = tsHeader ? Number(tsHeader) : NaN;
        if (!Number.isFinite(tsSec) || Math.abs(Date.now() / 1000 - tsSec) > 300) {
          json(res, 401, { ok: false, error: "Stale or missing webhook timestamp" }); return;
        }
        const valid = verifyResendSignature(secret, {
          id: hdr("svix-id"), timestamp: tsHeader, signature: hdr("svix-signature"),
        }, rawBody ?? "");
        if (!valid) { json(res, 401, { ok: false, error: "Invalid webhook signature" }); return; }
      }
      let event: unknown;
      try { event = rawBody ? JSON.parse(rawBody) : {}; } catch { json(res, 400, { ok: false, error: "Invalid JSON" }); return; }
      const result = await processResendEvent(event as Parameters<typeof processResendEvent>[0]);
      json(res, 200, { ok: true, action: result.action });
      return;
    }

    if (req.url === "/integrations/whatsapp/webhook" && req.method === "POST") {
      const provided = req.headers["x-webhook-secret"];
      const secretCheck = verifySharedWebhookSecret({
        expected: process.env.WHATSAPP_WEBHOOK_SECRET,
        provided: typeof provided === "string" ? provided : Array.isArray(provided) ? provided[0] : null,
        isProduction: process.env.NODE_ENV === "production"
      });
      if (!secretCheck.ok) { json(res, secretCheck.status, { ok: false, error: secretCheck.reason ?? "Unauthorized" }); return; }

      const rawBody = await parseRawBody(req);
      // Enforce-when-configured: verification turns on automatically as soon as
      // the operator has configured what it needs (Interakt secret, or Twilio
      // token + public URL). VERIFY_WEBHOOKS=true forces it on; =false is the
      // explicit dev escape hatch. See webhookEnforcement().
      const enforcement = webhookEnforcement();

      const twilioSig = typeof req.headers["x-twilio-signature"] === "string" ? req.headers["x-twilio-signature"] : null;
      const interaktSigPresent = typeof req.headers["x-hub-signature-256"] === "string" || typeof req.headers["x-interakt-signature"] === "string";
      // Close the omission bypass: when any provider is enforced, a request with
      // no provider signature at all must be rejected rather than silently
      // accepted (F-9) — otherwise forging "the other provider's" payload
      // unsigned would bypass verification entirely.
      if (enforcement.any && twilioSig === null && !interaktSigPresent) {
        json(res, 401, { ok: false, error: "Missing webhook signature" }); return;
      }
      if (twilioSig !== null) {
        // Twilio's HMAC covers the exact public URL it POSTed to PLUS the sorted form
        // params. Use the configured public URL (TWILIO_WEBHOOK_URL / EYNIS_PUBLIC_URL,
        // never the request Host which a caller controls) and the real form params
        // parsed from the body. Enforcement is automatic once that URL + the auth
        // token are configured — operators should validate against a live Twilio
        // number when setting them.
        const configuredBase = (process.env.TWILIO_WEBHOOK_URL ?? process.env.EYNIS_PUBLIC_URL ?? "").trim();
        const fullUrl = configuredBase
          ? configuredBase
          : `https://${req.headers.host ?? "localhost"}${req.url}`;
        const isForm = (req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded");
        const twilioParams = isForm ? Object.fromEntries(new URLSearchParams(rawBody)) : {};
        const check = checkWebhookSignature({ provider: "twilio", signature: twilioSig, url: fullUrl, rawBody, params: twilioParams, enforce: enforcement.twilio });
        if (!check.ok) { json(res, 401, { ok: false, error: check.reason ?? "Twilio signature verification failed" }); return; }
      }

      const interaktSig = typeof req.headers["x-hub-signature-256"] === "string"
        ? req.headers["x-hub-signature-256"]
        : typeof req.headers["x-interakt-signature"] === "string"
        ? req.headers["x-interakt-signature"]
        : null;
      if (interaktSig !== null) {
        const check = checkWebhookSignature({ provider: "interakt", signature: interaktSig, url: req.url ?? "", rawBody, enforce: enforcement.interakt });
        if (!check.ok) { json(res, 401, { ok: false, error: check.reason ?? "Interakt signature verification failed" }); return; }
      }

      const body = (rawBody ? JSON.parse(rawBody) : {}) as Record<string, unknown>;
      const normalized = normalizeWhatsappInbound(body);
      if (!normalized) {
        json(res, 400, {
          ok: false,
          error: "Unable to normalize webhook payload. Provide provider-compatible payload with tenantId, sender phone and message."
        });
        return;
      }
      const { tenantId, fromPhone, message, guestName, provider } = normalized;
      const hasAccess = await ensureTenantAccess(tenantId);
      if (!hasAccess) {
        json(res, 404, { ok: false, error: "Hotel not found" });
        return;
      }

      // Two-way campaign WhatsApp agent: if this sender is a lead on a campaign
      // with the agent enabled, handle the reply here and stop. Otherwise fall
      // through to the normal service-request ingest.
      const providerMessageId =
        asTrimmedString((body as Record<string, unknown>).MessageSid) ??
        asTrimmedString((body as Record<string, unknown>).messageId) ??
        asTrimmedString((body as Record<string, unknown>).id);
      const { handleInboundWhatsApp } = await import("./core/campaigns/whatsapp-agent");
      const agentResult = await handleInboundWhatsApp({ tenantId, fromPhone, body: message, providerMessageId });
      if (agentResult.handled) {
        json(res, 202, { ok: true, handledBy: "whatsapp_agent", reason: agentResult.reason });
        return;
      }

      const result = await ingestConnectorEvent({
        tenantId,
        connectorKey: provider === "twilio" ? "whatsapp_twilio" : provider === "interakt" ? "whatsapp_interakt" : "whatsapp_generic",
        guestPhone: fromPhone,
        guestName,
        messageText: message,
        rawPayload: body,
        sendReply: true
      });

      json(res, 202, {
        ok: true,
        connectorEventId: result.connectorEventId,
        requestId: result.serviceRequestId,
        classification: result.classification,
        replySent: result.replySent
      });
      return;
    }

    // ── Connector: unified ingest endpoint ──────────────────────────────────
    if (req.url?.startsWith("/connectors/events/ingest") && req.method === "POST") {
      const auth = await authorize(req, res, "POST /connectors/events/ingest");
      if (!auth.ok) return;

      const body = (await parseBody(req)) as {
        connectorKey?: unknown; eventType?: unknown; guestPhone?: unknown;
        guestName?: unknown; messageText?: unknown; aiProvider?: unknown; sendReply?: unknown;
      };
      const connectorKey = asTrimmedString(body.connectorKey);
      const messageText = asTrimmedString(body.messageText);
      if (!connectorKey || !messageText) {
        json(res, 400, { ok: false, error: "connectorKey and messageText are required" }); return;
      }
      const aiProv = asTrimmedString(body.aiProvider) === "openai" ? "openai" as const : "claude" as const;

      const result = await ingestConnectorEvent({
        tenantId: auth.context.tenantId,
        connectorKey,
        eventType: asTrimmedString(body.eventType) ?? "inbound_message",
        guestPhone: asTrimmedString(body.guestPhone) ?? undefined,
        guestName: asTrimmedString(body.guestName) ?? undefined,
        messageText,
        rawPayload: body,
        aiProvider: aiProv,
        sendReply: body.sendReply !== false
      });

      json(res, 201, { ok: true, ...result });
      return;
    }

    // ── Connector: event log ────────────────────────────────────────────────
    if (req.url?.startsWith("/connectors/events") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /connectors/events");
      if (!auth.ok) return;

      const qs = parseUrl(req.url).searchParams;
      // Use the hardened helpers — a raw Number("abc") here yielded take: NaN, which
      // made Prisma throw and surfaced as an opaque 500 (F-…). Every other list route
      // already uses these.
      const limit = asSafeLimit(qs.get("limit"), 20, 100);
      const offset = asSafeOffset(qs.get("offset"));
      const connectorKey = qs.get("connectorKey") ?? undefined;

      const [items, total] = await Promise.all([
        prisma.connectorEvent.findMany({
          where: { tenantId: auth.context.tenantId, ...(connectorKey ? { connectorKey } : {}) },
          orderBy: { createdAt: "desc" },
          take: limit,
          skip: offset,
          select: {
            id: true, connectorKey: true, eventType: true, guestPhone: true,
            guestName: true, aiProvider: true, aiCategory: true, aiPriority: true,
            aiSummary: true, aiSentiment: true, aiRoutingHint: true,
            serviceRequestId: true, replySentAt: true, replyStatus: true, createdAt: true
          }
        }),
        prisma.connectorEvent.count({ where: { tenantId: auth.context.tenantId, ...(connectorKey ? { connectorKey } : {}) } })
      ]);

      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return;
    }

    // ── Connector: outbound WhatsApp send ───────────────────────────────────
    if (req.url?.startsWith("/connectors/whatsapp/send") && req.method === "POST") {
      const auth = await authorize(req, res, "POST /connectors/whatsapp/send");
      if (!auth.ok) return;

      const body = (await parseBody(req)) as { toPhone?: unknown; message?: unknown };
      const toPhone = asTrimmedString(body.toPhone);
      const message = asTrimmedString(body.message);
      if (!toPhone || !message) {
        json(res, 400, { ok: false, error: "toPhone and message are required" }); return;
      }

      // Guardrail (#168): even a manual staff send must honour the durable opt-out /
      // DND list — a subject who texted STOP (or was suppressed/erased) is never
      // contacted. Caps/quiet-hours don't apply to a human-initiated send.
      const { evaluateOutboundSend } = await import("./core/connectors/messaging-guardrails");
      const guard = await evaluateOutboundSend({ tenantId: auth.context.tenantId, phone: toPhone, kind: "manual" });
      if (!guard.allowed) {
        json(res, 403, { ok: false, error: `Cannot message this subject: ${guard.reason}` }); return;
      }

      const { sendWhatsAppReply } = await import("./core/connectors/whatsapp-outbound");
      const result = await sendWhatsAppReply(auth.context.tenantId, toPhone, message);
      json(res, result.sent ? 200 : 503, { ok: result.sent, ...result });
      return;
    }

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

    // ── POST /connectors/pms/simulate ────────────────────────────────────────
    if (req.url === "/connectors/pms/simulate" && req.method === "POST") {
      // Demo-only: fabricates a check-in with real DB writes. Disabled in
      // production unless explicitly opted in, so it can't be used to seed
      // bogus stays/contacts on a live tenant (F-2).
      if (process.env.NODE_ENV === "production" && process.env.ENABLE_PMS_SIMULATE !== "true") {
        json(res, 404, { ok: false, error: "Not found" }); return;
      }
      const auth = await authorize(req, res, "POST /connectors/pms/simulate");
      if (!auth.ok) return;
      const { tenantId } = auth.context;
      const body = (await parseBody(req)) as { guestName?: unknown; roomNumber?: unknown };
      const guestNameInput = asTrimmedString(body.guestName) ?? "Demo Guest";
      const roomNumber = asTrimmedString(body.roomNumber) ?? `${Math.floor(Math.random() * 50) + 101}`;

      const phone = `+9198${Math.floor(Math.random() * 90000000) + 10000000}`;
      const guestId = await upsertContactByPhone(tenantId, guestNameInput, phone);
      await prisma.contact.update({ where: { id: guestId }, data: { visitCount: { increment: 1 } } });

      const checkInAt = new Date();
      const checkOutAt = new Date(checkInAt.getTime() + 2 * 24 * 60 * 60 * 1000);
      const stay = await prisma.stay.create({
        data: { tenantId, guestId, roomNumber, checkInAt, checkOutAt }
      });

      broadcastSSEEvent(tenantId, { type: "checkin_event", data: { stayId: stay.id, guestId, guestName: guestNameInput, roomNumber, checkInAt } });

      json(res, 201, { ok: true, stay: { id: stay.id, guestId, guestName: guestNameInput, roomNumber, checkInAt, checkOutAt } });
      return;
    }

    // ── POST /connectors/pms/webhook ─────────────────────────────────────────
    if (req.url === "/connectors/pms/webhook" && req.method === "POST") {
      // This endpoint writes data (contacts, stays, visit counts) for the tenantId
      // in the body, so it MUST be authenticated. Without the shared-secret gate
      // anyone who knows a tenantId could inject check-in/checkout events (F-2).
      const providedSecret = req.headers["x-webhook-secret"];
      const secretCheck = verifySharedWebhookSecret({
        expected: process.env.PMS_WEBHOOK_SECRET,
        provided: typeof providedSecret === "string" ? providedSecret : Array.isArray(providedSecret) ? providedSecret[0] : null,
        isProduction: process.env.NODE_ENV === "production"
      });
      if (!secretCheck.ok) { json(res, secretCheck.status, { ok: false, error: secretCheck.reason ?? "Unauthorized" }); return; }

      const rawBody = await parseRawBody(req);
      const body = (rawBody ? JSON.parse(rawBody) : {}) as {
        tenantId?: unknown; hotelId?: unknown; event?: unknown;
        guest?: { name?: unknown; phone?: unknown };
        reservation?: { roomNumber?: unknown; checkIn?: unknown; checkOut?: unknown };
      };
      const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId); // accept legacy hotelId from existing PMS integrations
      const eventType = asTrimmedString(body.event) ?? "guest.checkin";
      if (!tenantId) { json(res, 400, { ok: false, error: "tenantId is required" }); return; }
      const hasAccess = await ensureTenantAccess(tenantId);
      if (!hasAccess) { json(res, 404, { ok: false, error: "Hotel not found" }); return; }

      const guestName = asTrimmedString(body.guest?.name) ?? "PMS Guest";
      const guestPhone = asTrimmedString(body.guest?.phone) ?? `+9199${Math.floor(Math.random() * 90000000) + 10000000}`;
      const roomNumber = asTrimmedString(body.reservation?.roomNumber) ?? "101";
      const checkInAt = body.reservation?.checkIn ? new Date(body.reservation.checkIn as string) : new Date();
      const checkOutAt = body.reservation?.checkOut ? new Date(body.reservation.checkOut as string) : new Date(checkInAt.getTime() + 2 * 24 * 60 * 60 * 1000);

      const guestId = await upsertContactByPhone(tenantId, guestName, guestPhone);

      if (eventType === "guest.checkin") {
        await prisma.contact.update({ where: { id: guestId }, data: { visitCount: { increment: 1 } } });
        const stay = await prisma.stay.create({ data: { tenantId, guestId, roomNumber, checkInAt, checkOutAt } });
        broadcastSSEEvent(tenantId, { type: "checkin_event", data: { stayId: stay.id, guestId, guestName, roomNumber, checkInAt } });
        json(res, 201, { ok: true, event: "checkin", stayId: stay.id, guestId });
      } else if (eventType === "guest.checkout") {
        broadcastSSEEvent(tenantId, { type: "checkout_event", data: { guestId, guestName, roomNumber, checkOutAt } });
        json(res, 200, { ok: true, event: "checkout", guestId });
      } else {
        json(res, 200, { ok: true, event: eventType, guestId });
      }
      return;
    }

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
