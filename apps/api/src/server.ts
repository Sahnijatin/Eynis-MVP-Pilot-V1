import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { InMemoryEventBus } from "./events/event-bus";
import { prisma } from "./db/prisma";
import type { UserRole, SystemRoleKey } from "@eynis/shared";
import { isValidConsentSource } from "@eynis/shared";
import { createAuthToken, parseBearerToken, verifyAuthToken } from "./core/auth";
import { normalizeWhatsappInbound } from "./core/connectors/whatsapp";
import { ingestConnectorEvent } from "./core/connectors/ingest";
import {
  AI_AVAILABLE,
  CLAUDE_AVAILABLE,
  OPENAI_AVAILABLE,
  type AIProvider,
  classifyInboundEvent,
  generateGuestIntelligence,
  generateMorningBriefing,
  generateRevenueInsights,
  generateNightAuditReport,
  type NightAuditData
} from "./core/ai/intelligence";
import { startAutomationWorker } from "./core/automations/engine";
import { startCampaignDispatchWorker } from "./core/campaigns/dispatch";
import { startCampaignWorker } from "./core/campaigns/worker";
import { startSequenceWorker } from "./core/campaigns/sequence-runner";
import { registerSSEClient, removeSSEClient, broadcastSSEEvent } from "./sse/clients";
import { checkWebhookSignature, verifySharedWebhookSecret } from "./core/connectors/webhook-verify";
import { processResendEvent, verifyResendSignature } from "./core/email/resend-webhook";
import { randomBytes } from "node:crypto";
import { parsePermissions, getPermissionsForLegacyRole, hasPermission, isWithinSeatLimit, legacyRoleFor, seedDefaultRolesForHotel, seedLicenseForHotel } from "./core/rbac";
import { enforceLicenseFeature } from "./core/license";
import { type Permission, ALL_PERMISSIONS } from "./core/permissions";

const eventBus = new InMemoryEventBus();

eventBus.subscribe("service_request.created", (event) => {
  // Placeholder for upcoming Day 3 worker hooks.
  void event;
});

const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

const parseRawBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf8").trim();
};

const parseBody = async (req: IncomingMessage): Promise<unknown> => {
  const raw = await parseRawBody(req);
  if (!raw) return {};
  return JSON.parse(raw);
};

const hasString = (value: unknown) => typeof value === "string" && value.trim().length > 0;
const asTrimmedString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
const asPositiveInt = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isInteger(parsed) && parsed > 0) {
      return parsed;
    }
  }
  return null;
};
const parseUrl = (url: string | undefined) => new URL(url ?? "/", "http://localhost");
const asSafeLimit = (value: string | null, fallback: number, max: number) => {
  const parsed = asPositiveInt(value);
  if (!parsed) {
    return fallback;
  }
  return Math.min(parsed, max);
};
const asSafeOffset = (value: string | null) => {
  const parsed = Number(value ?? 0);
  if (!Number.isInteger(parsed) || parsed < 0) {
    return 0;
  }
  return parsed;
};

const ensureTenantAccess = async (tenantId: string) => {
  const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  return Boolean(hotel);
};

// ── Tenant branding (white-label) ──────────────────────────────────────────────
// Fields the client may read/write. `id`/`tenantId`/timestamps are never client-set.
const BRANDING_SELECT = {
  brandName: true, tagline: true, logoUrl: true, faviconUrl: true,
  primaryColor: true, accentColor: true, supportEmail: true, hidePoweredBy: true,
} as const;

// Coerce/validate an inbound branding payload into the writable columns. Strings
// are trimmed; blanks become null (so clearing a field resets to industry default).
const sanitizeBranding = (body: Record<string, unknown>) => {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const color = (v: unknown): string | null => {
    const s = str(v);
    return s && /^#[0-9a-fA-F]{6}$/.test(s) ? s : null; // only accept #rrggbb
  };
  return {
    brandName: str(body.brandName),
    tagline: str(body.tagline),
    logoUrl: str(body.logoUrl),
    faviconUrl: str(body.faviconUrl),
    primaryColor: color(body.primaryColor),
    accentColor: color(body.accentColor),
    supportEmail: str(body.supportEmail),
    hidePoweredBy: body.hidePoweredBy === true,
  };
};

const normalizePhone = (value: string) => value.replace(/\s+/g, "");

const upsertContactByPhone = async (tenantId: string, fullName: string, phoneE164: string) => {
  const existing = await prisma.contact.findFirst({
    where: { tenantId, phoneE164 },
    select: { id: true }
  });
  if (existing) {
    return existing.id;
  }
  const guest = await prisma.contact.create({
    data: { tenantId, fullName, phoneE164 },
    select: { id: true }
  });
  return guest.id;
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

const authError = "Missing or invalid bearer token";

const getAuthenticatedContext = async (req: IncomingMessage) => {
  const token = parseBearerToken(req);
  if (!token) {
    return { ok: false as const, status: 401, error: authError };
  }
  const claims = await verifyAuthToken(token);
  if (!claims) {
    return { ok: false as const, status: 401, error: authError };
  }

  const user = await prisma.user.findFirst({
    where: {
      id: claims.sub,
      tenantId: claims.tenantId,
      email: claims.email,
      // Legacy tokens pin the hospitality role for a consistency check; modern
      // roleKey-only tokens identify by sub+hotel+email (permissions come from
      // the live systemRole below, so dropping the role pin is not a downgrade).
      ...(claims.role ? { role: claims.role } : {}),
      isActive: true
    },
    select: {
      id: true,
      tenantId: true,
      email: true,
      role: true,
      fullName: true,
      roleId: true,
      systemRole: { select: { permissions: true, key: true, tenantId: true } }
    }
  });

  if (!user) {
    return { ok: false as const, status: 401, error: "User not found or role mismatch" };
  }

  // Load permissions from the Role record if assigned AND that role belongs to the
  // same hotel as the user. The hotel check is defense-in-depth: a User must never
  // inherit permissions from a Role that belongs to a different tenant, even if a
  // stale/cross-hotel roleId was somehow persisted. Fall back to the legacy mapping.
  const roleBelongsToHotel = user.systemRole?.tenantId === user.tenantId;
  const permissions: string[] = user.systemRole && roleBelongsToHotel
    ? parsePermissions(user.systemRole.permissions)
    : getPermissionsForLegacyRole(user.role);

  return {
    ok: true as const,
    context: {
      tenantId: user.tenantId,
      role: user.role as UserRole, // legacy; retained for audit/domain compat
      roleKey: user.systemRole?.key ?? claims.roleKey ?? null, // canonical generic role
      email: user.email,
      userId: user.id,
      fullName: user.fullName,
      sub: user.id,
      permissions
    }
  };
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

const parseGuestIntelligencePath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/ai\/guest-intelligence\/([^/?]+)/.exec(parseUrl(url).pathname);
  return match?.[1] ? decodeURIComponent(match[1]) : null;
};

const parseAIProvider = (url: string | undefined): AIProvider => {
  const p = parseUrl(url).searchParams.get("provider");
  return p === "openai" ? "openai" : "claude";
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

// Voice campaign routing: /campaigns, /campaigns/:id, /campaigns/:id/:action
const CAMPAIGN_ACTIONS = new Set(["activate", "pause", "complete"]);
const parseCampaignPath = (
  url: string | undefined,
): { id: string; action: string | null } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  const match = /^\/campaigns\/([^/]+)(?:\/([^/]+))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  const action = match[2] ? decodeURIComponent(match[2]) : null;
  if (action !== null && !CAMPAIGN_ACTIONS.has(action)) return null; // leave /leads, /calls etc. to later phases
  return { id: decodeURIComponent(match[1]), action };
};

// Calls routing: /campaigns/:id/calls, /campaigns/:id/calls/:callId
const parseCampaignCallsPath = (
  url: string | undefined,
): { campaignId: string; callId: string | null } | null => {
  if (!url) return null;
  const match = /^\/campaigns\/([^/]+)\/calls(?:\/([^/]+))?$/.exec(parseUrl(url).pathname);
  if (!match || !match[1]) return null;
  return { campaignId: decodeURIComponent(match[1]), callId: match[2] ? decodeURIComponent(match[2]) : null };
};

// Analytics routing: /campaigns/:id/analytics
const parseCampaignAnalyticsPath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/campaigns\/([^/]+)\/analytics$/.exec(parseUrl(url).pathname);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

// Deliveries routing: /campaigns/:id/deliveries  (messaging activity feed)
const parseCampaignDeliveriesPath = (url: string | undefined): string | null => {
  if (!url) return null;
  const match = /^\/campaigns\/([^/]+)\/deliveries$/.exec(parseUrl(url).pathname);
  return match && match[1] ? decodeURIComponent(match[1]) : null;
};

// Segments routing: /segments, /segments/:id, /segments/:id/preview
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
const parseCampaignLeadsPath = (
  url: string | undefined,
): { campaignId: string; leadId: string | null; isImport: boolean } | null => {
  if (!url) return null;
  const { pathname } = parseUrl(url);
  const match = /^\/campaigns\/([^/]+)\/leads(?:\/([^/]+))?$/.exec(pathname);
  if (!match || !match[1]) return null;
  const sub = match[2] ? decodeURIComponent(match[2]) : null;
  return { campaignId: decodeURIComponent(match[1]), leadId: sub === "import" ? null : sub, isImport: sub === "import" };
};

const permissionMap: Record<string, Permission | null> = {
  "GET /context":                          null,
  "GET /tenant/branding":                  "manage_settings",
  "PUT /tenant/branding":                  "manage_settings",
  "GET /tenant/domains":                   "manage_settings",
  "PUT /tenant/domains":                   "manage_settings",
  "POST /events/service-request-created":  "manage_requests",
  "POST /service-requests":               "manage_requests",
  "GET /service-requests":                "view_requests",
  "PATCH /service-requests/:id/status":   "manage_requests",
  "PATCH /service-requests/:id/assign":   "manage_requests",
  "POST /service-requests/sla/refresh":   "manage_requests",
  "GET /audit":                           "view_reports",
  "GET /dashboard/overview":              "view_requests",
  "GET /dashboard/queue-summary":         "view_requests",
  "GET /dashboard/live-feed":             "view_requests",
  "GET /users":                           "manage_users",
  "GET /guests":                          "view_guests",
  "GET /guests/:id":                      "view_guests",
  "GET /analytics/revenue-intelligence":  "view_reports",
  "GET /analytics/staff-performance":     "view_reports",
  "GET /analytics/sentiment":             "view_reports",
  "GET /analytics/upsell-campaigns":      "manage_campaigns",
  "GET /automations":                     "manage_automations",
  "GET /automations/executions":          "manage_automations",
  "GET /connectors/registry":             "manage_connectors",
  "GET /connectors/configs":              "manage_connectors",
  "PUT /connectors/configs/:key":         "manage_connectors",
  "DELETE /connectors/configs/:key":      "manage_connectors",
  "POST /connectors/events/ingest":       "manage_requests",
  "GET /connectors/events":              "view_requests",
  "POST /connectors/whatsapp/send":       "manage_connectors",
  "GET /ai/providers":                    null,
  "GET /ai/morning-briefing":             "view_reports",
  "POST /ai/classify-event":              "manage_requests",
  "GET /ai/guest-intelligence/:guestId":  "view_guests",
  "GET /ai/revenue-insights":             "view_reports",
  "POST /night-audit/generate":           "night_audit",
  "GET /night-audit/latest":              "view_reports",
  "POST /connectors/pms/webhook":         "manage_connectors",
  "POST /connectors/pms/simulate":        "manage_connectors",
  "GET /team/users":                      "manage_users",
  "POST /team/invitations":               "invite_users",
  "PUT /team/users/:id":                  "manage_users",
  "GET /team/license":                    "manage_billing",
  "GET /team/roles":                      "manage_roles",
  "PUT /team/roles/:id":                  "manage_roles",
  "POST /team/roles":                     "create_custom_roles",
  "POST /campaigns":                      "manage_campaigns",
  "GET /campaigns":                       "manage_campaigns",
  "GET /campaigns/:id":                   "manage_campaigns",
  "PATCH /campaigns/:id":                 "manage_campaigns",
  "DELETE /campaigns/:id":                "manage_campaigns",
  "POST /campaigns/:id/activate":         "manage_campaigns",
  "POST /campaigns/:id/pause":            "manage_campaigns",
  "POST /campaigns/:id/complete":         "manage_campaigns",
  "POST /campaigns/:id/leads/import":     "manage_campaigns",
  "GET /campaigns/:id/leads":             "manage_campaigns",
  "DELETE /campaigns/:id/leads/:leadId":  "manage_campaigns",
  "GET /campaigns/:id/calls":             "manage_campaigns",
  "GET /campaigns/:id/calls/:callId":     "manage_campaigns",
  "GET /campaigns/:id/analytics":         "manage_campaigns",
  "GET /campaigns/:id/deliveries":        "manage_campaigns",
};

const canAccess = (permissions: string[], key: string): boolean => {
  const req = permissionMap[key];
  return req === null || hasPermission(permissions, req);
};

const connectorRegistry = [
  {
    key: "whatsapp_interakt",
    category: "communication",
    envFlag: "CONNECTOR_WHATSAPP_INTERAKT_ENABLED",
    ingestModes: ["webhook", "outbound_api"]
  },
  {
    key: "whatsapp_twilio",
    category: "communication",
    envFlag: "CONNECTOR_WHATSAPP_TWILIO_ENABLED",
    ingestModes: ["webhook", "outbound_api"]
  },
  {
    key: "pms_hotelogix",
    category: "pms",
    envFlag: "CONNECTOR_PMS_HOTELOGIX_ENABLED",
    ingestModes: ["api", "webhook"]
  },
  {
    key: "pms_ezee",
    category: "pms",
    envFlag: "CONNECTOR_PMS_EZEE_ENABLED",
    ingestModes: ["api"]
  },
  {
    key: "pos_petpooja",
    category: "pos",
    envFlag: "CONNECTOR_POS_PETPOOJA_ENABLED",
    ingestModes: ["api"]
  },
  {
    key: "payments_razorpay",
    category: "payments",
    envFlag: "CONNECTOR_PAYMENTS_RAZORPAY_ENABLED",
    ingestModes: ["api", "payment_link"]
  },
  {
    key: "voice_vapi",
    category: "voice",
    envFlag: "CONNECTOR_VOICE_VAPI_ENABLED",
    ingestModes: ["api", "webhook"]
  },
  {
    key: "email_resend",
    category: "email",
    envFlag: "CONNECTOR_EMAIL_RESEND_ENABLED",
    ingestModes: ["outbound_api"]
  }
] as const;

const envFlagByConnectorKey = new Map<string, string>(
  connectorRegistry.map((item) => [item.key, item.envFlag])
);

const maskConnectorConfig = (config: Record<string, unknown>) => {
  const masked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    const lowered = key.toLowerCase();
    const isSecretKey =
      lowered.includes("secret") ||
      lowered.includes("token") ||
      lowered.includes("password") ||
      lowered.endsWith("key");
    masked[key] = isSecretKey && typeof value === "string" && value.length > 0 ? "***" : value;
  }
  return masked;
};

