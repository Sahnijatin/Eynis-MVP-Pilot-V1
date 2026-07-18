import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { InMemoryEventBus } from "./events/event-bus";
import { prisma } from "./db/prisma";
import { Prisma } from "@prisma/client";
import type { UserRole, SystemRoleKey } from "@eynis/shared";
import { isValidConsentSource, CONNECTOR_CATALOG, CONNECTOR_CATEGORY_LABELS, connectorEnvFlag } from "@eynis/shared";
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
import { recordServiceRequestResolution, backfillAllTenantsValueEvents } from "./core/attribution/recorder";
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
import { handleAutomationRoutes } from "./core/automations/routes";
import { handleIntakeRoutes } from "./core/connectors/intake-routes";
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


// ── Tenant branding (white-label) ──────────────────────────────────────────────
// Fields the client may read/write. `id`/`tenantId`/timestamps are never client-set.
const BRANDING_SELECT = {
  brandName: true, tagline: true, logoUrl: true, faviconUrl: true,
  primaryColor: true, accentColor: true, sidebarColor: true, fontFamily: true,
  customCss: true, supportEmail: true, hidePoweredBy: true, brandEmails: true, brandReports: true,
} as const;

// Coerce/validate an inbound branding payload into the writable columns. Strings
// are trimmed; blanks become null (so clearing a field resets to industry default).
const sanitizeBranding = (body: Record<string, unknown>) => {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const color = (v: unknown): string | null => {
    const s = str(v);
    return s && /^#[0-9a-fA-F]{6}$/.test(s) ? s : null; // only accept #rrggbb
  };
  // Font-family stack: a conservative whitelist so it can be safely dropped into a
  // CSS variable. Letters/digits/space/comma/hyphen and quotes only — no ; { } < >
  // ( ) so it can't break out of the declaration or smuggle url()/expression().
  const font = (v: unknown): string | null => {
    const s = str(v);
    return s && s.length <= 200 && /^[a-zA-Z0-9 ,"'\-]+$/.test(s) ? s : null;
  };
  const bool = (v: unknown, dflt: boolean): boolean => (typeof v === "boolean" ? v : dflt);
  return {
    brandName: str(body.brandName),
    tagline: str(body.tagline),
    logoUrl: str(body.logoUrl),
    faviconUrl: str(body.faviconUrl),
    primaryColor: color(body.primaryColor),
    accentColor: color(body.accentColor),
    sidebarColor: color(body.sidebarColor),
    fontFamily: font(body.fontFamily),
    customCss: sanitizeCustomCss(body.customCss),
    supportEmail: str(body.supportEmail),
    hidePoweredBy: body.hidePoweredBy === true,
    brandEmails: bool(body.brandEmails, true),
    brandReports: bool(body.brandReports, true),
  };
};

const normalizePhone = (value: string) => value.replace(/\s+/g, "");

// Per-user notification bell preferences. null/invalid → all categories enabled.
type NotificationPrefs = { escalations: boolean; inventory: boolean; quotes: boolean };
const parseNotificationPrefs = (raw: string | null): NotificationPrefs => {
  const all: NotificationPrefs = { escalations: true, inventory: true, quotes: true };
  if (!raw) return all;
  try {
    const p = JSON.parse(raw) as Record<string, unknown>;
    return {
      escalations: typeof p.escalations === "boolean" ? p.escalations : true,
      inventory: typeof p.inventory === "boolean" ? p.inventory : true,
      quotes: typeof p.quotes === "boolean" ? p.quotes : true,
    };
  } catch { return all; }
};

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


const parseServiceRequestStatusPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  const match = /^\/service-requests\/([^/]+)\/status$/.exec(url);
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
};

const parseServiceRequestAssignPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  const match = /^\/service-requests\/([^/]+)\/assign$/.exec(url);
  if (!match || !match[1]) {
    return null;
  }
  return match[1];
};





const parseConnectorConfigPath = (url: string | undefined): string | null => {
  if (!url) {
    return null;
  }
  const parsed = parseUrl(url);
  const match = /^\/connectors\/configs\/([^/]+)$/.exec(parsed.pathname);
  if (!match || !match[1]) {
    return null;
  }
  return decodeURIComponent(match[1]);
};

// CRM contact/company id routing: /contacts/:id, /companies/:id

// Connector registry. The static catalog (name, description, what it needs,
// icon/brand, planned flag) is shared with the web Integrations module via
// @eynis/shared; here we add the runtime env flag. The GET handler overlays
// per-tenant status and config.
const connectorRegistry = CONNECTOR_CATALOG.map((c) => ({ ...c, envFlag: connectorEnvFlag(c.key) }));

const envFlagByConnectorKey = new Map<string, string>(
  connectorRegistry.map((item) => [item.key, item.envFlag])
);

// Detects secret-like field keys (so they're masked in responses and preserved on
// re-save when the client echoes the mask instead of a real value).
const isSecretKey = (key: string): boolean => {
  const k = key.toLowerCase();
  return k.includes("secret") || k.includes("token") || k.includes("password") || k.endsWith("key");
};
const SECRET_MASK = "***";