const handleRequest = async (
  req: IncomingMessage,
  res: ServerResponse
) => {
  try {
    if (req.url === "/auth/token" && req.method === "POST") {
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

    // ── GET /auth/identify — public: look up tenantId+role+industry by email ────────
    // Read-only: this endpoint MUST NOT mutate state. Invited users are connected via
    // the token-protected invite flow (POST /team/invitations/:token/accept), which
    // proves possession of the secret invite link. Auto-accepting by email alone here
    // would let anyone consume a pending invitation just by knowing the address, and a
    // GET must never have side effects.
    if (req.url?.startsWith("/auth/identify") && req.method === "GET") {
      const email = parseUrl(req.url).searchParams.get("email")?.toLowerCase().trim();
      if (!email) {
        json(res, 400, { ok: false, error: "email is required" });
        return;
      }

      const user = await prisma.user.findFirst({
        where: { email, isActive: true },
        select: {
          tenantId: true,
          role: true,
          fullName: true,
          systemRole: { select: { key: true } },
          tenant: { select: { industry: true, name: true, branding: { select: BRANDING_SELECT } } }
        }
      });

      if (!user) {
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
      json(res, 200, {
        ok: true,
        exists: true,
        tenantId: user.tenantId,
        role: user.role,
        roleKey: user.systemRole?.key ?? null,
        industry: user.tenant.industry,
        propertyName: user.tenant.name,
        branding: user.tenant.branding ?? null,
        fullName: user.fullName
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
        select: { id: true, industry: true, name: true, branding: { select: BRANDING_SELECT } },
      });
      if (!tenant) { json(res, 200, { ok: true, found: false }); return; }
      json(res, 200, {
        ok: true, found: true,
        tenantId: tenant.id, industry: tenant.industry, propertyName: tenant.name,
        branding: tenant.branding ?? null,
      });
      return;
    }

    // ── POST /hotels/register — public: create hotel, seed roles/license, issue JWT ─
    if (req.url === "/hotels/register" && req.method === "POST") {
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
      };
      const ownerName = asTrimmedString(body.ownerName) ?? INDUSTRY_ADMIN_TITLE[industry] ?? "Admin";

      if (!propertyName || !ownerEmail) {
        json(res, 400, { ok: false, error: "propertyName and ownerEmail are required" });
        return;
      }

      const existingUser = await prisma.user.findFirst({
        where: { email: ownerEmail },
        select: { id: true }
      });
      if (existingUser) {
        json(res, 409, { ok: false, error: "An account with this email already exists" });
        return;
      }

      const tenantId = `hotel-${randomBytes(8).toString("hex")}`;

      await prisma.tenant.create({ data: { id: tenantId, name: propertyName, timezone, industry } });

      await seedDefaultRolesForHotel(tenantId);
      await seedLicenseForHotel(tenantId, "starter", 5);

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
      const { verifyWebhook } = await import("./core/campaigns/vapi");
      const verdict = verifyWebhook({
        provided: (req.headers["x-vapi-secret"] as string) ?? null,
        expected: asTrimmedString(process.env.VAPI_WEBHOOK_SECRET),
        enforce: String(process.env.VERIFY_WEBHOOKS ?? "").toLowerCase() === "true",
      });
      if (!verdict.ok) { json(res, 401, { ok: false, error: verdict.reason ?? "Invalid webhook secret" }); return; }

      let payload: unknown = {};
      try { payload = rawBody ? JSON.parse(rawBody) : {}; } catch { json(res, 400, { ok: false, error: "Invalid JSON" }); return; }
      const { processVapiWebhook } = await import("./core/campaigns/webhook");
      const result = await processVapiWebhook(payload);
      json(res, 200, { ok: true, ...result });
      return;
    }

    // ── GET /sse/live-feed — real-time event stream ───────────────────────────
    if (req.url?.startsWith("/sse/live-feed") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }

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

    // ── Tenant branding (white-label) ───────────────────────────────────────────
    if (req.url === "/tenant/branding" && (req.method === "GET" || req.method === "PUT")) {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
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
        const branding = await prisma.tenantBranding.findUnique({
          where: { tenantId }, select: BRANDING_SELECT,
        });
        json(res, 200, { ok: true, branding: branding ?? null });
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
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

      // PUT — set/clear slug and/or custom domain (blank string clears to null).
      const body = (await parseBody(req)) as { slug?: unknown; customDomain?: unknown };
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
          json(res, 400, { ok: false, error: "customDomain must be a valid hostname on your own domain (not an eynis.com host)" });
          return;
        }
        data.customDomain = d;
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

    if (req.url === "/events/service-request-created" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "POST /events/service-request-created")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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
      if (secret) {
        const hdr = (k: string) => (typeof req.headers[k] === "string" ? (req.headers[k] as string) : null);
        const valid = verifyResendSignature(secret, {
          id: hdr("svix-id"), timestamp: hdr("svix-timestamp"), signature: hdr("svix-signature"),
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
      const expected = asTrimmedString(process.env.WHATSAPP_WEBHOOK_SECRET);
      const provided = req.headers["x-webhook-secret"];
      const providedSecret =
        typeof provided === "string" ? provided : Array.isArray(provided) ? provided[0] : null;
      if (expected && providedSecret !== expected) {
        json(res, 401, { ok: false, error: "Invalid webhook secret" });
        return;
      }

      const rawBody = await parseRawBody(req);
      const enforce = process.env.VERIFY_WEBHOOKS === "true";

      const twilioSig = typeof req.headers["x-twilio-signature"] === "string" ? req.headers["x-twilio-signature"] : null;
      if (twilioSig !== null) {
        const fullUrl = `http://${req.headers.host ?? "localhost"}${req.url}`;
        const check = checkWebhookSignature({ provider: "twilio", signature: twilioSig, url: fullUrl, rawBody, params: {}, enforce });
        if (!check.ok) { json(res, 401, { ok: false, error: check.reason ?? "Twilio signature verification failed" }); return; }
      }

      const interaktSig = typeof req.headers["x-hub-signature-256"] === "string"
        ? req.headers["x-hub-signature-256"]
        : typeof req.headers["x-interakt-signature"] === "string"
        ? req.headers["x-interakt-signature"]
        : null;
      if (interaktSig !== null) {
        const check = checkWebhookSignature({ provider: "interakt", signature: interaktSig, url: req.url ?? "", rawBody, enforce });
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "POST /connectors/events/ingest")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /connectors/events")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }

      const qs = parseUrl(req.url).searchParams;
      const limit = Math.min(Number(qs.get("limit") ?? 20), 100);
      const offset = Math.max(Number(qs.get("offset") ?? 0), 0);
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

      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + limit < total } });
      return;
    }

    // ── Connector: outbound WhatsApp send ───────────────────────────────────
    if (req.url?.startsWith("/connectors/whatsapp/send") && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "POST /connectors/whatsapp/send")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
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
          assignedToUserId: context.role === "front_desk" ? context.userId : null,
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

    if (req.url?.startsWith("/service-requests") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "POST /service-requests/sla/refresh")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "PATCH /service-requests/:id/status")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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

      broadcastSSEEvent(context.tenantId, { type: "sr_updated", data: { id: updated.id, status: nextStatus } });
      json(res, 200, { ok: true, item: updated });
      return;
    }

    if (req.url === "/dashboard/overview" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /dashboard/overview")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }
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

    if (req.url === "/dashboard/queue-summary" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /dashboard/queue-summary")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /dashboard/overview")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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

    if (req.url === "/analytics/revenue-intelligence" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /analytics/revenue-intelligence")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }
      const licRevenue = await enforceLicenseFeature(context.tenantId, "advanced_analytics");
      if (!licRevenue.ok) { json(res, 403, { ok: false, error: licRevenue.error }); return; }

      const [offerEvents, openRequests] = await Promise.all([
        prisma.offerEvent.findMany({
          where: { tenantId: context.tenantId },
          select: { offerType: true, status: true, revenueInr: true }
        }),
        prisma.serviceRequest.count({
          where: { tenantId: context.tenantId, status: { not: "resolved" } }
        })
      ]);

      const grouped = new Map<string, { sent: number; accepted: number; revenueInr: number }>();
      let sentOffers = 0;
      let acceptedOffers = 0;
      let totalUpsellInr = 0;
      let lateCheckoutInr = 0;
      for (const ev of offerEvents) {
        const key = ev.offerType || "unknown";
        const current = grouped.get(key) ?? { sent: 0, accepted: 0, revenueInr: 0 };
        current.sent += 1;
        sentOffers += 1;
        if (ev.status === "accepted" || ev.status === "converted") {
          current.accepted += 1;
          current.revenueInr += ev.revenueInr;
          acceptedOffers += 1;
          totalUpsellInr += ev.revenueInr;
          if (key.toLowerCase().includes("late_checkout")) {
            lateCheckoutInr += ev.revenueInr;
          }
        }
        grouped.set(key, current);
      }

      const byAutomationType = Array.from(grouped.entries())
        .map(([key, value]) => ({ key, ...value }))
        .sort((a, b) => b.revenueInr - a.revenueInr);
      const topConvertingOffers = byAutomationType
        .filter((x) => x.sent > 0)
        .map((x) => ({
          offerType: x.key,
          sent: x.sent,
          accepted: x.accepted,
          conversionRate: Number(((x.accepted / x.sent) * 100).toFixed(2))
        }))
        .sort((a, b) => b.conversionRate - a.conversionRate)
        .slice(0, 6);

      const leftOnTableInr = Math.max(0, (sentOffers - acceptedOffers) * 700 + openRequests * 400);
      json(res, 200, {
        ok: true,
        totals: {
          totalUpsellInr,
          acceptedOffers,
          sentOffers,
          lateCheckoutInr,
          leftOnTableInr
        },
        byAutomationType,
        topConvertingOffers,
        funnel: {
          triggered: sentOffers,
          sent: sentOffers,
          opened: sentOffers,
          accepted: acceptedOffers,
          revenueInr: totalUpsellInr
        }
      });
      return;
    }

    if (req.url === "/analytics/staff-performance" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /analytics/staff-performance")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }
      const licStaff = await enforceLicenseFeature(context.tenantId, "advanced_analytics");
      if (!licStaff.ok) { json(res, 403, { ok: false, error: licStaff.error }); return; }

      const users = await prisma.user.findMany({
        where: { tenantId: context.tenantId, isActive: true },
        select: { id: true, fullName: true, role: true }
      });
      const requests = await prisma.serviceRequest.findMany({
        where: { tenantId: context.tenantId },
        select: { status: true, assignedToUserId: true, createdAt: true, resolvedAt: true }
      });

      const byUser = new Map<string, { completed: number; minutesTotal: number; open: number }>();
      for (const u of users) byUser.set(u.id, { completed: 0, minutesTotal: 0, open: 0 });

      let resolvedCount = 0;
      let totalMinutes = 0;
      let openCount = 0;
      for (const reqRow of requests) {
        const isResolved = reqRow.status === "resolved" && reqRow.resolvedAt;
        if (isResolved && reqRow.resolvedAt) {
          const minutes = Math.max(
            1,
            Math.round((reqRow.resolvedAt.getTime() - reqRow.createdAt.getTime()) / 60000)
          );
          resolvedCount += 1;
          totalMinutes += minutes;
          if (reqRow.assignedToUserId && byUser.has(reqRow.assignedToUserId)) {
            const current = byUser.get(reqRow.assignedToUserId)!;
            current.completed += 1;
            current.minutesTotal += minutes;
            byUser.set(reqRow.assignedToUserId, current);
          }
        } else {
          openCount += 1;
          if (reqRow.assignedToUserId && byUser.has(reqRow.assignedToUserId)) {
            const current = byUser.get(reqRow.assignedToUserId)!;
            current.open += 1;
            byUser.set(reqRow.assignedToUserId, current);
          }
        }
      }

      const completionRate =
        requests.length === 0 ? 0 : Number(((resolvedCount / requests.length) * 100).toFixed(2));
      const avgResolutionMinutes = resolvedCount === 0 ? 0 : Math.round(totalMinutes / resolvedCount);
      const utilizationRate =
        users.length === 0 ? 0 : Number((Math.min(100, (openCount / users.length) * 22)).toFixed(2));

      const leaderboard = users
        .map((u) => {
          const row = byUser.get(u.id)!;
          return {
            userId: u.id,
            fullName: u.fullName,
            role: u.role,
            completedTasks: row.completed,
            avgResolutionMinutes:
              row.completed === 0 ? 0 : Number((row.minutesTotal / row.completed).toFixed(2))
          };
        })
        .sort((a, b) => b.completedTasks - a.completedTasks)
        .slice(0, 10);

      const roleMap = new Map<string, { openTasks: number; resolvedTasks: number }>();
      for (const u of users) {
        const row = byUser.get(u.id)!;
        const current = roleMap.get(u.role) ?? { openTasks: 0, resolvedTasks: 0 };
        current.openTasks += row.open;
        current.resolvedTasks += row.completed;
        roleMap.set(u.role, current);
      }
      const workloadByRole = Array.from(roleMap.entries()).map(([role, value]) => ({
        role,
        ...value
      }));

      const alerts: string[] = [];
      if (openCount > resolvedCount) alerts.push("Open requests exceed resolved requests in current window");
      for (const [role, value] of roleMap.entries()) {
        if (value.openTasks > value.resolvedTasks * 1.5 && value.openTasks >= 3) {
          alerts.push(role + " workload imbalance detected");
        }
      }

      json(res, 200, {
        ok: true,
        summary: {
          avgResolutionMinutes,
          completionRate,
          avgGuestRating: 0,
          utilizationRate
        },
        leaderboard,
        workloadByRole,
        alerts
      });
      return;
    }

    if (req.url === "/connectors/registry" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /connectors/registry")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

      const configs = await prisma.connectorConfig.findMany({
        where: { tenantId: context.tenantId },
        select: { connectorKey: true, enabled: true }
      });
      const configMap = new Map(configs.map((c) => [c.connectorKey, c.enabled]));
      const items = connectorRegistry.map((item) => {
        const persisted = configMap.get(item.key);
        const envEnabled = String(process.env[item.envFlag] ?? "").toLowerCase() === "true";
        const enabled = typeof persisted === "boolean" ? persisted : envEnabled;
        return {
          key: item.key,
          category: item.category,
          enabled,
          status: enabled ? ("ready" as const) : ("disabled" as const),
          source: typeof persisted === "boolean" ? ("hotel_config" as const) : ("env" as const),
          ingestModes: item.ingestModes
        };
      });
      json(res, 200, { ok: true, items });
      return;
    }

    if (req.url?.startsWith("/connectors/configs") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /connectors/configs")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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

    const connectorConfigKey = parseConnectorConfigPath(req.url);
    if (connectorConfigKey && req.method === "PUT") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "PUT /connectors/configs/:key")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }
      if (!envFlagByConnectorKey.has(connectorConfigKey)) {
        json(res, 404, { ok: false, error: "Unknown connector key" });
        return;
      }

      const body = (await parseBody(req)) as { enabled?: unknown; config?: unknown };
      const enabled = typeof body.enabled === "boolean" ? body.enabled : false;
      const config = body.config && typeof body.config === "object" ? body.config : {};
      const configJson = JSON.stringify(config);
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "DELETE /connectors/configs/:key")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /users")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "PATCH /service-requests/:id/assign")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }

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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) {
        json(res, auth.status, { ok: false, error: auth.error });
        return;
      }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /audit")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" });
        return;
      }
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /dashboard/live-feed")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /guests/:id")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
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
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /guests")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const parsedUrl = parseUrl(req.url);
      const limit = asSafeLimit(parsedUrl.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(parsedUrl.searchParams.get("offset"));
      const search = asTrimmedString(parsedUrl.searchParams.get("search"));
      const where = {
        tenantId: context.tenantId,
        ...(search ? { OR: [
          { fullName: { contains: search } },
          { phoneE164: { contains: search } }
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

    // ── GET /automations/executions ──────────────────────────────────────────
    if (req.url?.startsWith("/automations/executions") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /automations/executions")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licExec = await enforceLicenseFeature(auth.context.tenantId, "automations");
      if (!licExec.ok) { json(res, 403, { ok: false, error: licExec.error }); return; }
      const u = parseUrl(req.url);
      const limit = asSafeLimit(u.searchParams.get("limit"), 20, 100);
      const offset = asSafeOffset(u.searchParams.get("offset"));
      const [execs, total] = await Promise.all([
        prisma.automationExecution.findMany({
          where: { tenantId: auth.context.tenantId },
          orderBy: { executedAt: "desc" },
          skip: offset,
          take: limit
        }),
        prisma.automationExecution.count({ where: { tenantId: auth.context.tenantId } })
      ]);
      json(res, 200, {
        ok: true,
        items: execs.map((e) => ({
          id: e.id, ruleId: e.ruleId, ruleCode: e.ruleCode,
          triggerType: e.triggerType, triggerEntityId: e.triggerEntityId,
          actionType: e.actionType, actionResult: e.actionResult,
          resultDetail: e.resultDetail, executedAt: e.executedAt
        })),
        page: { limit, offset, total, hasMore: offset + limit < total }
      });
      return;
    }

    // ── GET /automations ─────────────────────────────────────────────────────
    if (req.url?.startsWith("/automations") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /automations")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licAuto = await enforceLicenseFeature(context.tenantId, "automations");
      if (!licAuto.ok) { json(res, 403, { ok: false, error: licAuto.error }); return; }
      const rules = await prisma.automationRule.findMany({
        where: { tenantId: context.tenantId },
        orderBy: { createdAt: "asc" },
        include: {
          automationExecutions: {
            orderBy: { executedAt: "desc" },
            take: 1,
            select: { executedAt: true }
          }
        }
      });
      // Execution counts per rule
      const execCounts = await prisma.automationExecution.groupBy({
        by: ["ruleId"],
        where: { tenantId: context.tenantId },
        _count: { id: true }
      });
      const successCounts = await prisma.automationExecution.groupBy({
        by: ["ruleId"],
        where: { tenantId: context.tenantId, actionResult: "success" },
        _count: { id: true }
      });
      const execMap = Object.fromEntries(execCounts.map((e) => [e.ruleId, e._count.id]));
      const successMap = Object.fromEntries(successCounts.map((e) => [e.ruleId, e._count.id]));

      const items = rules.map((r) => {
        let config: Record<string, unknown> = {};
        try { config = JSON.parse(r.configJson) as Record<string, unknown>; } catch { /**/ }
        const isMarketing = (config.ruleType as string) === "marketing";
        const stats = (config.stats as Record<string, number> | undefined) ?? {};
        const liveExecs = execMap[r.id] ?? 0;
        const liveSuccess = successMap[r.id] ?? 0;
        const executions = isMarketing ? (stats.executions ?? 0) + liveExecs : liveExecs;
        const conversions = isMarketing ? (stats.conversions ?? 0) + liveSuccess : liveSuccess;
        const revenueInr = isMarketing ? (stats.revenueInr ?? 0) : 0;
        const lastFiredAt = r.automationExecutions[0]?.executedAt ?? null;
        return {
          id: r.id, code: r.code, name: r.name, isActive: r.isActive,
          ruleType: isMarketing ? "marketing" : "operational",
          executions, conversions, revenueInr, lastFiredAt, createdAt: r.createdAt
        };
      });
      const totalExecutions = items.reduce((s, i) => s + i.executions, 0);
      const totalRevenue = items.reduce((s, i) => s + i.revenueInr, 0);
      const avgConversion = items.length > 0
        ? Math.round(items.reduce((s, i) => s + (i.executions > 0 ? i.conversions / i.executions : 0), 0) / items.length * 1000) / 10
        : 0;
      json(res, 200, {
        ok: true,
        items,
        summary: { totalAutomations: items.length, activeFlows: items.filter(i => i.isActive).length, avgConversion, revenueAttributed: totalRevenue, totalExecutions }
      });
      return;
    }

    // ── GET /analytics/sentiment ─────────────────────────────────────────────
    if (req.url?.startsWith("/analytics/sentiment") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /analytics/sentiment")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licSentiment = await enforceLicenseFeature(context.tenantId, "advanced_analytics");
      if (!licSentiment.ok) { json(res, 403, { ok: false, error: licSentiment.error }); return; }
      // Compute sentiment from resolved service requests (used as proxy for feedback)
      const resolved = await prisma.serviceRequest.findMany({
        where: { tenantId: context.tenantId, status: "resolved" },
        select: { createdAt: true, resolvedAt: true, category: true }
      });
      const netScore = Math.min(99, 72 + resolved.length * 2);
      const positive = Math.round(resolved.length * 0.68);
      const neutral = Math.round(resolved.length * 0.17);
      const negative = resolved.length - positive - neutral;
      const bySource = [
        { source: "Post-Stay Survey", count: Math.round(resolved.length * 1.5) + 20 },
        { source: "Google Reviews", count: Math.round(resolved.length * 1.2) + 15 },
        { source: "TripAdvisor", count: Math.round(resolved.length * 0.9) + 10 },
        { source: "Booking.com", count: Math.round(resolved.length * 0.7) + 5 }
      ];
      const drivers = [
        { term: "Welcoming", weight: 0.9, sentiment: "positive" },
        { term: "Pristine", weight: 0.7, sentiment: "positive" },
        { term: "Prompt Service", weight: 0.8, sentiment: "positive" },
        { term: "Noisy AC", weight: 0.4, sentiment: "negative" },
        { term: "Wait times", weight: 0.3, sentiment: "negative" },
        { term: "Room view", weight: 0.6, sentiment: "positive" }
      ];
      const timeSeries = Array.from({ length: 30 }, (_, i) => ({
        day: i + 1,
        score: Math.round(60 + Math.random() * 30 + i * 0.5)
      }));
      json(res, 200, {
        ok: true,
        netScore: Math.min(netScore, 99),
        totalFeedback: positive + neutral + Math.max(0, negative),
        surveyCompletionRate: 0.68,
        breakdown: { positive, neutral, negative: Math.max(0, negative) },
        bySource,
        drivers,
        timeSeries,
        alert: { type: "warning", message: "Negative trend in F&B reviews" }
      });
      return;
    }

    // ── GET /analytics/upsell-campaigns ─────────────────────────────────────
    if (req.url?.startsWith("/analytics/upsell-campaigns") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const context = auth.context;
      if (!canAccess(context.permissions, "GET /analytics/upsell-campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licUpsell = await enforceLicenseFeature(context.tenantId, "advanced_analytics");
      if (!licUpsell.ok) { json(res, 403, { ok: false, error: licUpsell.error }); return; }
      const rules = await prisma.automationRule.findMany({
        where: { tenantId: context.tenantId },
        orderBy: { createdAt: "asc" }
      });
      const campaignTriggers: Record<string, string> = {
        pre_arrival_welcome: "Pre-arrival email (T-48h)",
        checkin_breakfast_bundle: "Check-in Kiosk",
        spa_happy_hour: "Post-lunch SMS",
        late_checkout_upsell: "Departure Eve Push",
        post_stay_review: "Post Check-Out"
      };
      const items = rules.map((r) => {
        let config: Record<string, unknown> = {};
        try { config = JSON.parse(r.configJson) as Record<string, unknown>; } catch { /**/ }
        const exec = (config.executions as number) ?? 0;
        const conv = (config.conversions as number) ?? 0;
        return {
          id: r.id,
          name: r.name,
          status: r.isActive ? "Active" : "Paused",
          trigger: campaignTriggers[r.code] ?? r.code,
          recipients: exec,
          conversions: conv,
          conversionRate: exec > 0 ? Math.round((conv / exec) * 1000) / 10 : 0,
          revenueInr: (config.revenueInr as number) ?? 0,
          createdAt: r.createdAt
        };
      });
      const weeklyData = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"].map((day, i) => ({
        day,
        executions: 200 + i * 40,
        conversions: 60 + i * 15
      }));
      json(res, 200, { ok: true, items, total: items.length, weeklyData });
      return;
    }

    // ── AI: Provider Status ─────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/providers") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /ai/providers")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      json(res, 200, { ok: true, claude: CLAUDE_AVAILABLE, openai: OPENAI_AVAILABLE });
      return;
    }

    // ── AI: Morning Briefing ────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/morning-briefing") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /ai/morning-briefing")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licBriefing = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
      if (!licBriefing.ok) { json(res, 403, { ok: false, error: licBriefing.error }); return; }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const { tenantId } = auth.context;
      const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const [openReqs, escalatedReqs, guestCount] = await Promise.all([
        prisma.serviceRequest.count({ where: { tenantId, status: "open" } }),
        prisma.serviceRequest.count({ where: { tenantId, status: "escalated" } }),
        prisma.contact.count({ where: { tenantId } })
      ]);
      const topCategories = await prisma.serviceRequest.groupBy({
        by: ["category"],
        where: { tenantId, status: { in: ["open", "escalated"] } },
        _count: { category: true },
        orderBy: { _count: { category: "desc" } },
        take: 3
      });
      const offerAggregate = await prisma.offerEvent.aggregate({
        where: { tenantId },
        _avg: { revenueInr: true }
      });
      const avgSentimentScore = Math.min(100, Math.max(40, Math.round((offerAggregate._avg.revenueInr ?? 0) / 100 + 68)));

      const briefing = await generateMorningBriefing({
        hotelName: hotel?.name ?? tenantId,
        date: new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
        openRequests: openReqs,
        escalatedRequests: escalatedReqs,
        occupancyPct: 72,
        todayRevenue: 284000,
        arrivingGuests: guestCount,
        avgSentimentScore,
        topPendingCategories: topCategories.map((c) => c.category)
      }, provider);

      json(res, 200, { ok: true, provider, briefing });
      return;
    }

    // ── AI: Classify Inbound Event ──────────────────────────────────────────
    if (req.url?.startsWith("/ai/classify-event") && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "POST /ai/classify-event")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const body = (await parseBody(req)) as { text?: unknown; provider?: unknown };
      const text = asTrimmedString(body.text);
      if (!text) { json(res, 400, { ok: false, error: "text is required" }); return; }
      const provider: AIProvider = asTrimmedString(body.provider) === "openai" ? "openai" : "claude";
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const classification = await classifyInboundEvent(auth.context.tenantId, text, provider);
      json(res, 200, { ok: true, provider, classification });
      return;
    }

    // ── AI: Guest Intelligence ──────────────────────────────────────────────
    if (parseGuestIntelligencePath(req.url) && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /ai/guest-intelligence/:guestId")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licGuest = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
      if (!licGuest.ok) { json(res, 403, { ok: false, error: licGuest.error }); return; }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const guestId = parseGuestIntelligencePath(req.url)!;
      const { tenantId } = auth.context;

      const guest = await prisma.contact.findFirst({
        where: { id: guestId, tenantId },
        select: { id: true, fullName: true, visitCount: true }
      });
      if (!guest) { json(res, 404, { ok: false, error: "Guest not found" }); return; }

      const [guestRequests, guestOffers, openCount] = await Promise.all([
        prisma.serviceRequest.findMany({
          where: { guestId, tenantId },
          select: { category: true, createdAt: true },
          orderBy: { createdAt: "desc" },
          take: 20
        }),
        prisma.offerEvent.findMany({
          where: { guestId, tenantId },
          select: { status: true, revenueInr: true },
          take: 30
        }),
        prisma.serviceRequest.count({ where: { guestId, tenantId, status: { in: ["open", "accepted"] } } })
      ]);

      const lastReq = guestRequests[0];
      const catCounts: Record<string, number> = {};
      for (const r of guestRequests) {
        catCounts[r.category] = (catCounts[r.category] ?? 0) + 1;
      }
      const preferredCategories = Object.entries(catCounts)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([cat]) => cat);
      const totalSpendInr = guestOffers.reduce((sum, o) => sum + (o.revenueInr ?? 0), 0);

      const intelligence = await generateGuestIntelligence({
        guestName: guest.fullName,
        totalStays: guest.visitCount,
        lastStayDate: lastReq ? new Date(lastReq.createdAt).toLocaleDateString("en-IN") : null,
        totalSpendInr,
        preferredCategories,
        openRequests: openCount,
        sentimentScore: null,
        segment: "transient",
        notes: []
      }, provider);

      json(res, 200, { ok: true, provider, guestId, guestName: guest.fullName, intelligence });
      return;
    }

    // ── AI: Revenue Insights ────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/revenue-insights") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /ai/revenue-insights")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licRevInsights = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
      if (!licRevInsights.ok) { json(res, 403, { ok: false, error: licRevInsights.error }); return; }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const { tenantId } = auth.context;
      const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

      const [totalUsers, offerStats] = await Promise.all([
        prisma.user.count({ where: { tenantId, isActive: true } }),
        prisma.offerEvent.groupBy({
          by: ["offerType"],
          where: { tenantId },
          _count: { offerType: true },
          _sum: { revenueInr: true },
          orderBy: { _sum: { revenueInr: "desc" } },
          take: 5
        })
      ]);

      const accepted = await prisma.offerEvent.count({ where: { tenantId, status: "accepted" } });
      const total = await prisma.offerEvent.count({ where: { tenantId } });

      const insights = await generateRevenueInsights({
        hotelName: hotel?.name ?? tenantId,
        occupancyPct: 72,
        adrInr: 8500,
        revParInr: 6120,
        upsellConversionPct: total > 0 ? Math.round((accepted / total) * 100) : 0,
        topCategories: offerStats.map((o) => ({
          name: o.offerType,
          revenueInr: o._sum.revenueInr ?? 0
        })),
        weekTrend: "up",
        availableRooms: Math.max(0, totalUsers - Math.floor(totalUsers * 0.72))
      }, provider);

      json(res, 200, { ok: true, provider, insights });
      return;
    }

    // ── POST /night-audit/generate ───────────────────────────────────────────
    if (req.url === "/night-audit/generate" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "POST /night-audit/generate")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licNightGen = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
      if (!licNightGen.ok) { json(res, 403, { ok: false, error: licNightGen.error }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const body = (await parseBody(req)) as { provider?: unknown };
      const provider: "claude" | "openai" = asTrimmedString(body.provider) === "openai" ? "openai" : "claude";
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured" }); return; }

      const { tenantId } = auth.context;
      const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
      const today = new Date();
      const todayStart = new Date(today); todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(today); todayEnd.setHours(23, 59, 59, 999);
      const reportDate = today.toISOString().slice(0, 10);

      const [
        resolvedToday, escalatedCount, openCount,
        checkInsToday, checkOutsToday, inHouseCount,
        autoExecsToday, autoSuccessesToday,
        connEventCount, negEventCount,
        upsellAgg, topCategoryRows
      ] = await Promise.all([
        prisma.serviceRequest.findMany({
          where: { tenantId, status: "resolved", resolvedAt: { gte: todayStart, lte: todayEnd } },
          select: { createdAt: true, resolvedAt: true }
        }),
        prisma.serviceRequest.count({ where: { tenantId, status: "escalated" } }),
        prisma.serviceRequest.count({ where: { tenantId, status: { not: "resolved" } } }),
        prisma.stay.count({ where: { tenantId, checkInAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.stay.count({ where: { tenantId, checkOutAt: { gte: todayStart, lte: todayEnd } } }),
        prisma.stay.count({ where: { tenantId, checkInAt: { lte: today }, checkOutAt: { gte: today } } }),
        prisma.automationExecution.count({ where: { tenantId, executedAt: { gte: todayStart } } }),
        prisma.automationExecution.count({ where: { tenantId, executedAt: { gte: todayStart }, actionResult: "success" } }),
        prisma.connectorEvent.count({ where: { tenantId, createdAt: { gte: todayStart } } }),
        prisma.connectorEvent.count({ where: { tenantId, createdAt: { gte: todayStart }, aiSentiment: "negative" } }),
        prisma.offerEvent.aggregate({ where: { tenantId, status: "accepted", createdAt: { gte: todayStart } }, _sum: { revenueInr: true } }),
        prisma.serviceRequest.groupBy({
          by: ["category"],
          where: { tenantId },
          _count: { category: true },
          orderBy: { _count: { category: "desc" } },
          take: 1
        })
      ]);

      const avgResolutionMins = resolvedToday.length === 0 ? 0 : Math.round(
        resolvedToday.reduce((sum, r) => {
          if (!r.resolvedAt) return sum;
          return sum + (r.resolvedAt.getTime() - r.createdAt.getTime()) / 60000;
        }, 0) / resolvedToday.length
      );

      const auditData: NightAuditData = {
        hotelName: hotel?.name ?? tenantId,
        reportDate,
        occupancyPct: inHouseCount > 0 ? Math.min(100, Math.round((inHouseCount / 45) * 100)) : 72,
        checkIns: checkInsToday,
        checkOuts: checkOutsToday,
        inHouseGuests: inHouseCount,
        resolvedRequests: resolvedToday.length,
        escalatedRequests: escalatedCount,
        openRequests: openCount,
        avgResolutionMins,
        automationExecutions: autoExecsToday,
        automationSuccesses: autoSuccessesToday,
        whatsappMessages: connEventCount,
        upsellRevenue: upsellAgg._sum.revenueInr ?? 0,
        negativeEvents: negEventCount,
        topIssueCategory: topCategoryRows[0]?.category ?? "general"
      };

      const result = await generateNightAuditReport(auditData, provider);
      await prisma.nightAuditReport.upsert({
        where: { tenantId_reportDate: { tenantId, reportDate } },
        create: { tenantId, reportDate, contentJson: JSON.stringify(result), provider },
        update: { contentJson: JSON.stringify(result), provider }
      });

      await prisma.auditLog.create({
        data: {
          tenantId,
          actorRole: auth.context.role,
          action: "night_audit.generated",
          entityType: "night_audit_report",
          metadata: JSON.stringify({ reportDate, provider })
        }
      });

      json(res, 200, { ok: true, reportDate, provider, report: result });
      return;
    }

    // ── GET /night-audit/latest ──────────────────────────────────────────────
    if (req.url?.startsWith("/night-audit/latest") && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /night-audit/latest")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licNightLatest = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
      if (!licNightLatest.ok) { json(res, 403, { ok: false, error: licNightLatest.error }); return; }
      const { tenantId } = auth.context;
      const report = await prisma.nightAuditReport.findFirst({
        where: { tenantId },
        orderBy: { generatedAt: "desc" }
      });
      if (!report) { json(res, 404, { ok: false, error: "No night audit report found" }); return; }
      let content: unknown = null;
      try { content = JSON.parse(report.contentJson); } catch { content = null; }
      json(res, 200, { ok: true, reportDate: report.reportDate, provider: report.provider, generatedAt: report.generatedAt, report: content });
      return;
    }

    // ── POST /connectors/pms/simulate ────────────────────────────────────────
    if (req.url === "/connectors/pms/simulate" && req.method === "POST") {
      // Demo-only: fabricates a check-in with real DB writes. Disabled in
      // production unless explicitly opted in, so it can't be used to seed
      // bogus stays/contacts on a live tenant (F-2).
      if (process.env.NODE_ENV === "production" && process.env.ENABLE_PMS_SIMULATE !== "true") {
        json(res, 404, { ok: false, error: "Not found" }); return;
      }
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "POST /connectors/pms/simulate")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
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

    // ── Team: URL helpers ─────────────────────────────────────────────────────
    const parseTeamUserId = (u: string | undefined) => {
      const m = /^\/team\/users\/([^/]+)$/.exec(parseUrl(u).pathname);
      return m?.[1] ?? null;
    };
    const parseInviteToken = (u: string | undefined) => {
      const m = /^\/team\/invitations\/([^/]+)$/.exec(parseUrl(u).pathname);
      return m?.[1] ?? null;
    };
    const parseInviteAccept = (u: string | undefined) => {
      const m = /^\/team\/invitations\/([^/]+)\/accept$/.exec(parseUrl(u).pathname);
      return m?.[1] ?? null;
    };
    const parseTeamRoleId = (u: string | undefined) => {
      const m = /^\/team\/roles\/([^/]+)$/.exec(parseUrl(u).pathname);
      return m?.[1] ?? null;
    };

    // ── GET /team/users — list team members with role + seat usage ────────────
    if (req.url === "/team/users" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!hasPermission(auth.context.permissions, "manage_users")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const users = await prisma.user.findMany({
        where: { tenantId: auth.context.tenantId },
        select: {
          id: true, fullName: true, email: true, role: true,
          roleId: true, isActive: true, createdAt: true,
          systemRole: { select: { id: true, key: true, displayName: true } }
        },
        orderBy: { createdAt: "asc" }
      });
      const license = await prisma.license.findUnique({ where: { tenantId: auth.context.tenantId } });
      const usedSeats = users.filter(u => u.isActive).length;
      json(res, 200, {
        ok: true,
        users: users.map(u => ({
          id: u.id, fullName: u.fullName, email: u.email,
          role: u.role, roleId: u.roleId,
          systemRole: u.systemRole ? { id: u.systemRole.id, key: u.systemRole.key, displayName: u.systemRole.displayName } : null,
          isActive: u.isActive, createdAt: u.createdAt
        })),
        seats: { used: usedSeats, max: license?.maxSeats ?? null, plan: license?.plan ?? "starter" }
      });
      return;
    }

    // ── POST /team/invitations — generate invite link ─────────────────────────
    if (req.url === "/team/invitations" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!hasPermission(auth.context.permissions, "invite_users")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const body = (await parseBody(req)) as { email?: unknown; roleId?: unknown };
      const email = asTrimmedString(body.email)?.toLowerCase();
      const roleId = asTrimmedString(body.roleId);
      if (!email || !roleId) {
        json(res, 400, { ok: false, error: "email and roleId are required" }); return;
      }
      const role = await prisma.role.findFirst({
        where: { id: roleId, tenantId: auth.context.tenantId },
        select: { id: true, key: true, displayName: true }
      });
      if (!role) { json(res, 404, { ok: false, error: "Role not found" }); return; }
      const within = await isWithinSeatLimit(auth.context.tenantId);
      if (!within) {
        json(res, 403, { ok: false, error: "Seat limit reached — upgrade your plan to invite more users" }); return;
      }
      // Expire any existing pending invite for the same email
      await prisma.invitation.updateMany({
        where: { tenantId: auth.context.tenantId, email, acceptedAt: null },
        data: { expiresAt: new Date() }
      });
      const token = randomBytes(32).toString("hex");
      const inv = await prisma.invitation.create({
        data: {
          tenantId: auth.context.tenantId,
          email,
          roleId: role.id,
          token,
          expiresAt: new Date(Date.now() + 48 * 60 * 60 * 1000),
          invitedById: auth.context.userId
        }
      });
      const webBase = process.env.EYNIS_WEB_BASE_URL ?? "http://localhost:3000";
      json(res, 201, {
        ok: true,
        inviteUrl: `${webBase}/invite/${token}`,
        token,
        expiresAt: inv.expiresAt
      });
      return;
    }

    // ── GET /team/invitations/:token — verify invite (public) ─────────────────
    if (parseInviteToken(req.url) && req.method === "GET") {
      const token = parseInviteToken(req.url)!;
      const inv = await prisma.invitation.findUnique({
        where: { token },
        include: {
          role: { select: { displayName: true, key: true } },
          tenant: { select: { name: true } }
        }
      });
      if (!inv) { json(res, 404, { ok: false, error: "Invitation not found" }); return; }
      json(res, 200, {
        ok: true,
        email: inv.email,
        hotelName: inv.tenant.name,
        roleName: inv.role.displayName,
        roleKey: inv.role.key,
        expired: inv.expiresAt < new Date(),
        accepted: !!inv.acceptedAt
      });
      return;
    }

    // ── POST /team/invitations/:token/accept — create account (public) ────────
    if (parseInviteAccept(req.url) && req.method === "POST") {
      const token = parseInviteAccept(req.url)!;
      const inv = await prisma.invitation.findUnique({
        where: { token },
        include: { role: { select: { id: true, key: true, permissions: true } } }
      });
      if (!inv)         { json(res, 404, { ok: false, error: "Invitation not found" }); return; }
      if (inv.acceptedAt) { json(res, 409, { ok: false, error: "Invitation already accepted" }); return; }
      if (inv.expiresAt < new Date()) { json(res, 410, { ok: false, error: "Invitation expired" }); return; }
      const body = (await parseBody(req)) as { fullName?: unknown };
      const fullName = asTrimmedString(body.fullName) ?? inv.email.split("@")[0] ?? "New User";
      const legacyRole = legacyRoleFor(inv.role.key);
      const existing = await prisma.user.findUnique({ where: { email: inv.email } });
      // Email is globally unique, so an existing user belongs to exactly one hotel.
      // Accepting an invite to a *different* hotel must never silently re-point that
      // user's role at another tenant (the user keeps their original tenantId, so they
      // would inherit cross-tenant permissions). Reject instead.
      if (existing && existing.tenantId !== inv.tenantId) {
        json(res, 409, { ok: false, error: "This email is already registered to a different workspace" });
        return;
      }
      // Seat enforcement at accept time: only block when this acceptance would add a
      // new active seat (a brand-new user, or reactivating a deactivated one).
      const willConsumeSeat = !existing || !existing.isActive;
      if (willConsumeSeat && !(await isWithinSeatLimit(inv.tenantId))) {
        json(res, 403, { ok: false, error: "Seat limit reached — ask an admin to upgrade the plan" });
        return;
      }
      let userId: string;
      if (existing) {
        await prisma.user.update({
          where: { id: existing.id },
          data: { roleId: inv.role.id, role: legacyRole, isActive: true, fullName }
        });
        userId = existing.id;
      } else {
        const newUser = await prisma.user.create({
          data: {
            tenantId: inv.tenantId,
            fullName,
            email: inv.email,
            role: legacyRole,
            roleId: inv.role.id,
            isActive: true
          }
        });
        userId = newUser.id;
      }
      await prisma.invitation.update({
        where: { token },
        data: { acceptedAt: new Date() }
      });
      // Issue a JWT so the invitee is immediately logged in
      const invPerms = parsePermissions(inv.role.permissions);
      const jwt = await createAuthToken({
        sub: userId,
        tenantId: inv.tenantId,
        email: inv.email,
        role: legacyRole as UserRole,
        roleKey: inv.role.key as SystemRoleKey,
        permissions: invPerms
      });
      json(res, 200, {
        ok: true,
        token: jwt,
        tenantId: inv.tenantId,
        email: inv.email,
        role: legacyRole
      });
      return;
    }

    // ── PUT /team/users/:id — change role or active status ───────────────────
    if (parseTeamUserId(req.url) && req.method === "PUT") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!hasPermission(auth.context.permissions, "manage_users")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const targetId = parseTeamUserId(req.url)!;
      const target = await prisma.user.findFirst({
        where: { id: targetId, tenantId: auth.context.tenantId },
        include: { systemRole: { select: { key: true } } }
      });
      if (!target) { json(res, 404, { ok: false, error: "User not found" }); return; }
      if (targetId === auth.context.userId) {
        json(res, 400, { ok: false, error: "Cannot modify your own account" }); return;
      }
      const body = (await parseBody(req)) as { roleId?: unknown; isActive?: unknown };
      const updates: { roleId?: string; role?: string; isActive?: boolean } = {};
      if (typeof body.isActive === "boolean") {
        updates.isActive = body.isActive;
      }
      let newRoleKey: string | null = null;
      if (asTrimmedString(body.roleId)) {
        const newRole = await prisma.role.findFirst({
          where: { id: String(body.roleId), tenantId: auth.context.tenantId },
          select: { id: true, key: true }
        });
        if (!newRole) { json(res, 404, { ok: false, error: "Role not found" }); return; }
        updates.roleId = newRole.id;
        updates.role   = legacyRoleFor(newRole.key);
        newRoleKey = newRole.key;
      }
      if (Object.keys(updates).length === 0) {
        json(res, 400, { ok: false, error: "Provide roleId or isActive to update" }); return;
      }
      // Last-admin protection: never let the final active admin be deactivated or
      // demoted out of the admin role, or the hotel would be left with no one who can
      // manage the team, roles, or billing.
      const targetIsAdmin = (target.systemRole?.key ?? null) === "admin" || target.role === "owner";
      const losesAdmin =
        updates.isActive === false || (newRoleKey !== null && newRoleKey !== "admin");
      if (targetIsAdmin && losesAdmin) {
        const otherAdmins = await prisma.user.count({
          where: {
            tenantId: auth.context.tenantId,
            isActive: true,
            id: { not: targetId },
            OR: [{ systemRole: { key: "admin" } }, { role: "owner" }]
          }
        });
        if (otherAdmins === 0) {
          json(res, 400, { ok: false, error: "Cannot remove the last admin — assign another admin first" });
          return;
        }
      }
      const updated = await prisma.user.update({
        where: { id: targetId },
        data: updates,
        select: { id: true, fullName: true, email: true, role: true, isActive: true,
                  systemRole: { select: { key: true, displayName: true } } }
      });
      json(res, 200, { ok: true, user: updated });
      return;
    }

    // ── GET /team/license — plan info + seat usage ────────────────────────────
    if (req.url === "/team/license" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!hasPermission(auth.context.permissions, "manage_billing")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const license = await prisma.license.findUnique({ where: { tenantId: auth.context.tenantId } });
      const usedSeats = await prisma.user.count({ where: { tenantId: auth.context.tenantId, isActive: true } });
      json(res, 200, {
        ok: true,
        license: license
          ? { plan: license.plan, maxSeats: license.maxSeats, usedSeats, renewsAt: license.renewsAt }
          : { plan: "starter", maxSeats: 5, usedSeats, renewsAt: null }
      });
      return;
    }

    // ── GET /team/roles — list roles with user counts ─────────────────────────
    if (req.url === "/team/roles" && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!hasPermission(auth.context.permissions, "manage_roles")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const roles = await prisma.role.findMany({
        where: { tenantId: auth.context.tenantId },
        include: { _count: { select: { users: true } } },
        orderBy: { createdAt: "asc" }
      });
      json(res, 200, {
        ok: true,
        roles: roles.map(r => ({
          id: r.id, key: r.key, displayName: r.displayName,
          permissions: parsePermissions(r.permissions),
          isSystem: r.isSystem, isCustom: r.isCustom,
          userCount: r._count.users
        }))
      });
      return;
    }

    // ── PUT /team/roles/:id — rename a role's displayName ────────────────────
    if (parseTeamRoleId(req.url) && req.method === "PUT") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!hasPermission(auth.context.permissions, "manage_roles")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const roleId = parseTeamRoleId(req.url)!;
      const role = await prisma.role.findFirst({ where: { id: roleId, tenantId: auth.context.tenantId } });
      if (!role) { json(res, 404, { ok: false, error: "Role not found" }); return; }
      const body = (await parseBody(req)) as { displayName?: unknown };
      const displayName = asTrimmedString(body.displayName);
      if (!displayName) { json(res, 400, { ok: false, error: "displayName is required" }); return; }
      const updated = await prisma.role.update({
        where: { id: roleId },
        data: { displayName }
      });
      json(res, 200, {
        ok: true,
        role: { id: updated.id, key: updated.key, displayName: updated.displayName }
      });
      return;
    }

    // ── POST /team/roles — create a custom role ───────────────────────────────
    if (req.url === "/team/roles" && req.method === "POST") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!hasPermission(auth.context.permissions, "create_custom_roles")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const licCustomRoles = await enforceLicenseFeature(auth.context.tenantId, "custom_roles");
      if (!licCustomRoles.ok) { json(res, 403, { ok: false, error: licCustomRoles.error }); return; }
      const body = (await parseBody(req)) as { displayName?: unknown; key?: unknown; permissions?: unknown };
      const displayName = asTrimmedString(body.displayName);
      const key = asTrimmedString(body.key)?.toLowerCase().replace(/\s+/g, "_");
      if (!displayName || !key) { json(res, 400, { ok: false, error: "displayName and key are required" }); return; }
      // Only allow known permissions, and never let a creator grant a permission they
      // don't themselves hold (prevents privilege escalation via custom roles).
      const requested = Array.isArray(body.permissions)
        ? body.permissions.filter((p): p is string => typeof p === "string")
        : [];
      const grantable = new Set(ALL_PERMISSIONS as readonly string[]);
      const permissions = requested.filter(
        (p) => grantable.has(p) && hasPermission(auth.context.permissions, p)
      );
      const existing = await prisma.role.findUnique({ where: { tenantId_key: { tenantId: auth.context.tenantId, key } } });
      if (existing) { json(res, 409, { ok: false, error: "A role with that key already exists" }); return; }
      const role = await prisma.role.create({
        data: {
          tenantId: auth.context.tenantId,
          key,
          displayName,
          permissions: JSON.stringify(permissions),
          isSystem: false,
          isCustom: true
        }
      });
      json(res, 201, {
        ok: true,
        role: { id: role.id, key: role.key, displayName: role.displayName, permissions, isSystem: false, isCustom: true, userCount: 0 }
      });
      return;
    }

    // ── Message Templates: reusable library + approval status ───────────────
    const tplPath = parseTemplatePath(req.url);
    if (tplPath) {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const tenantId = auth.context.tenantId;
      if (!hasPermission(auth.context.permissions, "manage_campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const tplMod = await import("./core/campaigns/templates");
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
          return;
        }
        if (req.method === "POST") {
          const body = (await parseBody(req)) as Record<string, unknown>;
          const v = tplMod.validateTemplateCreate(body);
          if (!v.ok) { json(res, 400, { ok: false, error: v.error }); return; }
          const created = await prisma.messageTemplate.create({
            data: { tenantId, name: v.value.name, channel: v.value.channel, category: v.value.category, language: v.value.language, subject: v.value.subject, body: v.value.body, variables: JSON.stringify(v.value.variables) },
          });
          json(res, 201, { ok: true, template: ser(created) });
          return;
        }
        json(res, 405, { ok: false, error: "Method not allowed" }); return;
      }

      const tpl = await prisma.messageTemplate.findFirst({ where: { id: tplPath.id, tenantId } });
      if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return; }

      // POST /templates/:id/submit — draft → submitted
      if (tplPath.submit && req.method === "POST") {
        if (tpl.status !== "draft" && tpl.status !== "rejected") { json(res, 409, { ok: false, error: "Only draft/rejected templates can be submitted" }); return; }
        const updated = await prisma.messageTemplate.update({ where: { id: tpl.id }, data: { status: "submitted", submittedAt: new Date(), rejectionReason: null } });
        json(res, 200, { ok: true, template: ser(updated) });
        return;
      }
      if (tplPath.submit) { json(res, 405, { ok: false, error: "Method not allowed" }); return; }

      if (req.method === "GET") { json(res, 200, { ok: true, template: ser(tpl) }); return; }
      if (req.method === "PATCH") {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const data: Record<string, unknown> = {};
        // Content edits (allowed while not approved).
        for (const f of ["name", "category", "language", "subject", "body"] as const) {
          if (f in body) { const s = asTrimmedString(body[f]); if (f !== "subject" && !s) { json(res, 400, { ok: false, error: `${f} must be a non-empty string` }); return; } data[f] = s; }
        }
        if ("variables" in body) data.variables = JSON.stringify(Array.isArray(body.variables) ? body.variables.filter((x): x is string => typeof x === "string") : []);
        // Status lifecycle.
        if ("status" in body) {
          const sc = tplMod.validateStatusChange(tpl.channel, String(body.status), { providerTemplateId: body.providerTemplateId as string | null, rejectionReason: body.rejectionReason as string | null });
          if (!sc.ok) { json(res, 400, { ok: false, error: sc.error }); return; }
          Object.assign(data, sc.value);
        }
        if (Object.keys(data).length === 0) { json(res, 400, { ok: false, error: "No updatable fields provided" }); return; }
        const updated = await prisma.messageTemplate.update({ where: { id: tpl.id }, data });
        json(res, 200, { ok: true, template: ser(updated) });
        return;
      }
      if (req.method === "DELETE") {
        await prisma.messageTemplate.delete({ where: { id: tpl.id } });
        json(res, 200, { ok: true, deleted: tpl.id });
        return;
      }
      json(res, 405, { ok: false, error: "Method not allowed" }); return;
    }

    // ── Drip Sequences: multi-step automation ───────────────────────────────
    const seqPath = parseSequencePath(req.url);
    if (seqPath) {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const tenantId = auth.context.tenantId;
      if (!hasPermission(auth.context.permissions, "manage_campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const seqMod = await import("./core/campaigns/sequences");
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
          return;
        }
        if (req.method === "POST") {
          const body = (await parseBody(req)) as Record<string, unknown>;
          const name = asTrimmedString(body.name);
          if (!name) { json(res, 400, { ok: false, error: "name is required" }); return; }
          const stepsV = seqMod.validateSequenceSteps(body.steps);
          if (!stepsV.ok) { json(res, 400, { ok: false, error: stepsV.error }); return; }
          const exitOn = seqMod.parseExitOn(body.exitOn ?? ["opted_out", "replied"]);
          const created = await prisma.sequence.create({
            data: {
              tenantId, name, exitOn: JSON.stringify(exitOn),
              steps: { create: stepsV.value.map((s) => ({ order: s.order, waitMinutes: s.waitMinutes, channel: s.channel, whatsappContentSid: s.whatsappContentSid, whatsappTemplateId: s.whatsappTemplateId, whatsappTemplateBody: s.whatsappTemplateBody, whatsappVariables: JSON.stringify(s.whatsappVariables), emailSubject: s.emailSubject, emailBody: s.emailBody })) },
            },
            include: { steps: true },
          });
          json(res, 201, { ok: true, sequence: serializeSeq(created) });
          return;
        }
        json(res, 405, { ok: false, error: "Method not allowed" }); return;
      }

      const sequence = await prisma.sequence.findFirst({ where: { id: seqPath.id, tenantId } });
      if (!sequence) { json(res, 404, { ok: false, error: "Sequence not found" }); return; }

      // POST /sequences/:id/enroll
      if (seqPath.sub === "enroll" && req.method === "POST") {
        const steps = await prisma.sequenceStep.findMany({ where: { sequenceId: sequence.id }, orderBy: { order: "asc" } });
        if (steps.length === 0) { json(res, 400, { ok: false, error: "Sequence has no steps" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter((x): x is string => typeof x === "string") : [];
        const segmentId = asTrimmedString(body.segmentId);
        const campaignId = asTrimmedString(body.campaignId);
        let where: Record<string, unknown> = { tenantId };
        if (leadIds.length > 0) where = { tenantId, id: { in: leadIds } };
        else if (segmentId) {
          const seg = await prisma.leadSegment.findFirst({ where: { id: segmentId, tenantId }, select: { rules: true } });
          if (!seg) { json(res, 404, { ok: false, error: "Segment not found" }); return; }
          const { parseSegmentRules, buildLeadWhere } = await import("./core/campaigns/segments");
          where = { tenantId, ...(campaignId ? { campaignId } : {}), ...buildLeadWhere(parseSegmentRules(seg.rules)) };
        } else if (campaignId) where = { tenantId, campaignId };
        else { json(res, 400, { ok: false, error: "Provide leadIds, segmentId, or campaignId" }); return; }

        const targets = await prisma.campaignLead.findMany({ where, take: 5000, select: { id: true } });
        if (targets.length === 0) { json(res, 200, { ok: true, enrolled: 0, skipped: 0 }); return; }
        const nextRunAt = seqMod.nextRunFrom(new Date(), steps[0].waitMinutes);
        const result = await prisma.sequenceEnrollment.createMany({
          data: targets.map((t) => ({ sequenceId: sequence.id, tenantId, leadId: t.id, currentStepOrder: 0, nextRunAt })),
          skipDuplicates: true,
        });
        json(res, 200, { ok: true, enrolled: result.count, skipped: targets.length - result.count });
        return;
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
        json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + limit < total } });
        return;
      }

      if (seqPath.sub) { json(res, 405, { ok: false, error: "Method not allowed" }); return; }

      // Item GET / PATCH / DELETE
      if (req.method === "GET") {
        const full = await prisma.sequence.findUnique({ where: { id: sequence.id }, include: { steps: true, _count: { select: { steps: true, enrollments: true } } } });
        json(res, 200, { ok: true, sequence: serializeSeq(full) });
        return;
      }
      if (req.method === "PATCH") {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const data: Record<string, unknown> = {};
        if (body.name !== undefined) { const n = asTrimmedString(body.name); if (!n) { json(res, 400, { ok: false, error: "name must be non-empty" }); return; } data.name = n; }
        if (body.status !== undefined) {
          const st = asTrimmedString(body.status);
          if (!st || !["draft", "active", "archived"].includes(st)) { json(res, 400, { ok: false, error: "status must be draft|active|archived" }); return; }
          // Activating: every WhatsApp step must reference an approved template.
          if (st === "active") {
            const { isApprovedWhatsappTemplate } = await import("./core/campaigns/whatsapp-template");
            const waSteps = await prisma.sequenceStep.findMany({ where: { sequenceId: sequence.id, channel: "whatsapp" }, select: { order: true, whatsappTemplateId: true, whatsappTemplate: { select: { channel: true, status: true, providerTemplateId: true } } } });
            const bad = waSteps.find((s) => !isApprovedWhatsappTemplate(s.whatsappTemplate));
            if (bad) { json(res, 400, { ok: false, error: `Step ${bad.order + 1} (WhatsApp) needs an approved template before the sequence can be activated.` }); return; }
          }
          data.status = st;
        }
        if (body.exitOn !== undefined) data.exitOn = JSON.stringify(seqMod.parseExitOn(body.exitOn));
        // Replace steps wholesale when provided.
        if (body.steps !== undefined) {
          const stepsV = seqMod.validateSequenceSteps(body.steps);
          if (!stepsV.ok) { json(res, 400, { ok: false, error: stepsV.error }); return; }
          await prisma.sequenceStep.deleteMany({ where: { sequenceId: sequence.id } });
          data.steps = { create: stepsV.value.map((s) => ({ order: s.order, waitMinutes: s.waitMinutes, channel: s.channel, whatsappContentSid: s.whatsappContentSid, whatsappTemplateId: s.whatsappTemplateId, whatsappTemplateBody: s.whatsappTemplateBody, whatsappVariables: JSON.stringify(s.whatsappVariables), emailSubject: s.emailSubject, emailBody: s.emailBody })) };
        }
        if (Object.keys(data).length === 0) { json(res, 400, { ok: false, error: "No updatable fields provided" }); return; }
        const updated = await prisma.sequence.update({ where: { id: sequence.id }, data, include: { steps: true } });
        json(res, 200, { ok: true, sequence: serializeSeq(updated) });
        return;
      }
      if (req.method === "DELETE") {
        await prisma.sequence.delete({ where: { id: sequence.id } });
        json(res, 200, { ok: true, deleted: sequence.id });
        return;
      }
      json(res, 405, { ok: false, error: "Method not allowed" }); return;
    }

    // ── Lead Segments: saved tenant-wide audience filters ───────────────────
    const segPath = parseSegmentPath(req.url);
    if (segPath) {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const tenantId = auth.context.tenantId;
      if (!hasPermission(auth.context.permissions, "manage_campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const { parseSegmentRules, buildLeadWhere } = await import("./core/campaigns/segments");

      // Collection: GET (list) / POST (create)
      if (segPath.id === null) {
        if (req.method === "GET") {
          const rows = await prisma.leadSegment.findMany({ where: { tenantId }, orderBy: { createdAt: "desc" } });
          const items = rows.map((s) => ({ id: s.id, name: s.name, rules: parseSegmentRules(s.rules), createdAt: s.createdAt, updatedAt: s.updatedAt }));
          json(res, 200, { ok: true, items });
          return;
        }
        if (req.method === "POST") {
          const body = (await parseBody(req)) as Record<string, unknown>;
          const name = asTrimmedString(body.name);
          if (!name) { json(res, 400, { ok: false, error: "name is required" }); return; }
          const rules = parseSegmentRules(body.rules);
          const created = await prisma.leadSegment.create({ data: { tenantId, name, rules: JSON.stringify(rules) } });
          json(res, 201, { ok: true, segment: { id: created.id, name: created.name, rules, createdAt: created.createdAt, updatedAt: created.updatedAt } });
          return;
        }
        json(res, 405, { ok: false, error: "Method not allowed" }); return;
      }

      // Item must belong to the tenant.
      const segment = await prisma.leadSegment.findFirst({ where: { id: segPath.id, tenantId } });
      if (!segment) { json(res, 404, { ok: false, error: "Segment not found" }); return; }

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
        return;
      }

      if (segPath.preview) { json(res, 405, { ok: false, error: "Method not allowed" }); return; }

      if (req.method === "GET") {
        json(res, 200, { ok: true, segment: { id: segment.id, name: segment.name, rules: parseSegmentRules(segment.rules), createdAt: segment.createdAt, updatedAt: segment.updatedAt } });
        return;
      }
      if (req.method === "PATCH") {
        const body = (await parseBody(req)) as Record<string, unknown>;
        const data: Record<string, unknown> = {};
        if (body.name !== undefined) {
          const name = asTrimmedString(body.name);
          if (!name) { json(res, 400, { ok: false, error: "name must be a non-empty string" }); return; }
          data.name = name;
        }
        if (body.rules !== undefined) data.rules = JSON.stringify(parseSegmentRules(body.rules));
        if (Object.keys(data).length === 0) { json(res, 400, { ok: false, error: "No updatable fields provided" }); return; }
        const updated = await prisma.leadSegment.update({ where: { id: segment.id }, data });
        json(res, 200, { ok: true, segment: { id: updated.id, name: updated.name, rules: parseSegmentRules(updated.rules), createdAt: updated.createdAt, updatedAt: updated.updatedAt } });
        return;
      }
      if (req.method === "DELETE") {
        await prisma.leadSegment.delete({ where: { id: segment.id } }); // campaigns.segmentId → SetNull
        json(res, 200, { ok: true, deleted: segment.id });
        return;
      }
      json(res, 405, { ok: false, error: "Method not allowed" }); return;
    }

    // ── Voice Campaigns: create + list ──────────────────────────────────────
    if (parseUrl(req.url).pathname === "/campaigns" && (req.method === "POST" || req.method === "GET")) {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Hotel not found" }); return; }

      const { validateCampaignCreate, serializeCampaign } = await import("./core/campaigns/service");

      if (req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /campaigns")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const validated = validateCampaignCreate(body);
        if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return; }
        const v = validated.value;
        const created = await prisma.voiceCampaign.create({
          data: {
            tenantId, name: v.name, channels: JSON.stringify(v.channels),
            scriptTemplate: v.scriptTemplate,
            voiceA: v.voiceA, voiceB: v.voiceB, personaA: v.personaA, personaB: v.personaB,
            outcomeTypes: JSON.stringify(v.outcomeTypes), followUpRules: JSON.stringify(v.followUpRules),
            calendlyLink: v.calendlyLink, agentName: v.agentName,
            whatsappContentSid: v.whatsappContentSid, whatsappTemplateId: v.whatsappTemplateId, whatsappTemplateBody: v.whatsappTemplateBody,
            whatsappVariables: JSON.stringify(v.whatsappVariables),
            whatsappAgentEnabled: v.whatsappAgentEnabled, whatsappAgentPrompt: v.whatsappAgentPrompt,
            emailSubjectTemplate: v.emailSubjectTemplate, emailBodyTemplate: v.emailBodyTemplate,
            maxRetries: v.maxRetries, retryDelayHours: v.retryDelayHours,
            maxConcurrent: v.maxConcurrent, spendCapCalls: v.spendCapCalls, defaultCountryCode: v.defaultCountryCode,
            segmentId: v.segmentId,
            scheduledStartAt: v.scheduledStartAt, sendWindowStartMin: v.sendWindowStartMin,
            sendWindowEndMin: v.sendWindowEndMin, sendDays: JSON.stringify(v.sendDays), sendTimeZone: v.sendTimeZone,
          },
        });
        json(res, 201, { ok: true, campaign: serializeCampaign(created) });
        return;
      }

      // GET /campaigns — list with lead/call counts
      if (!canAccess(auth.context.permissions, "GET /campaigns")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const qs = parseUrl(req.url).searchParams;
      const limit = asSafeLimit(qs.get("limit"), 20, 100);
      const offset = asSafeOffset(qs.get("offset"));
      const [rows, total] = await Promise.all([
        prisma.voiceCampaign.findMany({
          where: { tenantId },
          orderBy: { createdAt: "desc" },
          take: limit, skip: offset,
          include: { _count: { select: { leads: true, calls: true } } },
        }),
        prisma.voiceCampaign.count({ where: { tenantId } }),
      ]);
      const items = rows.map((r) => ({
        ...serializeCampaign(r),
        stats: { totalLeads: r._count.leads, totalCalls: r._count.calls },
      }));
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + limit < total } });
      return;
    }

    // ── Voice Campaigns: single / update / delete / lifecycle actions ────────
    if (parseUrl(req.url).pathname.startsWith("/campaigns/")) {
      const parsed = parseCampaignPath(req.url);
      if (parsed) {
        const auth = await getAuthenticatedContext(req);
        if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
        const tenantId = auth.context.tenantId;
        const { id, action } = parsed;

        const { buildCampaignUpdate, serializeCampaign, outcomeBreakdown, provisionCampaignAssistants } =
          await import("./core/campaigns/service");

        // Resolve the campaign scoped to this tenant.
        const campaign = await prisma.voiceCampaign.findFirst({ where: { id, tenantId } });

        // GET /campaigns/:id
        if (action === null && req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /campaigns/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }
          const [leadCount, callCount, outcomeRows, leadStatusRows] = await Promise.all([
            prisma.campaignLead.count({ where: { campaignId: id } }),
            prisma.callRecord.count({ where: { campaignId: id } }),
            prisma.callRecord.groupBy({ by: ["outcome"], where: { campaignId: id }, _count: { _all: true } }),
            prisma.campaignLead.groupBy({ by: ["status"], where: { campaignId: id }, _count: { _all: true } }),
          ]);
          json(res, 200, {
            ok: true,
            campaign: serializeCampaign(campaign),
            stats: {
              totalLeads: leadCount,
              totalCalls: callCount,
              outcomeBreakdown: outcomeBreakdown(outcomeRows.map((o) => ({ outcome: o.outcome, count: o._count._all }))),
              leadStatusBreakdown: Object.fromEntries(leadStatusRows.map((s) => [s.status, s._count._all])),
            },
          });
          return;
        }

        // PATCH /campaigns/:id
        if (action === null && req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /campaigns/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }
          const body = (await parseBody(req)) as Record<string, unknown>;
          const update = buildCampaignUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return; }
          const updated = await prisma.voiceCampaign.update({ where: { id }, data: update.value });
          json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
          return;
        }

        // DELETE /campaigns/:id — only when no CallRecords exist
        if (action === null && req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /campaigns/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }
          const callCount = await prisma.callRecord.count({ where: { campaignId: id } });
          if (callCount > 0) {
            json(res, 409, { ok: false, error: "Cannot delete a campaign with call records; complete it instead" });
            return;
          }
          await prisma.voiceCampaign.delete({ where: { id } });
          json(res, 200, { ok: true, deleted: id });
          return;
        }

        // POST /campaigns/:id/activate | pause | complete
        if (action !== null && req.method === "POST") {
          if (!canAccess(auth.context.permissions, `POST /campaigns/:id/${action}`)) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }

          if (action === "pause") {
            if (campaign.status !== "active") {
              json(res, 409, { ok: false, error: `Cannot pause a campaign in '${campaign.status}' status` }); return;
            }
            const updated = await prisma.voiceCampaign.update({ where: { id }, data: { status: "paused" } });
            json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
            return;
          }

          if (action === "complete") {
            if (campaign.status === "completed") {
              json(res, 409, { ok: false, error: "Campaign is already completed" }); return;
            }
            const updated = await prisma.voiceCampaign.update({ where: { id }, data: { status: "completed" } });
            json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
            return;
          }

          // action === "activate"
          if (campaign.status !== "draft" && campaign.status !== "paused") {
            json(res, 409, { ok: false, error: `Cannot activate a campaign in '${campaign.status}' status` }); return;
          }
          const channels = serializeCampaign(campaign).channels as string[];
          // WhatsApp: cannot activate without an approved template (Meta forbids
          // business-initiated sends on anything but a pre-approved template).
          if (channels.includes("whatsapp")) {
            const { isApprovedWhatsappTemplate } = await import("./core/campaigns/whatsapp-template");
            const tpl = campaign.whatsappTemplateId
              ? await prisma.messageTemplate.findFirst({ where: { id: campaign.whatsappTemplateId, tenantId }, select: { channel: true, status: true, providerTemplateId: true } })
              : null;
            if (!isApprovedWhatsappTemplate(tpl)) {
              json(res, 400, { ok: false, error: "WhatsApp campaigns need an approved template. Get one approved in Templates, then select it in the campaign's settings." });
              return;
            }
          }
          let vapiAssistantIdA = campaign.vapiAssistantIdA;
          let vapiAssistantIdB = campaign.vapiAssistantIdB;
          // Voice channel: provision Vapi assistants. Non-voice channels (WhatsApp/
          // email) need no provisioning and activate directly.
          if (channels.includes("voice")) {
            const { resolveVapiCredentials, isVapiConfigured, createAssistant, deleteAssistant, webhookHostFromPublicUrl } = await import("./core/campaigns/vapi");
            const creds = await resolveVapiCredentials(tenantId);
            if (!isVapiConfigured(creds)) {
              json(res, 400, { ok: false, error: "voice_vapi connector not configured — set VAPI_API_KEY or enable the connector" });
              return;
            }
            // Re-provision only if not already provisioned (resume keeps existing assistants).
            if (!vapiAssistantIdA || !vapiAssistantIdB) {
              // Webhook callback host MUST come from trusted server config, never the
              // request Host header (which a caller can spoof to exfiltrate call reports).
              const apiDomain = webhookHostFromPublicUrl(process.env.API_PUBLIC_URL);
              if (!apiDomain) {
                json(res, 500, { ok: false, error: "Server misconfigured: set API_PUBLIC_URL (e.g. https://api.example.com) for the Vapi webhook callback" });
                return;
              }
              // Agent name the AI introduces itself with: explicit campaign value,
              // else the hotel name (never the persona label).
              const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
              const agentName = asTrimmedString(campaign.agentName) ?? hotel?.name ?? "your assistant";
              const provisioned = await provisionCampaignAssistants({
                campaign: {
                  name: campaign.name, scriptTemplate: campaign.scriptTemplate ?? "",
                  voiceA: campaign.voiceA ?? "", voiceB: campaign.voiceB ?? "",
                  personaA: campaign.personaA ?? "", personaB: campaign.personaB ?? "",
                  outcomeTypes: serializeCampaign(campaign).outcomeTypes,
                },
                creds, apiDomain, agentName,
                createAssistant, deleteAssistant,
              });
              if (!provisioned.ok) { json(res, 502, { ok: false, error: provisioned.error }); return; }
              vapiAssistantIdA = provisioned.vapiAssistantIdA;
              vapiAssistantIdB = provisioned.vapiAssistantIdB;
            }
          }
          const updated = await prisma.voiceCampaign.update({
            where: { id },
            data: { status: "active", vapiAssistantIdA, vapiAssistantIdB },
          });
          json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
          return;
        }
      }
    }

    // ── Voice Campaign leads: import / list / delete ────────────────────────
    const leadsPath = parseCampaignLeadsPath(req.url);
    if (leadsPath) {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const tenantId = auth.context.tenantId;
      const { campaignId, leadId, isImport } = leadsPath;
      const campaign = await prisma.voiceCampaign.findFirst({
        where: { id: campaignId, tenantId },
        select: { id: true, defaultCountryCode: true },
      });

      // POST /campaigns/:id/leads/import  (multipart CSV)
      if (isImport && req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /campaigns/:id/leads/import")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }

        const { parseMultipart, parseLeadsFromCsv, bulkInsertLeads } = await import("./core/campaigns/csv-import");
        let multipart;
        try { multipart = await parseMultipart(req); }
        catch (e) { json(res, 400, { ok: false, error: `Invalid upload: ${(e as Error).message}` }); return; }
        if (!multipart.file) { json(res, 400, { ok: false, error: "CSV file is required (form field 'file')" }); return; }

        let columnMap: unknown;
        try { columnMap = JSON.parse(multipart.fields.columnMap ?? "{}"); }
        catch { json(res, 400, { ok: false, error: "columnMap must be valid JSON" }); return; }
        if (typeof columnMap !== "object" || columnMap === null || Array.isArray(columnMap)) {
          json(res, 400, { ok: false, error: "columnMap must be a JSON object mapping CSV headers to fields" }); return;
        }

        const consentSourceRaw = asTrimmedString(multipart.fields.consentSource);
        const consentSource = consentSourceRaw && isValidConsentSource(consentSourceRaw) ? consentSourceRaw : undefined;
        const csvText = multipart.file.content.toString("utf8");
        const { leads, errors } = parseLeadsFromCsv(csvText, {
          columnMap: columnMap as Record<string, import("./core/campaigns/csv-import").EynisLeadField>,
          defaultCountryCode: campaign.defaultCountryCode,
          defaultConsent: multipart.fields.defaultConsent === "true",
          consentSource,
        });
        const result = await bulkInsertLeads(campaignId, tenantId, leads, errors);
        json(res, 200, { ok: true, ...result });
        return;
      }

      // GET /campaigns/:id/leads  (paginated; ?status= &abVariant=)
      if (leadId === null && !isImport && req.method === "GET") {
        if (!canAccess(auth.context.permissions, "GET /campaigns/:id/leads")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }
        const qs = parseUrl(req.url).searchParams;
        const limit = asSafeLimit(qs.get("limit"), 50, 200);
        const offset = asSafeOffset(qs.get("offset"));
        const status = asTrimmedString(qs.get("status"));
        const abVariant = asTrimmedString(qs.get("abVariant"));
        const tag = asTrimmedString(qs.get("tag"));
        const segmentId = asTrimmedString(qs.get("segmentId"));
        // Optional segment filter: apply the saved rules (tenant-scoped).
        let segmentWhere = {};
        if (segmentId) {
          const seg = await prisma.leadSegment.findFirst({ where: { id: segmentId, tenantId }, select: { rules: true } });
          if (seg) {
            const { parseSegmentRules, buildLeadWhere } = await import("./core/campaigns/segments");
            segmentWhere = buildLeadWhere(parseSegmentRules(seg.rules));
          }
        }
        const where = {
          campaignId,
          ...(status ? { status } : {}),
          ...(abVariant ? { abVariant } : {}),
          ...(tag ? { tags: { has: tag } } : {}),
          ...segmentWhere,
        };
        const [items, total] = await Promise.all([
          prisma.campaignLead.findMany({
            where, orderBy: { createdAt: "desc" }, take: limit, skip: offset,
            select: {
              id: true, firstName: true, lastName: true, phone: true, email: true,
              company: true, jobTitle: true, abVariant: true, status: true, tags: true,
              callAttempts: true, consent: true, optedOut: true, createdAt: true,
            },
          }),
          prisma.campaignLead.count({ where }),
        ]);
        json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + limit < total } });
        return;
      }

      // POST /campaigns/:id/leads/tag — bulk add/remove tags on selected leads.
      // ("tag" is a reserved sub-path; lead ids are cuids and never collide.)
      if (leadId === "tag" && req.method === "POST") {
        if (!canAccess(auth.context.permissions, "GET /campaigns/:id/leads")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const { normalizeTags } = await import("./core/campaigns/segments");
        const leadIds = Array.isArray(body.leadIds) ? body.leadIds.filter((x): x is string => typeof x === "string") : [];
        const addTags = normalizeTags(body.addTags);
        const removeTags = normalizeTags(body.removeTags);
        if (leadIds.length === 0) { json(res, 400, { ok: false, error: "leadIds must be a non-empty array" }); return; }
        if (addTags.length === 0 && removeTags.length === 0) { json(res, 400, { ok: false, error: "provide addTags and/or removeTags" }); return; }
        // Read-modify-write per lead so tag sets stay deduped and ordered.
        const targets = await prisma.campaignLead.findMany({ where: { id: { in: leadIds }, campaignId, tenantId }, select: { id: true, tags: true } });
        let updated = 0;
        for (const t of targets) {
          const next = normalizeTags([...t.tags.filter((x) => !removeTags.includes(x)), ...addTags]);
          await prisma.campaignLead.update({ where: { id: t.id }, data: { tags: next } });
          updated++;
        }
        json(res, 200, { ok: true, updated });
        return;
      }

      // PATCH /campaigns/:id/leads/:leadId — set the lead's tags (full replace).
      if (leadId !== null && leadId !== "tag" && !isImport && req.method === "PATCH") {
        if (!canAccess(auth.context.permissions, "GET /campaigns/:id/leads")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        if (body.tags === undefined) { json(res, 400, { ok: false, error: "tags is required" }); return; }
        const { normalizeTags } = await import("./core/campaigns/segments");
        const lead = await prisma.campaignLead.findFirst({ where: { id: leadId, campaignId, tenantId }, select: { id: true } });
        if (!lead) { json(res, 404, { ok: false, error: "Lead not found" }); return; }
        const updated = await prisma.campaignLead.update({ where: { id: lead.id }, data: { tags: normalizeTags(body.tags) }, select: { id: true, tags: true } });
        json(res, 200, { ok: true, lead: updated });
        return;
      }

      // DELETE /campaigns/:id/leads/:leadId  (pending only)
      if (leadId !== null && !isImport && req.method === "DELETE") {
        if (!canAccess(auth.context.permissions, "DELETE /campaigns/:id/leads/:leadId")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }
        const lead = await prisma.campaignLead.findFirst({ where: { id: leadId, campaignId, tenantId }, select: { id: true, status: true } });
        if (!lead) { json(res, 404, { ok: false, error: "Lead not found" }); return; }
        if (lead.status !== "pending") {
          json(res, 409, { ok: false, error: "Only pending leads can be removed" }); return;
        }
        await prisma.campaignLead.delete({ where: { id: leadId } });
        json(res, 200, { ok: true, deleted: leadId });
        return;
      }
    }

    // ── Voice Campaign: A/B analytics ───────────────────────────────────────
    const analyticsId = parseCampaignAnalyticsPath(req.url);
    if (analyticsId && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /campaigns/:id/analytics")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const campaign = await prisma.voiceCampaign.findFirst({ where: { id: analyticsId, tenantId: auth.context.tenantId }, select: { id: true } });
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }

      const rows = await prisma.callRecord.findMany({
        where: { campaignId: analyticsId },
        select: { abVariant: true, status: true, outcome: true, durationSeconds: true, sentiment: true, meetingBooked: true },
      });
      const { summarizeVariant, decideLeader, sentimentScore } = await import("./core/campaigns/analytics");
      const NO_ANSWER = new Set(["no_answer"]);
      const blank = () => ({ dials: 0, answered: 0, interested: 0, meetingsBooked: 0, durationSum: 0, durationCount: 0, sentimentScoreSum: 0, sentimentRatedCount: 0 });
      const acc: Record<string, ReturnType<typeof blank>> = { A: blank(), B: blank() };
      for (const r of rows) {
        const v = acc[r.abVariant];
        if (!v) continue;
        v.dials++;
        if (r.status === "ended" && r.outcome && !NO_ANSWER.has(r.outcome)) v.answered++;
        if (r.outcome === "interested") v.interested++;
        if (r.meetingBooked) v.meetingsBooked++;
        if (r.status === "ended" && r.durationSeconds != null) { v.durationSum += r.durationSeconds; v.durationCount++; }
        if (r.sentiment) { v.sentimentScoreSum += sentimentScore(r.sentiment); v.sentimentRatedCount++; }
      }
      const toRaw = (v: ReturnType<typeof blank>) => ({
        dials: v.dials, answered: v.answered, interested: v.interested, meetingsBooked: v.meetingsBooked,
        avgDurationSeconds: v.durationCount > 0 ? Math.round(v.durationSum / v.durationCount) : null,
        sentimentScoreSum: v.sentimentScoreSum, sentimentRatedCount: v.sentimentRatedCount,
      });
      const variantA = summarizeVariant(toRaw(acc.A));
      const variantB = summarizeVariant(toRaw(acc.B));
      const decision = decideLeader(variantA, variantB);
      const overall = {
        totalLeads: await prisma.campaignLead.count({ where: { campaignId: analyticsId } }),
        dials: variantA.dials + variantB.dials,
        answered: variantA.answered + variantB.answered,
        interested: variantA.interested + variantB.interested,
        meetingsBooked: variantA.meetingsBooked + variantB.meetingsBooked,
      };
      json(res, 200, { ok: true, overall, variantA, variantB, ...decision });
      return;
    }

    // ── Voice Campaign: message deliveries (activity feed) ──────────────────
    // Surfaces WhatsApp/email sends (MessageDelivery) for a campaign so the UI
    // can render a live activity feed. Paginated, newest first, optional
    // ?channel= and ?status= filters. Tenant-scoped via the campaign lookup.
    const deliveriesId = parseCampaignDeliveriesPath(req.url);
    if (deliveriesId && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      if (!canAccess(auth.context.permissions, "GET /campaigns/:id/deliveries")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const campaign = await prisma.voiceCampaign.findFirst({ where: { id: deliveriesId, tenantId: auth.context.tenantId }, select: { id: true } });
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }

      const qs = parseUrl(req.url).searchParams;
      const whereDeliveries = {
        campaignId: deliveriesId,
        ...(asTrimmedString(qs.get("channel")) ? { channel: asTrimmedString(qs.get("channel"))! } : {}),
        ...(asTrimmedString(qs.get("status")) ? { status: asTrimmedString(qs.get("status"))! } : {}),
      };
      const limit = asSafeLimit(qs.get("limit"), 50, 200);
      const offset = asSafeOffset(qs.get("offset"));
      const [items, total] = await Promise.all([
        prisma.messageDelivery.findMany({
          where: whereDeliveries, orderBy: { createdAt: "desc" }, take: limit, skip: offset,
          select: {
            id: true, channel: true, status: true, renderedSubject: true, renderedBody: true,
            error: true, sentAt: true, createdAt: true,
            lead: { select: { firstName: true, lastName: true, company: true, phone: true } },
          },
        }),
        prisma.messageDelivery.count({ where: whereDeliveries }),
      ]);
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + limit < total } });
      return;
    }

    // ── Voice Campaign: calls list / detail (+ CSV export) ──────────────────
    const callsPath = parseCampaignCallsPath(req.url);
    if (callsPath && req.method === "GET") {
      const auth = await getAuthenticatedContext(req);
      if (!auth.ok) { json(res, auth.status, { ok: false, error: auth.error }); return; }
      const tenantId = auth.context.tenantId;
      const campaign = await prisma.voiceCampaign.findFirst({ where: { id: callsPath.campaignId, tenantId }, select: { id: true } });
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }

      // Single call detail: + sentiment timeline + the lead's WhatsApp thread.
      if (callsPath.callId) {
        if (!canAccess(auth.context.permissions, "GET /campaigns/:id/calls/:callId")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        const call = await prisma.callRecord.findFirst({
          where: { id: callsPath.callId, campaignId: callsPath.campaignId },
          include: { lead: { select: { id: true, firstName: true, lastName: true, company: true, phone: true } } },
        });
        if (!call) { json(res, 404, { ok: false, error: "Call not found" }); return; }
        const [sentimentEvents, conversation] = await Promise.all([
          prisma.sentimentEvent.findMany({ where: { callRecordId: call.id }, orderBy: { createdAt: "asc" }, select: { speaker: true, text: true, sentiment: true, score: true, createdAt: true } }),
          prisma.whatsappConversation.findFirst({ where: { campaignId: callsPath.campaignId, leadId: call.leadId }, include: { messages: { orderBy: { createdAt: "asc" }, select: { direction: true, body: true, sentiment: true, createdAt: true } } } }),
        ]);
        json(res, 200, { ok: true, call: { ...call, keyPoints: (() => { try { return JSON.parse(call.keyPoints); } catch { return []; } })() }, sentimentEvents, whatsappThread: conversation?.messages ?? [] });
        return;
      }

      // List
      if (!canAccess(auth.context.permissions, "GET /campaigns/:id/calls")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
      }
      const qs = parseUrl(req.url).searchParams;
      const whereCalls = {
        campaignId: callsPath.campaignId,
        ...(asTrimmedString(qs.get("outcome")) ? { outcome: asTrimmedString(qs.get("outcome"))! } : {}),
        ...(asTrimmedString(qs.get("abVariant")) ? { abVariant: asTrimmedString(qs.get("abVariant"))! } : {}),
      };
      const selectCall = {
        id: true, abVariant: true, status: true, outcome: true, sentiment: true, durationSeconds: true,
        whatsappSent: true, emailSent: true, meetingBooked: true, createdAt: true, endedAt: true,
        lead: { select: { firstName: true, lastName: true, company: true, phone: true } },
      };

      // CSV export — full set (no pagination), Content-Disposition.
      if (qs.get("format") === "csv") {
        const all = await prisma.callRecord.findMany({ where: whereCalls, orderBy: { createdAt: "desc" }, select: selectCall });
        const esc = (v: unknown) => { const s = v == null ? "" : String(v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
        const header = ["name", "company", "phone", "variant", "status", "outcome", "sentiment", "durationSeconds", "whatsappSent", "emailSent", "meetingBooked", "createdAt"];
        const lines = [header.join(",")];
        for (const c of all) {
          lines.push([
            `${c.lead.firstName} ${c.lead.lastName ?? ""}`.trim(), c.lead.company ?? "", c.lead.phone ?? "",
            c.abVariant, c.status, c.outcome ?? "", c.sentiment ?? "", c.durationSeconds ?? "",
            c.whatsappSent, c.emailSent, c.meetingBooked, c.createdAt.toISOString(),
          ].map(esc).join(","));
        }
        res.writeHead(200, { "content-type": "text/csv", "content-disposition": `attachment; filename="campaign-${callsPath.campaignId}-calls.csv"` });
        res.end(lines.join("\n"));
        return;
      }

      const limit = asSafeLimit(qs.get("limit"), 50, 200);
      const offset = asSafeOffset(qs.get("offset"));
      const [items, total] = await Promise.all([
        prisma.callRecord.findMany({ where: whereCalls, orderBy: { createdAt: "desc" }, take: limit, skip: offset, select: selectCall }),
        prisma.callRecord.count({ where: whereCalls }),
      ]);
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + limit < total } });
      return;
    }

    json(res, 404, { ok: false, error: "Not found" });
  } catch (_error) {
    json(res, 500, { ok: false, error: "Internal server error" });
  }
};

export const buildServer = () =>
  createServer((req, res) => {
    void handleRequest(req, res);
  });

export const startServer = (port = Number(process.env.PORT ?? 4000)) => {
  const server = buildServer();
  server.listen(port, () => {
    console.log("Eynis API listening on port " + port);
    startAutomationWorker(60_000);
    console.log("Eynis AutomationEngine started — 60s cycle");
    startCampaignDispatchWorker();
    startCampaignWorker();
    startSequenceWorker();
  });
  return server;
};

if (process.env.START_SERVER === "true") {
  const port = Number(process.env.PORT ?? 4000);
  startServer(port);
}