const maskConnectorConfig = (config: Record<string, unknown>) => {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    masked[key] = isSecretKey(key) && typeof value === "string" && value.length > 0 ? SECRET_MASK : value;
  }
  return masked;
};

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

    // GET /service-requests/export?format=csv — tabular CSV of this tenant's SRs.
    if (parseUrl(req.url).pathname === "/service-requests/export" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /service-requests/export");
      if (!auth.ok) return;
      const { tenantId } = auth.context;
      const params = parseUrl(req.url).searchParams;
      const statusFilter = asTrimmedString(params.get("status"));
      const items = await prisma.serviceRequest.findMany({
        where: { tenantId, ...(statusFilter ? { status: statusFilter } : {}) },
        orderBy: { createdAt: "desc" },
        take: 5000,
        select: {
          id: true, category: true, status: true, priority: true, source: true,
          summary: true, slaDueAt: true, slaBreachedAt: true, createdAt: true,
          guest: { select: { fullName: true } }
        }
      });
      const brand = await loadReportBrand(tenantId);
      const rows: Array<Array<unknown>> = items.map((s) => [
        s.id, s.guest?.fullName ?? "", s.category, s.status, s.priority ?? "", s.source,
        s.summary ?? "", s.slaDueAt?.toISOString() ?? "", s.slaBreachedAt ? "yes" : "no",
        s.createdAt.toISOString()
      ]);
      const header = ["ID", "Contact", "Category", "Status", "Priority", "Source", "Summary", "SLA due", "SLA breached", "Created"];
      const csv = brandedCsv(brand, "Service Requests", { header, rows });
      sendDoc(res, "text/csv; charset=utf-8", csv, `service-requests-${new Date().toISOString().slice(0, 10)}.csv`);
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

    if (req.url === "/context" && req.method === "GET") {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;

      const hasAccess = await ensureTenantAccess(auth.context.tenantId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      if (!canAccess(auth.context.permissions, "GET /context")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }
      json(res, 200, { ok: true, context: auth.context });
      return;
    }

    // ── PATCH /me — the signed-in user updates their own basic profile ──────────
    // Any authenticated user may edit their own display name. Email is the login
    // identity (managed by the auth provider) and is intentionally not editable here.
    if (req.url === "/me" && req.method === "PATCH") {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const body = (await parseBody(req)) as { fullName?: unknown };
      const fullName = asTrimmedString(body.fullName);
      if (!fullName) { json(res, 400, { ok: false, error: "Full name cannot be empty" }); return; }
      const updated = await prisma.user.update({
        where: { id: auth.context.userId },
        data: { fullName },
        select: { id: true, fullName: true },
      });
      json(res, 200, { ok: true, user: updated });
      return;
    }

    // ── GET/PATCH /me/notifications — per-user bell notification preferences ─────
    // These map 1:1 to the categories the top-bar bell (GET /notifications) can
    // show, so toggling one genuinely hides/shows that category for this user.
    if (req.url === "/me/notifications" && (req.method === "GET" || req.method === "PATCH")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const userId = auth.context.userId;

      if (req.method === "GET") {
        const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
        json(res, 200, { ok: true, prefs: parseNotificationPrefs(u?.notificationPrefs ?? null) });
        return;
      }
      // PATCH — merge the provided booleans onto the current prefs.
      const body = (await parseBody(req)) as Record<string, unknown>;
      const u = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPrefs: true } });
      const current = parseNotificationPrefs(u?.notificationPrefs ?? null);
      const next = {
        escalations: typeof body.escalations === "boolean" ? body.escalations : current.escalations,
        inventory: typeof body.inventory === "boolean" ? body.inventory : current.inventory,
        quotes: typeof body.quotes === "boolean" ? body.quotes : current.quotes,
      };
      await prisma.user.update({ where: { id: userId }, data: { notificationPrefs: JSON.stringify(next) } });
      json(res, 200, { ok: true, prefs: next });
      return;
    }

    // ── Tenant profile (property details shown in Settings) ─────────────────────
    if (req.url === "/tenant/profile" && (req.method === "GET" || req.method === "PATCH")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const { tenantId, permissions } = auth.context;
      if (!(await ensureTenantAccess(tenantId))) {
        json(res, 403, { ok: false, error: "Tenant not found or access denied" });
        return;
      }
      if (!canAccess(permissions, `${req.method} /tenant/profile`)) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

      if (req.method === "GET") {
        const t = await prisma.tenant.findUnique({
          where: { id: tenantId },
          select: { name: true, timezone: true, address: true, phone: true },
        });
        json(res, 200, { ok: true, profile: t });
        return;
      }

      // PATCH — update property details. Only fields present in the body change.
      const body = (await parseBody(req)) as { name?: unknown; timezone?: unknown; address?: unknown; phone?: unknown };
      const data: { name?: string; timezone?: string; address?: string | null; phone?: string | null } = {};
      if (body.name !== undefined) {
        const name = asTrimmedString(body.name);
        if (!name) { json(res, 400, { ok: false, error: "Property name cannot be empty" }); return; }
        data.name = name;
      }
      if (body.timezone !== undefined) {
        const tz = asTrimmedString(body.timezone);
        if (!tz) { json(res, 400, { ok: false, error: "Timezone cannot be empty" }); return; }
        data.timezone = tz;
      }
      if (body.address !== undefined) data.address = asTrimmedString(body.address);
      if (body.phone !== undefined) data.phone = asTrimmedString(body.phone);
      const t = await prisma.tenant.update({
        where: { id: tenantId },
        data,
        select: { name: true, timezone: true, address: true, phone: true },
      });
      json(res, 200, { ok: true, profile: t });
      return;
    }

    // ── Tenant branding (white-label) ───────────────────────────────────────────
    if (req.url === "/tenant/branding" && (req.method === "GET" || req.method === "PUT")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const { tenantId, permissions } = auth.context;
      if (!(await ensureTenantAccess(tenantId))) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }
      if (!canAccess(permissions, `${req.method} /tenant/branding`)) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

      if (req.method === "GET") {
        const [branding, tenant] = await Promise.all([
          prisma.tenantBranding.findUnique({ where: { tenantId }, select: BRANDING_SELECT }),
          prisma.tenant.findUnique({ where: { id: tenantId }, select: { whitelabelTier: true } }),
        ]);
        // The tier is read-only here (set via the provisioning console) — the panel
        // uses it to gate which white-label controls a tenant may edit (E-9).
        json(res, 200, { ok: true, branding: branding ?? null, whitelabelTier: tenant?.whitelabelTier ?? "standard" });
        return;
      }

      // PUT — upsert this tenant's branding (partial overrides; blanks reset to default).
      const data = sanitizeBranding((await parseBody(req)) as Record<string, unknown>);
      const branding = await prisma.tenantBranding.upsert({
        where: { tenantId },
        create: { tenantId, ...data },
        update: data,
        select: BRANDING_SELECT,
      });
      json(res, 200, { ok: true, branding });
      return;
    }

    // ── Tenant white-label routing identity (slug + custom domain) ──────────────
    if (req.url === "/tenant/domains" && (req.method === "GET" || req.method === "PUT")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const { tenantId, permissions } = auth.context;
      if (!(await ensureTenantAccess(tenantId))) {
        json(res, 403, { ok: false, error: "Tenant not found or access denied" });
        return;
      }
      if (!canAccess(permissions, `${req.method} /tenant/domains`)) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

      if (req.method === "GET") {
        const t = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { slug: true, customDomain: true } });
        json(res, 200, { ok: true, slug: t?.slug ?? null, customDomain: t?.customDomain ?? null });
        return;
      }

      // PUT — customers self-serve only their *.eynis.com subdomain (slug). The
      // custom CNAME domain is provider-managed (E-10): it needs DNS/SSL set up by
      // us, so it's set via the internal provisioning console, not here. Reject any
      // attempt to self-set a custom domain and point them at the request path.
      const body = (await parseBody(req)) as { slug?: unknown; customDomain?: unknown };
      if ("customDomain" in body) {
        json(res, 403, { ok: false, error: "Custom domains are provisioned by our team — use Request a custom domain to ask for one." });
        return;
      }
      const data: { slug?: string | null } = {};
      if ("slug" in body) {
        const s = asTrimmedString(body.slug)?.toLowerCase() ?? null;
        if (s !== null && !/^[a-z0-9](?:[a-z0-9-]{0,30}[a-z0-9])?$/.test(s)) {
          json(res, 400, { ok: false, error: "slug must be 2–32 chars: lowercase letters, numbers, hyphens" });
          return;
        }
        data.slug = s;
      }
      try {
        const updated = await prisma.tenant.update({ where: { id: tenantId }, data, select: { slug: true, customDomain: true } });
        json(res, 200, { ok: true, slug: updated.slug, customDomain: updated.customDomain });
      } catch (e) {
        // Unique constraint (P2002) → slug/domain already claimed by another tenant.
        if ((e as { code?: string }).code === "P2002") {
          json(res, 409, { ok: false, error: "That slug or domain is already in use" });
          return;
        }
        throw e;
      }
      return;
    }

    // ── Request a custom domain (E-10) — customer-initiated, provider-fulfilled ──
    // Customers can't self-set a CNAME (provider-managed). They ask for one here;
    // the request is written to the audit log so Eynis staff can action it from
    // the provisioning console. Intentionally lightweight — no new model.
    if (req.url === "/tenant/domains/request" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /tenant/domains/request");
      if (!auth.ok) return;
      const { tenantId } = auth.context;
      if (!(await ensureTenantAccess(tenantId))) {
        json(res, 403, { ok: false, error: "Tenant not found or access denied" });
        return;
      }
      const body = (await parseBody(req)) as { desiredDomain?: unknown; note?: unknown };
      const desiredDomain = asTrimmedString(body.desiredDomain)?.toLowerCase() ?? null;
      await prisma.auditLog.create({
        data: {
          tenantId,
          actorRole: "tenant_admin",
          action: "tenant.custom_domain_requested",
          entityType: "tenant",
          entityId: tenantId,
          metadata: JSON.stringify({
            desiredDomain,
            note: asTrimmedString(body.note) ?? null,
            requestedBy: auth.context.email ?? null,
          }),
        },
      });
      json(res, 200, { ok: true });
      return;
    }

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

      const { sendWhatsAppReply } = await import("./core/connectors/whatsapp-outbound");
      const result = await sendWhatsAppReply(auth.context.tenantId, toPhone, message);
      json(res, result.sent ? 200 : 503, { ok: result.sent, ...result });
      return;
    }

    if (req.url === "/service-requests" && req.method === "POST") {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const context = auth.context;
      const hasAccess = await ensureTenantAccess(context.tenantId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }
      if (!canAccess(context.permissions, "POST /service-requests")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

      const body = (await parseBody(req)) as {
        guestId?: unknown;
        guestName?: unknown;
        guestPhone?: unknown;
        category?: unknown;
        summary?: unknown;
        source?: unknown;
        priority?: unknown;
        slaMinutes?: unknown;
      };

      let guestId: string | null = null;
      const guestIdInput = asTrimmedString(body.guestId);
      const guestNameInput = asTrimmedString(body.guestName);
      const guestPhoneInput = asTrimmedString(body.guestPhone);
      const categoryInput = asTrimmedString(body.category);
      const summaryInput = asTrimmedString(body.summary);
      const sourceInput = asTrimmedString(body.source) ?? "whatsapp";
      const priorityInput = asTrimmedString(body.priority) ?? "normal";
      const slaMinutes = asPositiveInt(body.slaMinutes);
      const slaDueAt = slaMinutes ? new Date(Date.now() + slaMinutes * 60 * 1000) : null;

      if (!categoryInput || !summaryInput) {
        json(res, 400, { ok: false, error: "category and summary are required" });
        return;
      }

      if (guestIdInput) {
        const guest = await prisma.contact.findFirst({
          where: { id: guestIdInput, tenantId: context.tenantId },
          select: { id: true }
        });
        if (!guest) {
          json(res, 404, { ok: false, error: "Guest not found for this hotel" });
          return;
        }
        guestId = guest.id;
      } else if (guestNameInput && guestPhoneInput) {
        const guest = await prisma.contact.create({
          data: {
            tenantId: context.tenantId,
            fullName: guestNameInput,
            phoneE164: guestPhoneInput
          }
        });
        guestId = guest.id;
      } else {
        json(res, 400, {
          ok: false,
          error: "Provide either guestId or both guestName and guestPhone"
        });
        return;
      }

      const serviceRequest = await prisma.serviceRequest.create({
        data: {
          tenantId: context.tenantId,
          guestId,
          category: categoryInput,
          status: "open",
          source: sourceInput,
          summary: summaryInput,
          // Front-line operators self-assign requests they log. Key off the
          // canonical roleKey ("manager" ≡ legacy "front_desk"), falling back to
          // the deprecated legacy role only for older tokens (F-35).
          assignedToUserId: (context.roleKey === "manager" || context.role === "front_desk") ? context.userId : null,
          priority: priorityInput,
          slaDueAt
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

      await prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorRole: context.role,
        action: "service_request.created",
        entityType: "service_request",
          entityId: serviceRequest.id,
          metadata: JSON.stringify({
            source: serviceRequest.source,
            category: serviceRequest.category
          })
        }
      });

      json(res, 201, { ok: true, item: serviceRequest });
      return;
    }

    // Match only the collection (with or without query string), NOT sub-resources
    // like /service-requests/:id/transitions — otherwise this broad list handler
    // shadows the specific routes declared below it (F-7).
    if ((req.url === "/service-requests" || req.url?.startsWith("/service-requests?")) && req.method === "GET") {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const context = auth.context;
      const hasAccess = await ensureTenantAccess(context.tenantId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      if (!canAccess(context.permissions, "GET /service-requests")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const statusFilter = asTrimmedString(parsedUrl.searchParams.get("status"));
      const onlyAssigned = parsedUrl.searchParams.get("assignedToMe") === "true";
      const slaState = asTrimmedString(parsedUrl.searchParams.get("slaState")); // pending|breached
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const sortByInput = asTrimmedString(parsedUrl.searchParams.get("sortBy")) ?? "createdAt";
      const sortOrderInput = asTrimmedString(parsedUrl.searchParams.get("sortOrder")) ?? "desc";
      const sortBy =
        sortByInput === "slaDueAt" || sortByInput === "status" ? sortByInput : "createdAt";
      const sortOrder = sortOrderInput === "asc" ? "asc" : "desc";

      const where: {
        tenantId: string;
        status?: string;
        assignedToUserId?: string;
        slaDueAt?: { not: null; gte?: Date; lt?: Date };
      } = { tenantId: context.tenantId };
      if (statusFilter) {
        where.status = statusFilter;
      }
      if (onlyAssigned) {
        where.assignedToUserId = context.userId;
      }
      if (slaState === "pending") {
        where.slaDueAt = { not: null, gte: new Date() };
      }
      if (slaState === "breached") {
        where.slaDueAt = { not: null, lt: new Date() };
      }

      const [items, total] = await Promise.all([
        prisma.serviceRequest.findMany({
          where,
          orderBy: { [sortBy]: sortOrder },
          skip: offset,
          take: limit,
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
        }),
        prisma.serviceRequest.count({ where })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    if (req.url === "/service-requests/sla/refresh" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /service-requests/sla/refresh");
      if (!auth.ok) return;
      const context = auth.context;

      const now = new Date();
      const result = await prisma.serviceRequest.updateMany({
        where: {
          tenantId: context.tenantId,
          status: { not: "resolved" },
          slaDueAt: { not: null, lt: now },
          slaBreachedAt: null
        },
        data: {
          slaBreachedAt: now
        }
      });

      json(res, 200, { ok: true, breachedMarked: result.count });
      return;
    }

    const requestId = parseServiceRequestStatusPath(req.url);
    if (requestId && req.method === "PATCH") {
      const auth = await authorize(req, res, "PATCH /service-requests/:id/status");
      if (!auth.ok) return;
      const context = auth.context;

      const body = (await parseBody(req)) as { status?: unknown };
      const nextStatus = asTrimmedString(body.status);
      if (!nextStatus || !["accepted", "resolved", "escalated"].includes(nextStatus)) {
        json(res, 400, {
          ok: false,
          error: "status must be one of: accepted, resolved, escalated"
        });
        return;
      }

      const existing = await prisma.serviceRequest.findFirst({
        where: { id: requestId, tenantId: context.tenantId },
        select: { id: true, status: true }
      });
      if (!existing) {
        json(res, 404, { ok: false, error: "Service request not found" });
        return;
      }
      if (existing.status === "resolved") {
        json(res, 409, { ok: false, error: "Resolved request cannot transition" });
        return;
      }

      const updated = await prisma.serviceRequest.update({
        where: { id: requestId },
        data: {
          status: nextStatus,
          resolvedAt: nextStatus === "resolved" ? new Date() : null
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
          createdAt: true,
          resolvedAt: true
        }
      });

      await prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorRole: context.role,
          action: "service_request.status_changed",
          entityType: "service_request",
          entityId: updated.id,
          metadata: JSON.stringify({
            from: existing.status,
            to: nextStatus,
            actorEmail: context.email
          })
        }
      });

      await prisma.serviceRequestTransition.create({
        data: {
          tenantId: context.tenantId,
          serviceRequestId: updated.id,
          fromStatus: existing.status,
          toStatus: nextStatus,
          changedByUserId: context.userId
        }
      });

      // Attribution (#167): a resolved request is an attributed outcome. Best-effort
      // — a recording hiccup must never fail the status change. Idempotent by source.
      if (nextStatus === "resolved") {
        const tRow = await prisma.tenant.findUnique({ where: { id: context.tenantId }, select: { industry: true } });
        await recordServiceRequestResolution({
          tenantId: context.tenantId,
          industry: tRow?.industry ?? null,
          serviceRequestId: updated.id,
          category: updated.category,
          occurredAt: updated.resolvedAt ?? undefined,
        }).catch((e) => console.warn("[attribution] record resolution failed:", e instanceof Error ? e.message : e));
      }

      broadcastSSEEvent(context.tenantId, { type: "sr_updated", data: { id: updated.id, status: nextStatus } });
      json(res, 200, { ok: true, item: updated });
      return;
    }

    if (req.url === "/dashboard/overview" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /dashboard/overview");
      if (!auth.ok) return;
      const context = auth.context;
      const [openCount, resolvedTodayCount, escalatedOpenCount, slaBreachedOpenCount] =
        await Promise.all([
          prisma.serviceRequest.count({
            where: { tenantId: context.tenantId, status: { not: "resolved" } }
          }),
          prisma.serviceRequest.count({
            where: {
              tenantId: context.tenantId,
              status: "resolved",
              resolvedAt: { gte: new Date(new Date().setHours(0, 0, 0, 0)) }
            }
          }),
          prisma.serviceRequest.count({
            where: { tenantId: context.tenantId, status: "escalated" }
          }),
          prisma.serviceRequest.count({
            where: {
              tenantId: context.tenantId,
              status: { not: "resolved" },
              slaDueAt: { not: null, lt: new Date() }
            }
          })
        ]);

      json(res, 200, {
        ok: true,
        metrics: {
          openCount,
          resolvedTodayCount,
          escalatedOpenCount,
          slaBreachedOpenCount
        }
      });
      return;
    }

    // Real notification feed for the top-bar bell. Aggregates the tenant's live
    // operational signals — SLA-breached / escalated requests, low-stock items,
    // and quotes about to expire — instead of the hard-coded sample list the UI
    // used to show. Each source is gated by the caller's own permission, so a
    // viewer only sees what they may read. Industry-neutral copy; the records
    // themselves are the tenant's, so they read correctly for any vertical.
    if (req.url === "/notifications" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /notifications");
      if (!auth.ok) return;
      const context = auth.context;
      const perms = context.permissions;
      const now = new Date();
      const soon = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000); // next 3 days

      type Notif = { id: string; type: "alert" | "info" | "success"; title: string; body: string; at: string; href: string };

      // Gate each source by BOTH the caller's permission AND their own
      // notification preferences (escalations/inventory/quotes toggles in Settings).
      const me = await prisma.user.findUnique({ where: { id: context.userId }, select: { notificationPrefs: true } });
      const prefs = parseNotificationPrefs(me?.notificationPrefs ?? null);
      const canRequests = canAccess(perms, "GET /service-requests") && prefs.escalations;
      const canInventory = canAccess(perms, "GET /inventory/items") && prefs.inventory;
      const canQuotes = canAccess(perms, "GET /quotes") && prefs.quotes;

      const [breached, escalated, inventory, expiring] = await Promise.all([
        canRequests
          ? prisma.serviceRequest.findMany({
              where: { tenantId: context.tenantId, status: { not: "resolved" }, slaBreachedAt: { not: null } },
              orderBy: { slaBreachedAt: "desc" }, take: 6,
              select: { id: true, summary: true, slaBreachedAt: true },
            })
          : Promise.resolve([] as { id: string; summary: string; slaBreachedAt: Date | null }[]),
        canRequests
          ? prisma.serviceRequest.findMany({
              where: { tenantId: context.tenantId, status: "escalated", slaBreachedAt: null },
              orderBy: { createdAt: "desc" }, take: 6,
              select: { id: true, summary: true, createdAt: true },
            })
          : Promise.resolve([] as { id: string; summary: string; createdAt: Date }[]),
        // Prisma can't compare two columns (stock <= reorderLevel) in a where, so
        // pull a bounded set and filter in JS — tenant inventories are small.
        canInventory
          ? prisma.inventoryItem.findMany({
              where: { tenantId: context.tenantId },
              orderBy: { updatedAt: "desc" }, take: 200,
              select: { id: true, name: true, stock: true, unit: true, reorderLevel: true, updatedAt: true },
            })
          : Promise.resolve([] as { id: string; name: string; stock: number; unit: string; reorderLevel: number; updatedAt: Date }[]),
        canQuotes
          ? prisma.quote.findMany({
              where: { tenantId: context.tenantId, status: "sent", validUntil: { not: null, gte: now, lte: soon } },
              orderBy: { validUntil: "asc" }, take: 6,
              select: { id: true, number: true, title: true, validUntil: true },
            })
          : Promise.resolve([] as { id: string; number: string; title: string; validUntil: Date | null }[]),
      ]);

      const items: Notif[] = [];
      for (const s of breached) {
        items.push({ id: `sr-breach-${s.id}`, type: "alert", title: `Overdue: ${s.summary}`, body: "Past its SLA deadline — needs attention", at: (s.slaBreachedAt ?? now).toISOString(), href: "/queue" });
      }
      for (const s of escalated) {
        items.push({ id: `sr-esc-${s.id}`, type: "alert", title: `Escalated: ${s.summary}`, body: "Escalated for follow-up", at: s.createdAt.toISOString(), href: "/queue" });
      }
      for (const it of inventory.filter((i) => i.stock <= i.reorderLevel).slice(0, 6)) {
        items.push({ id: `inv-${it.id}`, type: "alert", title: `${it.name} is low on stock`, body: `${it.stock} ${it.unit} left · reorder level ${it.reorderLevel}`, at: it.updatedAt.toISOString(), href: "/inventory" });
      }
      for (const q of expiring) {
        items.push({ id: `quote-${q.id}`, type: "info", title: `Quote ${q.number} expiring soon`, body: `${q.title} · valid until ${q.validUntil!.toISOString().slice(0, 10)}`, at: q.validUntil!.toISOString(), href: "/quotes" });
      }

      // Alerts first, then by recency. Cap the feed so the dropdown stays tidy.
      const severity = (t: Notif["type"]) => (t === "alert" ? 0 : t === "info" ? 1 : 2);
      items.sort((a, b) => severity(a.type) - severity(b.type) || b.at.localeCompare(a.at));

      json(res, 200, { ok: true, items: items.slice(0, 12) });
      return;
    }

    if (req.url === "/dashboard/queue-summary" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /dashboard/queue-summary");
      if (!auth.ok) return;
      const context = auth.context;

      const rows = await prisma.serviceRequest.findMany({
        where: { tenantId: context.tenantId, status: { not: "resolved" } },
        select: { status: true, priority: true, category: true }
      });

      const byStatus: Record<string, number> = {};
      const byPriority: Record<string, number> = {};
      const byCategory: Record<string, number> = {};
      for (const row of rows) {
        byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
        byPriority[row.priority] = (byPriority[row.priority] ?? 0) + 1;
        byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
      }

      json(res, 200, {
        ok: true,
        totalOpen: rows.length,
        byStatus,
        byPriority,
        byCategory
      });
      return;
    }

    if (req.url?.startsWith("/dashboard/trends") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /dashboard/overview");
      if (!auth.ok) return;
      const context = auth.context;

      const parsedUrl = parseUrl(req.url);
      const days = asSafeLimit(parsedUrl.searchParams.get("days"), 7, 30);
      const now = new Date();
      const windowStart = new Date(now);
      windowStart.setHours(0, 0, 0, 0);
      windowStart.setDate(windowStart.getDate() - (days - 1));

      const [createdRows, resolvedRows] = await Promise.all([
        prisma.serviceRequest.findMany({
          where: { tenantId: context.tenantId, createdAt: { gte: windowStart } },
          select: { createdAt: true }
        }),
        prisma.serviceRequest.findMany({
          where: {
            tenantId: context.tenantId,
            status: "resolved",
            resolvedAt: { not: null, gte: windowStart }
          },
          select: { resolvedAt: true }
        })
      ]);

      const buckets = new Map<string, { date: string; created: number; resolved: number }>();
      for (let i = 0; i < days; i += 1) {
        const d = new Date(windowStart);
        d.setDate(windowStart.getDate() + i);
        const key = d.toISOString().slice(0, 10);
        buckets.set(key, { date: key, created: 0, resolved: 0 });
      }
      for (const row of createdRows) {
        const key = row.createdAt.toISOString().slice(0, 10);
        const current = buckets.get(key);
        if (current) current.created += 1;
      }
      for (const row of resolvedRows) {
        if (!row.resolvedAt) continue;
        const key = row.resolvedAt.toISOString().slice(0, 10);
        const current = buckets.get(key);
        if (current) current.resolved += 1;
      }

      json(res, 200, { ok: true, days, series: Array.from(buckets.values()) });
      return;
    }

    // ── Analytics router (#164): extracted to core/analytics/routes.ts ───────
    if (await handleAnalyticsRoutes(req, res)) return;

    if (req.url === "/connectors/registry" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /connectors/registry");
      if (!auth.ok) return;
      const context = auth.context;

      const configs = await prisma.connectorConfig.findMany({
        where: { tenantId: context.tenantId },
        select: { connectorKey: true, enabled: true, configJson: true }
      });
      const configMap = new Map(configs.map((c) => [c.connectorKey, c]));
      const items = connectorRegistry.map((item) => {
        const persisted = configMap.get(item.key);
        const envEnabled = String(process.env[item.envFlag] ?? "").toLowerCase() === "true";
        const enabled = persisted ? persisted.enabled : envEnabled;
        let savedConfig: Record<string, unknown> = {};
        if (persisted) {
          try { const m = JSON.parse(persisted.configJson) as Record<string, unknown>; if (m && typeof m === "object") savedConfig = m; } catch { /* ignore */ }
        }
        const status = item.planned ? "planned" : enabled ? "connected" : "disabled";
        return {
          key: item.key,
          category: item.category,
          categoryLabel: CONNECTOR_CATEGORY_LABELS[item.category] ?? item.category,
          name: item.name,
          description: item.description,
          icon: item.icon,
          brandColor: item.brandColor,
          requiredFields: item.requiredFields,
          planned: item.planned,
          enabled,
          status,
          source: persisted ? ("hotel_config" as const) : ("env" as const),
          ingestModes: item.ingestModes,
          config: maskConnectorConfig(savedConfig)
        };
      });
      json(res, 200, { ok: true, items });
      return;
    }

    if (req.url?.startsWith("/connectors/configs") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /connectors/configs");
      if (!auth.ok) return;
      const context = auth.context;

      const items = await prisma.connectorConfig.findMany({
        where: { tenantId: context.tenantId },
        orderBy: { connectorKey: "asc" },
        select: { connectorKey: true, enabled: true, configJson: true, updatedAt: true }
      });
      json(res, 200, {
        ok: true,
        items: items.map((item) => {
          let parsed: Record<string, unknown> = {};
          try {
            const maybe = JSON.parse(item.configJson) as Record<string, unknown>;
            parsed = maybe && typeof maybe === "object" ? maybe : {};
          } catch {
            parsed = {};
          }
          return {
            key: item.connectorKey,
            enabled: item.enabled,
            config: maskConnectorConfig(parsed),
            updatedAt: item.updatedAt
          };
        })
      });
      return;
    }

    // POST /connectors/configs/:key/test — live-key validation (Phase 8): cheap
    // authenticated ping so a bad credential is caught before a campaign launch.
    const connectorTestMatch = /^\/connectors\/configs\/([^/]+)\/test$/.exec(parseUrl(req.url).pathname);
    if (connectorTestMatch && req.method === "POST") {
      const auth = await authorize(req, res, "POST /connectors/configs/:key/test");
      if (!auth.ok) return;
      const key = decodeURIComponent(connectorTestMatch[1]);
      if (!envFlagByConnectorKey.has(key)) { json(res, 404, { ok: false, error: "Unknown connector key" }); return; }
      const { testConnector } = await import("./core/connectors/test-connection");
      const result = await testConnector(auth.context.tenantId, key);
      if (!result) { json(res, 200, { ok: true, testable: false, detail: "This connector has no live test (file export / on-prem integration)" }); return; }
      json(res, 200, { ok: true, testable: true, passed: result.ok, detail: result.detail });
      return;
    }

    const connectorConfigKey = parseConnectorConfigPath(req.url);
    if (connectorConfigKey && req.method === "PUT") {
      const auth = await authorize(req, res, "PUT /connectors/configs/:key");
      if (!auth.ok) return;
      const context = auth.context;
      if (!envFlagByConnectorKey.has(connectorConfigKey)) {
        json(res, 404, { ok: false, error: "Unknown connector key" });
        return;
      }

      const body = (await parseBody(req)) as { enabled?: unknown; config?: unknown };
      const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
      const incoming = body.config && typeof body.config === "object" ? (body.config as Record<string, unknown>) : {};

      // Merge over the existing config so a re-save doesn't clobber secrets the
      // client never saw: GET masks secret fields as "***", so an unchanged secret
      // comes back empty or as the mask — in that case keep the stored value.
      const existingRow = await prisma.connectorConfig.findUnique({
        where: { tenantId_connectorKey: { tenantId: context.tenantId, connectorKey: connectorConfigKey } },
        select: { configJson: true }
      });
      let existing: Record<string, unknown> = {};
      if (existingRow) {
        try { const m = JSON.parse(existingRow.configJson) as Record<string, unknown>; if (m && typeof m === "object") existing = m; } catch { /* ignore */ }
      }
      const merged: Record<string, unknown> = { ...existing };
      for (const [k, v] of Object.entries(incoming)) {
        if (isSecretKey(k) && (v === "" || v === SECRET_MASK || v == null)) continue; // keep stored secret
        merged[k] = v;
      }
      // Encrypt secret field values at rest (F-… H6). No-op when SECRETS_ENC_KEY is
      // unset (values stay plaintext, unchanged behaviour) and idempotent for values
      // already encrypted (the kept-from-existing case).
      const { encryptSecret } = await import("./core/crypto/secrets");
      for (const k of Object.keys(merged)) {
        if (isSecretKey(k) && typeof merged[k] === "string" && merged[k]) merged[k] = encryptSecret(merged[k] as string);
      }
      const configJson = JSON.stringify(merged);
      const saved = await prisma.connectorConfig.upsert({
        where: { tenantId_connectorKey: { tenantId: context.tenantId, connectorKey: connectorConfigKey } },
        create: {
          tenantId: context.tenantId,
          connectorKey: connectorConfigKey,
          enabled,
          configJson
        },
        update: {
          enabled,
          configJson
        },
        select: { connectorKey: true, enabled: true, configJson: true, updatedAt: true }
      });

      await prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorRole: context.role,
          action: "connector.config.updated",
          entityType: "connector_config",
          entityId: saved.connectorKey,
          metadata: JSON.stringify({ connectorKey: saved.connectorKey, enabled: saved.enabled })
        }
      });

      let parsed: Record<string, unknown> = {};
      try {
        const maybe = JSON.parse(saved.configJson) as Record<string, unknown>;
        parsed = maybe && typeof maybe === "object" ? maybe : {};
      } catch {
        parsed = {};
      }

      json(res, 200, {
        ok: true,
        item: {
          key: saved.connectorKey,
          enabled: saved.enabled,
          config: maskConnectorConfig(parsed),
          updatedAt: saved.updatedAt
        }
      });
      return;
    }

    if (connectorConfigKey && req.method === "DELETE") {
      const auth = await authorize(req, res, "DELETE /connectors/configs/:key");
      if (!auth.ok) return;
      const context = auth.context;

      await prisma.connectorConfig.deleteMany({
        where: { tenantId: context.tenantId, connectorKey: connectorConfigKey }
      });
      await prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorRole: context.role,
          action: "connector.config.deleted",
          entityType: "connector_config",
          entityId: connectorConfigKey,
          metadata: JSON.stringify({ connectorKey: connectorConfigKey })
        }
      });
      json(res, 200, { ok: true });
      return;
    }

    if (req.url?.startsWith("/users") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /users");
      if (!auth.ok) return;
      const context = auth.context;

      const parsedUrl = parseUrl(req.url);
      const roleFilter = asTrimmedString(parsedUrl.searchParams.get("role"));
      const isActiveFilter = asTrimmedString(parsedUrl.searchParams.get("isActive"));
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 50, 200);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));

      const where: { tenantId: string; role?: string; isActive?: boolean } = {
        tenantId: context.tenantId
      };
      if (roleFilter) where.role = roleFilter;
      if (isActiveFilter === "true") where.isActive = true;
      if (isActiveFilter === "false") where.isActive = false;

      const [items, total] = await Promise.all([
        prisma.user.findMany({
          where,
          orderBy: { fullName: "asc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            fullName: true,
            email: true,
            role: true,
            isActive: true
          }
        }),
        prisma.user.count({ where })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    const assignRequestId = parseServiceRequestAssignPath(req.url);
    if (assignRequestId && req.method === "PATCH") {
      const auth = await authorize(req, res, "PATCH /service-requests/:id/assign");
      if (!auth.ok) return;
      const context = auth.context;

      const body = (await parseBody(req)) as { assigneeEmail?: unknown };
      const assigneeEmail = asTrimmedString(body.assigneeEmail)?.toLowerCase();
      if (!assigneeEmail) {
        json(res, 400, { ok: false, error: "assigneeEmail is required" });
        return;
      }

      const assignee = await prisma.user.findFirst({
        where: { tenantId: context.tenantId, email: assigneeEmail, isActive: true },
        select: { id: true, email: true }
      });
      if (!assignee) {
        json(res, 404, { ok: false, error: "Assignee not found in this hotel" });
        return;
      }

      const existing = await prisma.serviceRequest.findFirst({
        where: { id: assignRequestId, tenantId: context.tenantId },
        select: { id: true, assignedToUserId: true }
      });
      if (!existing) {
        json(res, 404, { ok: false, error: "Service request not found" });
        return;
      }

      const updated = await prisma.serviceRequest.update({
        where: { id: assignRequestId },
        data: { assignedToUserId: assignee.id },
        select: { id: true, assignedToUserId: true }
      });

      await prisma.auditLog.create({
        data: {
          tenantId: context.tenantId,
          actorRole: context.role,
          action: "service_request.assigned",
          entityType: "service_request",
          entityId: updated.id,
          metadata: JSON.stringify({
            fromUserId: existing.assignedToUserId,
            toUserId: assignee.id,
            toEmail: assignee.email
          })
        }
      });

      json(res, 200, { ok: true, item: updated });
      return;
    }

    if (req.url?.startsWith("/service-requests/") && req.url.endsWith("/transitions") && req.method === "GET") {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const context = auth.context;
      // Viewing a request's transition history requires the same permission as
      // viewing requests (F-7: this check was missing while the route was dead).
      if (!canAccess(context.permissions, "GET /service-requests")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }
      const transitionRequestId = /^\/service-requests\/([^/]+)\/transitions$/.exec(req.url)?.[1];
      if (!transitionRequestId) {
        json(res, 400, { ok: false, error: "Invalid path" });
        return;
      }

      const exists = await prisma.serviceRequest.findFirst({
        where: { id: transitionRequestId, tenantId: context.tenantId },
        select: { id: true }
      });
      if (!exists) {
        json(res, 404, { ok: false, error: "Service request not found" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const [items, total] = await Promise.all([
        prisma.serviceRequestTransition.findMany({
          where: { tenantId: context.tenantId, serviceRequestId: transitionRequestId },
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            fromStatus: true,
            toStatus: true,
            changedByUserId: true,
            note: true,
            createdAt: true
          }
        }),
        prisma.serviceRequestTransition.count({
          where: { tenantId: context.tenantId, serviceRequestId: transitionRequestId }
        })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    if (req.url === "/audit" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /audit");
      if (!auth.ok) return;
      const context = auth.context;
      const hasAccess = await ensureTenantAccess(context.tenantId);
      if (!hasAccess) {
        json(res, 403, { ok: false, error: "Hotel not found or access denied" });
        return;
      }

      const parsedUrl = parseUrl(req.url);
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const [items, total] = await Promise.all([
        prisma.auditLog.findMany({
          where: { tenantId: context.tenantId },
          orderBy: { createdAt: "desc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            tenantId: true,
            actorRole: true,
            action: true,
            entityType: true,
            entityId: true,
            metadata: true,
            createdAt: true
          }
        }),
        prisma.auditLog.count({ where: { tenantId: context.tenantId } })
      ]);

      json(res, 200, {
        ok: true,
        items,
        page: { limit, offset, total, hasMore: offset + items.length < total }
      });
      return;
    }

    // ── GET /dashboard/live-feed ─────────────────────────────────────────────
    if (req.url?.startsWith("/dashboard/live-feed") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /dashboard/live-feed");
      if (!auth.ok) return;
      const context = auth.context;
      const items = await prisma.serviceRequest.findMany({
        where: { tenantId: context.tenantId, status: { not: "resolved" } },
        orderBy: { createdAt: "desc" },
        take: 8,
        select: {
          id: true,
          category: true,
          status: true,
          summary: true,
          priority: true,
          createdAt: true,
          assignedToUserId: true,
          guest: { select: { fullName: true } },
          assignedTo: { select: { fullName: true } }
        }
      });
      json(res, 200, { ok: true, items });
      return;
    }

    // ── GET /guests/:id ──────────────────────────────────────────────────────
    const guestIdMatch = /^\/guests\/([^/?]+)/.exec(req.url ?? "");
    if (guestIdMatch && req.method === "GET") {
      const auth = await authorize(req, res, "GET /guests/:id");
      if (!auth.ok) return;
      const guestId = guestIdMatch[1]!;
      const { tenantId } = auth.context;
      const guest = await prisma.contact.findFirst({
        where: { id: guestId, tenantId },
        include: {
          stays: { orderBy: { checkInAt: "desc" }, take: 5 },
          serviceRequests: {
            orderBy: { createdAt: "desc" },
            take: 10,
            include: { assignedTo: { select: { fullName: true } } }
          }
        }
      });
      if (!guest) { json(res, 404, { ok: false, error: "Guest not found" }); return; }
      const connectorEvents = await prisma.connectorEvent.findMany({
        where: { tenantId, guestId },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true, connectorKey: true, aiCategory: true, aiSummary: true, aiSentiment: true, replyStatus: true, createdAt: true }
      });
      const totalSpend = await prisma.offerEvent.aggregate({
        where: { tenantId, guestId, status: "accepted" },
        _sum: { revenueInr: true }
      });
      const segments = ["Standard", "Business", "Family", "Solo", "Couple"];
      const segment = guest.visitCount >= 10 ? "VIP" : guest.visitCount >= 5 ? "Valued" : segments[guest.visitCount % segments.length];
      json(res, 200, {
        ok: true,
        guest: {
          id: guest.id, fullName: guest.fullName, phoneE164: guest.phoneE164,
          visitCount: guest.visitCount, segment, totalSpendInr: totalSpend._sum.revenueInr ?? 0,
          createdAt: guest.createdAt,
          currentStay: guest.stays[0] ?? null,
          stays: guest.stays,
          serviceRequests: guest.serviceRequests,
          connectorEvents
        }
      });
      return;
    }

    // ── GET /guests ──────────────────────────────────────────────────────────
    if (req.url?.startsWith("/guests") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /guests");
      if (!auth.ok) return;
      const context = auth.context;
      const parsedUrl = parseUrl(req.url);
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const search = asTrimmedString(parsedUrl.searchParams.get("search"));
      const where = {
        tenantId: context.tenantId,
        ...(search ? { OR: [
          { fullName: { contains: search, mode: "insensitive" as const } },
          { phoneE164: { contains: search, mode: "insensitive" as const } }
        ] } : {})
      };
      const [guests, total] = await Promise.all([
        prisma.contact.findMany({
          where,
          orderBy: { visitCount: "desc" },
          skip: offset,
          take: limit,
          select: {
            id: true,
            fullName: true,
            phoneE164: true,
            visitCount: true,
            createdAt: true,
            stays: {
              orderBy: { checkInAt: "desc" },
              take: 1,
              select: { checkInAt: true, checkOutAt: true, roomNumber: true }
            },
            serviceRequests: {
              select: { id: true }
            }
          }
        }),
        prisma.contact.count({ where })
      ]);
      const segments = ["VIP", "Business", "Family", "Solo", "Couple"];
      const items = guests.map((g, i) => ({
        id: g.id,
        fullName: g.fullName,
        phoneE164: g.phoneE164,
        visitCount: g.visitCount,
        segment: g.visitCount >= 10 ? "VIP" : segments[(i + g.visitCount) % segments.length],
        status: g.stays[0]?.checkOutAt && new Date(g.stays[0].checkOutAt) < new Date() ? "CHECK-OUT" : "ACTIVE",
        lastStay: g.stays[0]?.checkInAt ?? g.createdAt,
        totalRequests: g.serviceRequests.length,
        createdAt: g.createdAt
      }));
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return;
    }

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
