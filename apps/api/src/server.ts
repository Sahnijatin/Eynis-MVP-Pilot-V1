import "dotenv/config";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { InMemoryEventBus } from "./events/event-bus";
import { prisma } from "./db/prisma";
import { Prisma } from "@prisma/client";
import type { UserRole, SystemRoleKey } from "@eynis/shared";
import { isValidConsentSource, CONNECTOR_CATALOG, CONNECTOR_CATEGORY_LABELS, connectorEnvFlag } from "@eynis/shared";
import { createAuthToken, parseBearerToken, verifyAuthToken, assertJwtSecretConfigured } from "./core/auth";
import { normalizeWhatsappInbound } from "./core/connectors/whatsapp";
import { ingestConnectorEvent } from "./core/connectors/ingest";
import {
  AI_AVAILABLE,
  CLAUDE_AVAILABLE,
  OPENAI_AVAILABLE,
  type AIProvider,
  classifyInboundEvent,
  generateGuestIntelligence,
  generateSmartInsights,
  generateRevenueInsights,
  generateNightAuditReport,
  aiCompleteTiered,
  extractJson,
  AiResponseError,
  type NightAuditData
} from "./core/ai/intelligence";
import { startAutomationWorker } from "./core/automations/engine";
import { computeSentimentAnalytics } from "./core/analytics/sentiment";
import { computeUpsellAnalytics } from "./core/analytics/upsell";
import { listInventory, applyMovement, updateItem, deleteItem, type MovementType } from "./core/inventory/service";
import * as quotes from "./core/quotes/service";
import type { FollowupResult } from "./core/quotes/followup";
import { hashToken as hashInviteToken } from "./core/crypto/secrets";
import { rateLimit } from "./core/rate-limit";
import { startCampaignDispatchWorker } from "./core/campaigns/dispatch";
import { startCampaignWorker } from "./core/campaigns/worker";
import { startSequenceWorker } from "./core/campaigns/sequence-runner";
import { registerSSEClient, removeSSEClient, broadcastSSEEvent } from "./sse/clients";
import { checkWebhookSignature, verifySharedWebhookSecret } from "./core/connectors/webhook-verify";
import { processResendEvent, verifyResendSignature } from "./core/email/resend-webhook";
import { randomBytes } from "node:crypto";
import { parsePermissions, getPermissionsForLegacyRole, hasPermission, isWithinSeatLimit, legacyRoleFor, seedDefaultRolesForHotel, seedLicenseForHotel, syncSystemRolePermissions } from "./core/rbac";
import { enforceLicenseFeature, planOptions, isValidPlan, VALID_PLANS, DEFAULT_SEATS_FOR_PLAN, type PlanKey } from "./core/license";
import { type Permission, ALL_PERMISSIONS } from "./core/permissions";
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

const eventBus = new InMemoryEventBus();

eventBus.subscribe("service_request.created", (event) => {
  // Placeholder for upcoming Day 3 worker hooks.
  void event;
});

const json = (res: ServerResponse, status: number, payload: unknown) => {
  res.writeHead(status, { "content-type": "application/json" });
  res.end(JSON.stringify(payload));
};

// Sends a generated document (E-9 exports). `download` sets Content-Disposition so
// the browser saves the file (CSV); omit it for inline render (printable HTML).
const sendDoc = (res: ServerResponse, contentType: string, body: string, download?: string) => {
  const headers: Record<string, string> = { "content-type": contentType };
  if (download) headers["content-disposition"] = `attachment; filename="${download.replace(/[^\w.\-]/g, "_")}"`;
  res.writeHead(200, headers);
  res.end(body);
};

// Binary variant for real PDF bytes (E-9). Always an attachment download.
const sendBinary = (res: ServerResponse, contentType: string, body: Uint8Array, download: string) => {
  res.writeHead(200, {
    "content-type": contentType,
    "content-length": String(body.byteLength),
    "content-disposition": `attachment; filename="${download.replace(/[^\w.\-]/g, "_")}"`
  });
  res.end(Buffer.from(body));
};

// Turns an AI provider/parse failure into a clean 502 instead of letting it bubble
// to the generic 500 with the cause swallowed (F-12). AiResponseError carries a safe,
// specific message (bad shape); any other error is reported generically.
const aiError = (res: ServerResponse, label: string, e: unknown) => {
  const message = e instanceof Error ? e.message : String(e);
  console.error(`[AI] ${label} failed:`, message);
  json(res, 502, { ok: false, error: e instanceof AiResponseError ? `AI response error: ${message}` : "AI provider request failed" });
};

// Cap request bodies so an unauthenticated endpoint (public intake, webhooks,
// registration) can't be used to exhaust memory with a huge payload (F-34).
const MAX_BODY_BYTES = Number(process.env.MAX_BODY_BYTES ?? 1_048_576); // 1 MiB default

class PayloadTooLargeError extends Error {
  constructor() { super("Request body too large"); this.name = "PayloadTooLargeError"; }
}

const parseRawBody = async (req: IncomingMessage): Promise<string> => {
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : chunk;
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      req.destroy();
      throw new PayloadTooLargeError();
    }
    chunks.push(buf);
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
// Coerce a JSON body value to a finite integer (mm/paise) or null; and to an
// optional finite number (undefined = "leave default"). Used by the quote routes.
const numOrNull = (v: unknown): number | null => {
  const n = Number(v);
  return v !== null && v !== undefined && v !== "" && Number.isFinite(n) ? Math.round(n) : null;
};
const numUndef = (v: unknown): number | undefined => {
  if (v === null || v === undefined || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
};
const dateOrNull = (v: unknown): Date | null => {
  if (v === null || v === undefined || v === "") return null;
  const d = new Date(v as string);
  return Number.isNaN(d.getTime()) ? null : d;
};
// Best-effort E.164 normalisation for customer phone entry: keep a leading +, strip
// spaces/dashes, and default a bare 10-digit number to India (+91). Returns null for
// anything that can't be a phone. Not a full libphonenumber — just enough for intake.
const normalizePhoneE164 = (raw: string | null): string | null => {
  if (!raw) return null;
  const cleaned = raw.replace(/[\s\-()]/g, "");
  if (/^\+\d{7,15}$/.test(cleaned)) return cleaned;
  const digits = cleaned.replace(/\D/g, "");
  if (digits.length === 10) return `+91${digits}`;
  if (digits.length >= 11 && digits.length <= 15) return `+${digits}`;
  return null;
};

// Parse a from/to reporting window from the query string (E-15). Returns null
// when NEITHER param is present so each endpoint keeps its own default window
// (preserving prior behaviour). Accepts YYYY-MM-DD (date-only — `to` is treated
// as end-of-day, inclusive) or full ISO timestamps. If only one bound is given,
// the other defaults (to=now, from=to−30d). Swaps if from > to.
const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;
const parseDateRange = (req: IncomingMessage): { from: Date; to: Date } | null => {
  const sp = parseUrl(req.url).searchParams;
  const fromRaw = sp.get("from");
  const toRaw = sp.get("to");
  if (!fromRaw && !toRaw) return null;
  const parse = (v: string | null, endOfDay: boolean): Date | null => {
    if (!v) return null;
    const iso = DATE_ONLY_RE.test(v) ? `${v}T${endOfDay ? "23:59:59.999" : "00:00:00.000"}Z` : v;
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  };
  let to = parse(toRaw, true) ?? new Date();
  let from = parse(fromRaw, false) ?? new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000);
  if (from.getTime() > to.getTime()) { const t = from; from = to; to = t; }
  return { from, to };
};

const ensureTenantAccess = async (tenantId: string) => {
  const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  return Boolean(hotel);
};

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
      permissions,
      // Impersonation (E-6): null on a normal session. When set, the request is
      // acting as `user` but was initiated by this admin — used for audit + the UI banner.
      impersonatorUserId: claims.impersonatorUserId ?? null,
      impersonatorEmail: claims.impersonatorEmail ?? null
    }
  };
};

// The authenticated request context (the ok-branch of getAuthenticatedContext).
type AuthOk = Extract<Awaited<ReturnType<typeof getAuthenticatedContext>>, { ok: true }>;
export type RouteContext = AuthOk["context"];

// Shared route guard (F-32). Collapses the auth → permission preamble that ~60
// route handlers repeated inline (with two drifting formatting styles and an
// inconsistent 401/403 ordering) into one call. It writes the 401/403 response
// itself and returns { ok: false } so the caller just does `if (!auth.ok) return;`.
// The success result keeps the same `.context` shape, so existing downstream
// `auth.context.*` references are unchanged. Pass `permission: null` for routes
// that only require authentication.
async function authorize(
  req: IncomingMessage,
  res: ServerResponse,
  permission: string | null,
): Promise<{ ok: true; context: RouteContext } | { ok: false }> {
  const auth = await getAuthenticatedContext(req);
  if (!auth.ok) {
    json(res, auth.status, { ok: false, error: auth.error });
    return { ok: false };
  }
  if (permission && !canAccess(auth.context.permissions, permission)) {
    json(res, 403, { ok: false, error: "Insufficient permissions" });
    return { ok: false };
  }
  return { ok: true, context: auth.context };
}

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

// CRM contact/company id routing: /contacts/:id, /companies/:id
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
  "POST /auth/impersonate":                "impersonate_users",
  "POST /auth/impersonate/stop":           null,
  "GET /auth/impersonations/recent":       "impersonate_users",
  "GET /tenant/branding":                  "manage_settings",
  "PUT /tenant/branding":                  "manage_settings",
  "GET /tenant/domains":                   "manage_settings",
  "PUT /tenant/domains":                   "manage_settings",
  "POST /tenant/domains/request":          "manage_settings",
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
  "GET /inventory/items":                 "view_reports",
  "POST /inventory/items":                "manage_inventory",
  "PUT /inventory/items/:id":             "manage_inventory",
  "DELETE /inventory/items/:id":          "manage_inventory",
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
  "GET /ai/smart-insights":               "view_reports",
  "POST /ai/classify-event":              "manage_requests",
  "GET /ai/guest-intelligence/:guestId":  "view_guests",
  "GET /ai/revenue-insights":             "view_reports",
  "POST /night-audit/generate":           "night_audit",
  "GET /night-audit/latest":              "view_reports",
  "GET /night-audit/history":             "view_reports",
  "GET /night-audit/report":              "view_reports",
  "GET /night-audit/export":              "view_reports",
  "GET /service-requests/export":         "view_requests",
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
  "GET /pipelines":                       "view_crm",
  "GET /deals":                           "view_crm",
  "GET /deals/forecast":                  "view_crm",
  "GET /deals/:id":                       "view_crm",
  "POST /deals":                          "manage_crm",
  "PATCH /deals/:id":                     "manage_crm",
  "DELETE /deals/:id":                    "manage_crm",
  "POST /deals/:id/move":                 "manage_crm",
  "GET /contacts":                        "view_crm",
  "POST /contacts":                       "manage_crm",
  "GET /contacts/:id":                    "view_crm",
  "PATCH /contacts/:id":                  "manage_crm",
  "DELETE /contacts/:id":                 "manage_crm",
  "GET /companies":                       "view_crm",
  "POST /companies":                      "manage_crm",
  "GET /companies/:id":                   "view_crm",
  "PATCH /companies/:id":                 "manage_crm",
  "DELETE /companies/:id":                "manage_crm",
  "GET /contacts/:id/timeline":           "view_crm",
  "POST /contacts/:id/activities":        "manage_crm",
  "POST /contacts/:id/score":             "manage_crm",
  "GET /tasks":                           "view_crm",
  "PATCH /activities/:id":                "manage_crm",
  "DELETE /activities/:id":               "manage_crm",
  "GET /deals/:id/timeline":              "view_crm",
  "POST /deals/:id/suggest":              "manage_crm",
  "GET /deals/suggestions":               "view_crm",
  "POST /deals/suggestions/:id/accept":   "manage_crm",
  "POST /deals/suggestions/:id/dismiss":  "manage_crm",
  // Quoting + component-based costing (furniture/manufacturing). Reuses CRM perms.
  "GET /quote-templates":                 "view_crm",
  "POST /quote-templates":                "manage_crm",
  "GET /quote-templates/:id":             "view_crm",
  "PATCH /quote-templates/:id":           "manage_crm",
  "DELETE /quote-templates/:id":          "manage_crm",
  "GET /quotes":                          "view_crm",
  "POST /quotes":                         "manage_crm",
  "POST /quotes/calc":                    "view_crm",
  "POST /quotes/parse":                   "view_crm",
  "GET /quotes/:id":                      "view_crm",
  "PATCH /quotes/:id":                    "manage_crm",
  "DELETE /quotes/:id":                   "manage_crm",
  "POST /quotes/:id/lines":               "manage_crm",
  "PATCH /quotes/:id/lines/:lineId":      "manage_crm",
  "DELETE /quotes/:id/lines/:lineId":     "manage_crm",
  "POST /quotes/:id/send":                "manage_crm",
  "POST /quotes/:id/accept":              "manage_crm",
  "POST /quotes/:id/reject":              "manage_crm",
  "POST /quotes/:id/expire":              "manage_crm",
  "GET /quotes/:id/pdf":                  "view_crm",
  "GET /quotes/:id/busy-export":          "manage_crm",
};

const canAccess = (permissions: string[], key: string): boolean => {
  const req = permissionMap[key];
  return req === null || hasPermission(permissions, req);
};

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
      const fwd = req.headers["x-forwarded-for"];
      const ip = (typeof fwd === "string" ? fwd.split(",")[0]?.trim() : undefined) || req.socket.remoteAddress || "unknown";
      if (!rateLimit(`identify:${ip}`, 20, 60_000)) {
        json(res, 429, { ok: false, error: "Too many requests" });
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
      const rfwd = req.headers["x-forwarded-for"];
      const rip = (typeof rfwd === "string" ? rfwd.split(",")[0]?.trim() : undefined) || req.socket.remoteAddress || "unknown";
      if (!rateLimit(`register:${rip}`, 5, 60 * 60_000)) {
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
      const pfwd = req.headers["x-forwarded-for"];
      const pip = (typeof pfwd === "string" ? pfwd.split(",")[0]?.trim() : undefined) || req.socket.remoteAddress || "unknown";
      if (!rateLimit(`public-req:${pip}`, 10, 60_000)) {
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
      const enforce = process.env.VERIFY_WEBHOOKS === "true";

      const twilioSig = typeof req.headers["x-twilio-signature"] === "string" ? req.headers["x-twilio-signature"] : null;
      const interaktSigPresent = typeof req.headers["x-hub-signature-256"] === "string" || typeof req.headers["x-interakt-signature"] === "string";
      // Close the omission bypass: when enforcing, a request with no provider
      // signature at all must be rejected rather than silently accepted (F-9).
      if (enforce && twilioSig === null && !interaktSigPresent) {
        json(res, 401, { ok: false, error: "Missing webhook signature" }); return;
      }
      if (twilioSig !== null) {
        // Twilio's HMAC covers the exact public URL it POSTed to PLUS the sorted form
        // params — the old call passed params:{} and a spoofable Host-header URL, so
        // verification could never pass (decorative). Use the configured public URL
        // (TWILIO_WEBHOOK_URL / EYNIS_PUBLIC_URL, never the request Host which a caller
        // controls) and the real form params parsed from the body. Enforcement stays
        // opt-in (VERIFY_WEBHOOKS) so a URL mismatch can't break the default deploy;
        // operators should validate against a live Twilio number before enforcing.
        const configuredBase = (process.env.TWILIO_WEBHOOK_URL ?? process.env.EYNIS_PUBLIC_URL ?? "").trim();
        const fullUrl = configuredBase
          ? configuredBase
          : `https://${req.headers.host ?? "localhost"}${req.url}`;
        const isForm = (req.headers["content-type"] ?? "").includes("application/x-www-form-urlencoded");
        const twilioParams = isForm ? Object.fromEntries(new URLSearchParams(rawBody)) : {};
        const check = checkWebhookSignature({ provider: "twilio", signature: twilioSig, url: fullUrl, rawBody, params: twilioParams, enforce });
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

    if (parseUrl(req.url).pathname === "/analytics/revenue-intelligence" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /analytics/revenue-intelligence");
      if (!auth.ok) return;
      const context = auth.context;
      // Optional reporting window (E-15); null → all-time (prior behaviour).
      const revRange = parseDateRange(req);
      const revCreatedAt = revRange ? { createdAt: { gte: revRange.from, lte: revRange.to } } : {};

      const [offerEvents, openRequests] = await Promise.all([
        prisma.offerEvent.findMany({
          where: { tenantId: context.tenantId, ...revCreatedAt },
          select: { offerType: true, status: true, revenueInr: true }
        }),
        prisma.serviceRequest.count({
          where: { tenantId: context.tenantId, status: { not: "resolved" }, ...revCreatedAt }
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

    if (parseUrl(req.url).pathname === "/analytics/staff-performance" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /analytics/staff-performance");
      if (!auth.ok) return;
      const context = auth.context;
      // Optional reporting window (E-15); null → all-time (prior behaviour).
      const staffRange = parseDateRange(req);
      const staffCreatedAt = staffRange ? { createdAt: { gte: staffRange.from, lte: staffRange.to } } : {};

      const [users, requests, staffSentiment] = await Promise.all([
        prisma.user.findMany({
          where: { tenantId: context.tenantId, isActive: true },
          select: { id: true, fullName: true, role: true }
        }),
        prisma.serviceRequest.findMany({
          where: { tenantId: context.tenantId, ...staffCreatedAt },
          select: { status: true, assignedToUserId: true, createdAt: true, resolvedAt: true }
        }),
        computeSentimentAnalytics(context.tenantId, staffRange ?? undefined)
      ]);
      // Real guest rating derived from sentiment feedback (0..100 net score → 0..5),
      // or null when there's no feedback — never a hardcoded 0 (F-17).
      const avgGuestRating = staffSentiment.totalFeedback > 0
        ? Math.round((staffSentiment.netScore / 20) * 10) / 10
        : null;

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
          avgGuestRating,
          utilizationRate
        },
        leaderboard,
        workloadByRole,
        alerts
      });
      return;
    }

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

    // ── GET /automations/executions ──────────────────────────────────────────
    if (req.url?.startsWith("/automations/executions") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /automations/executions");
      if (!auth.ok) return;
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
        page: { limit, offset, total, hasMore: offset + execs.length < total }
      });
      return;
    }

    // ── GET /automations ─────────────────────────────────────────────────────
    if (req.url?.startsWith("/automations") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /automations");
      if (!auth.ok) return;
      const context = auth.context;
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
      const auth = await authorize(req, res, "GET /analytics/sentiment");
      if (!auth.ok) return;
      const context = auth.context;
      json(res, 200, await computeSentimentAnalytics(context.tenantId, parseDateRange(req) ?? undefined));
      return;
    }

    // ── GET /analytics/upsell-campaigns ─────────────────────────────────────
    if (req.url?.startsWith("/analytics/upsell-campaigns") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /analytics/upsell-campaigns");
      if (!auth.ok) return;
      const context = auth.context;
      json(res, 200, await computeUpsellAnalytics(context.tenantId, parseDateRange(req) ?? undefined));
      return;
    }

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
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        if (!hasPermission(auth.context.permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        json(res, 200, { ok: true, sources: REPORT_SOURCES });
        return;
      }

      // POST /reports/run — execute an ad-hoc definition (builder live preview).
      if (rpath === "/reports/run" && req.method === "POST") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const body = (await parseBody(req)) as { definition?: ReportDefinition };
        const def = body.definition;
        if (!def || typeof def !== "object") { json(res, 400, { ok: false, error: "definition is required" }); return; }
        const source = getReportSource(def.source);
        if (!source) { json(res, 400, { ok: false, error: "Unknown data source" }); return; }
        if (!hasPermission(permissions, source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${source.label}` }); return; }
        const result = await runReportDefinition(tenantId, def);
        json(res, result.ok ? 200 : 400, result);
        return;
      }

      // GET /reports — list saved reports the user can see (own + shared).
      if (rpath === "/reports" && req.method === "GET") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
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
        return;
      }

      // POST /reports — save a new report.
      if (rpath === "/reports" && req.method === "POST") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const body = (await parseBody(req)) as { name?: unknown; description?: unknown; shared?: unknown; definition?: ReportDefinition };
        const name = asTrimmedString(body.name);
        if (!name) { json(res, 400, { ok: false, error: "name is required" }); return; }
        const def = body.definition;
        if (!def || typeof def !== "object") { json(res, 400, { ok: false, error: "definition is required" }); return; }
        const valid = validateDefinition(def);
        if (!valid.ok) { json(res, 400, valid); return; }
        if (!hasPermission(permissions, valid.source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${valid.source.label}` }); return; }
        const created = await prisma.report.create({
          data: {
            tenantId, name, description: asTrimmedString(body.description),
            source: valid.source.key, definitionJson: JSON.stringify(def),
            shared: body.shared === true, createdById: userId,
          },
          select: { id: true },
        });
        json(res, 201, { ok: true, id: created.id });
        return;
      }

      const runMatch = /^\/reports\/([^/]+)\/run$/.exec(rpath);
      const exportMatch = /^\/reports\/([^/]+)\/export$/.exec(rpath);
      const sharesMatch = /^\/reports\/([^/]+)\/shares$/.exec(rpath);
      const idMatch = /^\/reports\/([^/]+)$/.exec(rpath);

      // GET /reports/:id/run — run a saved report.
      if (runMatch && req.method === "GET") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const id = decodeURIComponent(runMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId } });
        if (!report || !(await canViewReport(report, id, tenantId, userId, roleKey))) { json(res, 404, { ok: false, error: "Report not found" }); return; }
        const def = parseDef(report.definitionJson);
        const source = def && getReportSource(def.source);
        if (!def || !source) { json(res, 400, { ok: false, error: "Invalid report definition" }); return; }
        if (!hasPermission(permissions, source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${source.label}` }); return; }
        const result = await runReportDefinition(tenantId, def);
        if (!result.ok) { json(res, 400, result); return; }
        json(res, 200, { ...result, name: report.name });
        return;
      }

      // GET /reports/:id/export?format=csv — branded CSV of a saved report.
      if (exportMatch && req.method === "GET") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const id = decodeURIComponent(exportMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId } });
        if (!report || !(await canViewReport(report, id, tenantId, userId, roleKey))) { json(res, 404, { ok: false, error: "Report not found" }); return; }
        const def = parseDef(report.definitionJson);
        const source = def && getReportSource(def.source);
        if (!def || !source) { json(res, 400, { ok: false, error: "Invalid report definition" }); return; }
        if (!hasPermission(permissions, source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${source.label}` }); return; }
        const result = await runReportDefinition(tenantId, def);
        if (!result.ok) { json(res, 400, result); return; }
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
          return;
        }
        // html / pdf render the result as a single branded table block (E-16 Phase B).
        const tableRows: Array<Array<string | number>> = rows.map((r) => r.map((c) => (c === null || c === undefined ? "" : typeof c === "number" ? c : String(c))));
        const blocks: ReportBlock[] = [{ kind: "table", header, rows: tableRows }];
        const subtitle = report.description ?? undefined;
        if (format === "html") {
          sendDoc(res, "text/html; charset=utf-8", renderBrandedReportHtml(brand, { title: report.name, subtitle, blocks }));
          return;
        }
        const pdf = await renderBrandedReportPdf(brand, { title: report.name, subtitle, blocks });
        sendBinary(res, "application/pdf", pdf, `${safeName}.pdf`);
        return;
      }

      // GET /reports/:id — fetch a saved report's definition.
      if (idMatch && req.method === "GET") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId, roleKey } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const id = decodeURIComponent(idMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId } });
        if (!report || !(await canViewReport(report, id, tenantId, userId, roleKey))) { json(res, 404, { ok: false, error: "Report not found" }); return; }
        json(res, 200, {
          ok: true,
          report: {
            id: report.id, name: report.name, description: report.description, source: report.source,
            shared: report.shared, isOwner: report.createdById === userId, definition: parseDef(report.definitionJson),
          },
        });
        return;
      }

      // GET /reports/:id/shares — current grants + pickable users/roles. Creator
      // only: sharing is a management action, not something a viewer can inspect.
      if (sharesMatch && req.method === "GET") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const id = decodeURIComponent(sharesMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!report) { json(res, 404, { ok: false, error: "Report not found" }); return; }
        if (report.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can manage sharing" }); return; }
        const [shares, users, roles] = await Promise.all([
          prisma.reportShare.findMany({ where: { reportId: id, tenantId }, select: { principalType: true, principalId: true } }),
          prisma.user.findMany({ where: { tenantId, isActive: true }, select: { id: true, fullName: true, email: true }, orderBy: { fullName: "asc" } }),
          prisma.role.findMany({ where: { tenantId }, select: { key: true, displayName: true }, orderBy: { displayName: "asc" } }),
        ]);
        // The owner already has access — no point offering to share with themselves.
        json(res, 200, { ok: true, shares, users: users.filter((u) => u.id !== userId), roles });
        return;
      }

      // PUT /reports/:id/shares — replace the full grant set (creator only).
      // Body: { shares: [{ principalType: "user"|"role", principalId }] }.
      if (sharesMatch && req.method === "PUT") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const id = decodeURIComponent(sharesMatch[1] as string);
        const report = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!report) { json(res, 404, { ok: false, error: "Report not found" }); return; }
        if (report.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can manage sharing" }); return; }
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
        return;
      }

      // PUT /reports/:id — update (creator only).
      if (idMatch && req.method === "PUT") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const id = decodeURIComponent(idMatch[1] as string);
        const existing = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!existing) { json(res, 404, { ok: false, error: "Report not found" }); return; }
        if (existing.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can edit it" }); return; }
        const body = (await parseBody(req)) as { name?: unknown; description?: unknown; shared?: unknown; definition?: ReportDefinition };
        const data: Record<string, unknown> = {};
        const name = asTrimmedString(body.name);
        if (name) data.name = name;
        if ("description" in body) data.description = asTrimmedString(body.description);
        if (typeof body.shared === "boolean") data.shared = body.shared;
        if (body.definition && typeof body.definition === "object") {
          const valid = validateDefinition(body.definition);
          if (!valid.ok) { json(res, 400, valid); return; }
          if (!hasPermission(permissions, valid.source.permission)) { json(res, 403, { ok: false, error: `You don't have access to ${valid.source.label}` }); return; }
          data.source = valid.source.key;
          data.definitionJson = JSON.stringify(body.definition);
        }
        await prisma.report.update({ where: { id }, data });
        json(res, 200, { ok: true });
        return;
      }

      // DELETE /reports/:id — delete (creator only).
      if (idMatch && req.method === "DELETE") {
        const auth = await authorize(req, res, null); if (!auth.ok) return;
        const { permissions, tenantId, userId } = auth.context;
        if (!hasPermission(permissions, "view_reports")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const id = decodeURIComponent(idMatch[1] as string);
        const existing = await prisma.report.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
        if (!existing) { json(res, 404, { ok: false, error: "Report not found" }); return; }
        if (existing.createdById !== userId) { json(res, 403, { ok: false, error: "Only the report's creator can delete it" }); return; }
        await prisma.report.delete({ where: { id } });
        json(res, 200, { ok: true });
        return;
      }
    }

    // ── Research Studio: configurable research & report module (RS-1) ─────────
    // Gated by the research_studio license feature + per-action permissions
    // (view_research / run_research / manage_research). Runs execute async on the
    // research worker; the UI polls GET /research/runs/:id (and the global SSE feed
    // carries "research_run" progress events). All queries are tenant-scoped.
    {
      const rpath = parseUrl(req.url).pathname;
      if (rpath === "/research" || rpath.startsWith("/research/")) {
        const denyPerm = () => json(res, 403, { ok: false, error: "Insufficient permissions" });
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
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          if (!hasPermission(auth.context.permissions, "view_research")) { denyPerm(); return; }
          const [searchProviders, aiCreds] = await Promise.all([
            searchProvidersAvailable(auth.context.tenantId),
            resolveAiCredentials(auth.context.tenantId),
          ]);
          json(res, 200, {
            ok: true, sources: RESEARCH_SOURCE_CATALOG, subjectTypes: SUBJECT_TYPES, outputs: SECTION_OUTPUTS,
            searchConfigured: searchProviders.searxng || searchProviders.tavily, searchProviders,
            aiConfigured: aiConfigured(aiCreds),
          });
          return;
        }

        // GET /research/templates — built-ins + tenant templates.
        if (rpath === "/research/templates" && req.method === "GET") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          if (!(await ensureResearchLicense(tenantId))) return;
          const items = await listTemplates(tenantId);
          json(res, 200, { ok: true, items: items.map((t) => ({ ...t, isOwner: t.createdById === userId })) });
          return;
        }

        // POST /research/templates — create a saved template.
        if (rpath === "/research/templates" && req.method === "POST") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "manage_research")) { denyPerm(); return; }
          if (!(await ensureResearchLicense(tenantId))) return;
          const body = (await parseBody(req)) as Record<string, unknown>;
          const valid = validateTemplateDef(body);
          if (!valid.ok) { json(res, 400, valid); return; }
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
          return;
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
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const rule = await prisma.automationRule.findUnique({ where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } } });
          json(res, 200, { ok: true, triggers: rule ? readTriggers(rule.configJson) : [], isActive: rule?.isActive ?? false });
          return;
        }

        if (rpath === "/research/triggers" && req.method === "POST") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId } = auth.context;
          if (!hasPermission(permissions, "manage_research")) { denyPerm(); return; }
          if (!(await ensureResearchLicense(tenantId))) return;
          const body = (await parseBody(req)) as { stageId?: unknown; templateId?: unknown; fast?: unknown };
          const stageId = asTrimmedString(body.stageId);
          const templateId = asTrimmedString(body.templateId);
          if (!stageId || !templateId) { json(res, 400, { ok: false, error: "stageId and templateId are required" }); return; }
          const stage = await prisma.stage.findFirst({ where: { id: stageId, tenantId }, select: { id: true } });
          if (!stage) { json(res, 404, { ok: false, error: "Stage not found" }); return; }
          const tpl = await loadTemplateForRun(tenantId, templateId);
          if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return; }
          const existing = await prisma.automationRule.findUnique({ where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } } });
          const triggers = existing ? readTriggers(existing.configJson).filter((t) => t.stageId !== stageId) : [];
          triggers.push({ stageId, templateId, fast: body.fast !== false });
          await prisma.automationRule.upsert({
            where: { tenantId_code: { tenantId, code: RESEARCH_RULE_CODE } },
            update: { configJson: JSON.stringify({ triggers }), isActive: true },
            create: { tenantId, code: RESEARCH_RULE_CODE, name: "Auto-run research on deal stage", isActive: true, configJson: JSON.stringify({ triggers }) },
          });
          json(res, 200, { ok: true, triggers });
          return;
        }

        const triggerDelMatch = /^\/research\/triggers\/([^/]+)$/.exec(rpath);
        if (triggerDelMatch && req.method === "DELETE") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId } = auth.context;
          if (!hasPermission(permissions, "manage_research")) { denyPerm(); return; }
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
          return;
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
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const id = decodeURIComponent(tplMatch[1] as string);
          const detail = await getTemplateDetail(tenantId, id);
          if (!detail) { json(res, 404, { ok: false, error: "Template not found" }); return; }
          json(res, 200, { ok: true, template: { id: detail.id, isBuiltIn: detail.isBuiltIn, isOwner: detail.createdById === userId, ...detail.def } });
          return;
        }

        // PUT /research/templates/:id — update (built-ins are read-only; clone instead).
        if (tplMatch && req.method === "PUT") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId } = auth.context;
          if (!hasPermission(permissions, "manage_research")) { denyPerm(); return; }
          const id = decodeURIComponent(tplMatch[1] as string);
          if (isBuiltinId(id)) { json(res, 400, { ok: false, error: "Built-in templates can't be edited — duplicate it first" }); return; }
          const existing = await prisma.researchTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
          if (!existing) { json(res, 404, { ok: false, error: "Template not found" }); return; }
          const body = (await parseBody(req)) as Record<string, unknown>;
          const valid = validateTemplateDef(body);
          if (!valid.ok) { json(res, 400, valid); return; }
          const def = valid.def;
          await prisma.researchTemplate.update({
            where: { id },
            data: {
              name: def.name, description: def.description ?? null, subjectType: def.subjectType,
              inputsJson: JSON.stringify(def.inputs), sourcesJson: JSON.stringify(def.sources), sectionsJson: JSON.stringify(def.sections),
            },
          });
          json(res, 200, { ok: true });
          return;
        }

        // DELETE /research/templates/:id — delete (built-ins read-only).
        if (tplMatch && req.method === "DELETE") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId } = auth.context;
          if (!hasPermission(permissions, "manage_research")) { denyPerm(); return; }
          const id = decodeURIComponent(tplMatch[1] as string);
          if (isBuiltinId(id)) { json(res, 400, { ok: false, error: "Built-in templates can't be deleted" }); return; }
          const existing = await prisma.researchTemplate.findFirst({ where: { id, tenantId }, select: { id: true } });
          if (!existing) { json(res, 404, { ok: false, error: "Template not found" }); return; }
          await prisma.researchTemplate.delete({ where: { id } });
          json(res, 200, { ok: true });
          return;
        }

        // POST /research/runs — enqueue a run against a template.
        if (rpath === "/research/runs" && req.method === "POST") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "run_research")) { denyPerm(); return; }
          if (!(await ensureResearchLicense(tenantId))) return;
          const body = (await parseBody(req)) as {
            templateId?: unknown; inputs?: unknown; subjectType?: unknown; subjectId?: unknown; subjectLabel?: unknown; fast?: unknown;
          };
          const templateId = asTrimmedString(body.templateId);
          if (!templateId) { json(res, 400, { ok: false, error: "templateId is required" }); return; }
          const tpl = await loadTemplateForRun(tenantId, templateId);
          if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return; }
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
            if (!owned) { json(res, 404, { ok: false, error: "Subject not found" }); return; }
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
          return;
        }

        // POST /research/runs/:id/rerun — re-run with the same snapshot/inputs/subject (RS-4).
        const runRerunMatch = /^\/research\/runs\/([^/]+)\/rerun$/.exec(rpath);
        if (runRerunMatch && req.method === "POST") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          if (!hasPermission(permissions, "run_research")) { denyPerm(); return; }
          if (!(await ensureResearchLicense(tenantId))) return;
          const id = decodeURIComponent(runRerunMatch[1] as string);
          const prev = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!prev || !(await canViewRun(prev, id, tenantId, userId, roleKey, permissions))) { json(res, 404, { ok: false, error: "Run not found" }); return; }
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
          return;
        }

        // GET /research/runs — list recent runs the requester can see (own + shared
        // tenant-wide + explicitly granted). Managers (manage_research) see all runs.
        if (rpath === "/research/runs" && req.method === "GET") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
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
          return;
        }

        // GET /research/runs/:id/export?format=pdf|csv|html — branded export.
        if (runExportMatch && req.method === "GET") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const id = decodeURIComponent(runExportMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run || !(await canViewRun(run, id, tenantId, userId, roleKey, permissions))) { json(res, 404, { ok: false, error: "Run not found" }); return; }
          if (run.status !== "ready" || !run.resultJson) { json(res, 409, { ok: false, error: "Report is not ready yet" }); return; }
          const result = JSON.parse(run.resultJson) as SynthResult;
          const brand = await loadReportBrand(tenantId);
          const title = run.templateName;
          const subtitle = run.subjectLabel ?? undefined;
          const safeName = (run.subjectLabel ?? run.templateName).replace(/[^a-z0-9]+/gi, "-").toLowerCase().replace(/^-|-$/g, "") || "research";
          const fmt = parseUrl(req.url).searchParams.get("format");
          if (fmt === "csv") {
            sendDoc(res, "text/csv; charset=utf-8", brandedCsv(brand, title, buildReportCsv(result)), `${safeName}.csv`);
            return;
          }
          const blocks: ReportBlock[] = buildReportBlocks({ title, subject: run.subjectLabel ?? "", score: run.score, result });
          if (fmt === "pdf") {
            const pdf = await renderBrandedReportPdf(brand, { title, subtitle, blocks });
            sendBinary(res, "application/pdf", pdf, `${safeName}.pdf`);
            return;
          }
          sendDoc(res, "text/html; charset=utf-8", renderBrandedReportHtml(brand, { title, subtitle, blocks }));
          return;
        }

        // GET /research/runs/:id/schedule — the active recurring schedule (if any)
        // for this run's subject, so the run view can show its auto-refresh state.
        if (runScheduleMatch && req.method === "GET") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const id = decodeURIComponent(runScheduleMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return; }
          const schedule = await prisma.researchSchedule.findFirst({ where: scheduleMatchFor(run), orderBy: { createdAt: "desc" } });
          json(res, 200, { ok: true, schedule: schedule ? serializeSchedule(schedule) : null });
          return;
        }

        // POST /research/runs/:id/schedule — turn on (or update) recurring
        // re-research for this run's subject. Body: { cadence: daily|weekly|monthly }.
        // The clock-driven twin of /rerun: it snapshots the run's params.
        if (runScheduleMatch && req.method === "POST") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "run_research")) { denyPerm(); return; }
          if (!(await ensureResearchLicense(tenantId))) return;
          const id = decodeURIComponent(runScheduleMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return; }
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
          return;
        }

        // GET /research/schedules — all recurring schedules in the tenant.
        if (rpath === "/research/schedules" && req.method === "GET") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const rows = await prisma.researchSchedule.findMany({ where: { tenantId }, orderBy: [{ isActive: "desc" }, { nextRunAt: "asc" }] });
          json(res, 200, { ok: true, items: rows.map(serializeSchedule) });
          return;
        }

        // PATCH /research/schedules/:id — change cadence or pause/resume. Creator
        // or a manager (manage_research) only. DELETE removes it entirely.
        if (scheduleIdMatch && (req.method === "PATCH" || req.method === "DELETE")) {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "run_research")) { denyPerm(); return; }
          const id = decodeURIComponent(scheduleIdMatch[1] as string);
          const sched = await prisma.researchSchedule.findFirst({ where: { id, tenantId } });
          if (!sched) { json(res, 404, { ok: false, error: "Schedule not found" }); return; }
          if (sched.createdById !== userId && !hasPermission(permissions, "manage_research")) {
            json(res, 403, { ok: false, error: "Only the schedule's creator or a manager can change it" }); return;
          }
          if (req.method === "DELETE") {
            await prisma.researchSchedule.delete({ where: { id } });
            json(res, 200, { ok: true });
            return;
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
          return;
        }

        // GET /research/runs/:id/shares — current grants + pickable users/roles +
        // the tenant-wide `shared` flag. Creator only: sharing is a management action.
        if (runSharesMatch && req.method === "GET") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const id = decodeURIComponent(runSharesMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true, shared: true } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return; }
          if (run.createdById !== userId) { json(res, 403, { ok: false, error: "Only the run's creator can manage sharing" }); return; }
          const [shares, users, roles] = await Promise.all([
            prisma.researchShare.findMany({ where: { runId: id, tenantId }, select: { principalType: true, principalId: true } }),
            prisma.user.findMany({ where: { tenantId, isActive: true }, select: { id: true, fullName: true, email: true }, orderBy: { fullName: "asc" } }),
            prisma.role.findMany({ where: { tenantId }, select: { key: true, displayName: true }, orderBy: { displayName: "asc" } }),
          ]);
          json(res, 200, { ok: true, shared: run.shared, shares, users: users.filter((u) => u.id !== userId), roles });
          return;
        }

        // PUT /research/runs/:id/shares — replace the grant set + set tenant-wide
        // visibility (creator only). Body: { shared?: boolean, shares: [{ principalType, principalId }] }.
        if (runSharesMatch && req.method === "PUT") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const id = decodeURIComponent(runSharesMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId }, select: { id: true, createdById: true } });
          if (!run) { json(res, 404, { ok: false, error: "Run not found" }); return; }
          if (run.createdById !== userId) { json(res, 403, { ok: false, error: "Only the run's creator can manage sharing" }); return; }
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
          return;
        }

        // GET /research/runs/:id — run detail + result (for polling + preview).
        if (runIdMatch && req.method === "GET") {
          const auth = await authorize(req, res, null); if (!auth.ok) return;
          const { permissions, tenantId, userId, roleKey } = auth.context;
          if (!hasPermission(permissions, "view_research")) { denyPerm(); return; }
          const id = decodeURIComponent(runIdMatch[1] as string);
          const run = await prisma.researchRun.findFirst({ where: { id, tenantId } });
          if (!run || !(await canViewRun(run, id, tenantId, userId, roleKey, permissions))) { json(res, 404, { ok: false, error: "Run not found" }); return; }
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
          return;
        }
      }
    }

    // ── Inventory (vertical with real persistence) ───────────────────────────
    if (req.url === "/inventory/items" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /inventory/items");
      if (!auth.ok) return;
      const items = await listInventory(auth.context.tenantId);
      json(res, 200, { ok: true, items });
      return;
    }

    if (req.url === "/inventory/items" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /inventory/items");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const name = asTrimmedString(body.name);
      if (!name) { json(res, 400, { ok: false, error: "name is required" }); return; }
      const txType = (["received", "used", "waste"].includes(String(body.txType)) ? body.txType : "received") as MovementType;
      const qty = Number(body.qty);
      if (!Number.isFinite(qty) || qty < 0) { json(res, 400, { ok: false, error: "qty must be a non-negative number" }); return; }
      try {
        const item = await applyMovement(auth.context.tenantId, {
          name, txType, qty,
          category: asTrimmedString(body.category) ?? undefined,
          unit: asTrimmedString(body.unit) ?? undefined,
          reorderLevel: body.reorderLevel != null ? Number(body.reorderLevel) : undefined,
          unitCostInr: body.unitCostInr != null ? Math.round(Number(body.unitCostInr)) : undefined,
        });
        json(res, 200, { ok: true, item });
      } catch (e) {
        json(res, 400, { ok: false, error: e instanceof Error ? e.message : "Invalid request" });
      }
      return;
    }

    const invItemMatch = /^\/inventory\/items\/([^/]+)$/.exec(req.url ?? "");
    if (invItemMatch && req.method === "PUT") {
      const auth = await authorize(req, res, "PUT /inventory/items/:id");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const fields: Partial<{ name: string; category: string; stock: number; unit: string; reorderLevel: number; unitCostInr: number }> = {};
      const nm = asTrimmedString(body.name); if (nm) fields.name = nm;
      const cat = asTrimmedString(body.category); if (cat) fields.category = cat;
      const un = asTrimmedString(body.unit); if (un) fields.unit = un;
      if (body.stock != null && Number.isFinite(Number(body.stock))) fields.stock = Math.max(0, Number(body.stock));
      if (body.reorderLevel != null && Number.isFinite(Number(body.reorderLevel))) fields.reorderLevel = Math.max(0, Number(body.reorderLevel));
      if (body.unitCostInr != null && Number.isFinite(Number(body.unitCostInr))) fields.unitCostInr = Math.round(Number(body.unitCostInr));
      const item = await updateItem(auth.context.tenantId, invItemMatch[1], fields);
      if (!item) { json(res, 404, { ok: false, error: "Item not found" }); return; }
      json(res, 200, { ok: true, item });
      return;
    }
    if (invItemMatch && req.method === "DELETE") {
      const auth = await authorize(req, res, "DELETE /inventory/items/:id");
      if (!auth.ok) return;
      const removed = await deleteItem(auth.context.tenantId, invItemMatch[1]);
      if (!removed) { json(res, 404, { ok: false, error: "Item not found" }); return; }
      json(res, 200, { ok: true });
      return;
    }

    // ── Quoting + component-based costing (furniture/manufacturing) ───────────
    // A quote is a bill of materials: line items (components) costed by dimension ×
    // rate + labor, rolled up with overhead + margin. Sent quotes are immutable
    // (rates snapshotted at add-time; edits rejected once status leaves "draft").

    // Quote templates (reusable presets, e.g. "Dining Table").
    if (req.url === "/quote-templates" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /quote-templates");
      if (!auth.ok) return;
      json(res, 200, { ok: true, items: await quotes.listTemplates(auth.context.tenantId) });
      return;
    }
    if (req.url === "/quote-templates" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quote-templates");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const name = asTrimmedString(body.name);
      if (!name) { json(res, 400, { ok: false, error: "name is required" }); return; }
      try {
        const tpl = await quotes.createTemplate(auth.context.tenantId, { ...body, name } as unknown as quotes.TemplatePayload);
        json(res, 200, { ok: true, template: tpl });
      } catch (e) {
        json(res, 400, { ok: false, error: e instanceof Error ? e.message : "Invalid template" });
      }
      return;
    }
    const tplMatch = /^\/quote-templates\/([^/]+)$/.exec(req.url ?? "");
    if (tplMatch && req.method === "GET") {
      const auth = await authorize(req, res, "GET /quote-templates/:id");
      if (!auth.ok) return;
      const tpl = await quotes.getTemplate(auth.context.tenantId, tplMatch[1]);
      if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return; }
      json(res, 200, { ok: true, template: tpl });
      return;
    }
    if (tplMatch && req.method === "PATCH") {
      const auth = await authorize(req, res, "PATCH /quote-templates/:id");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const tpl = await quotes.updateTemplate(auth.context.tenantId, tplMatch[1], body as unknown as quotes.TemplatePayload);
      if (!tpl) { json(res, 404, { ok: false, error: "Template not found" }); return; }
      json(res, 200, { ok: true, template: tpl });
      return;
    }
    if (tplMatch && req.method === "DELETE") {
      const auth = await authorize(req, res, "DELETE /quote-templates/:id");
      if (!auth.ok) return;
      const ok = await quotes.deleteTemplate(auth.context.tenantId, tplMatch[1]);
      if (!ok) { json(res, 404, { ok: false, error: "Template not found" }); return; }
      json(res, 200, { ok: true });
      return;
    }

    // Live cost preview — no persistence. Powers the "as you type" builder totals.
    if (req.url === "/quotes/calc" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quotes/calc");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const lines = Array.isArray(body.lines) ? (body.lines as Record<string, unknown>[]) : [];
      const costingMod = await import("./core/quotes/costing");
      const preview = costingMod.priceQuote(
        lines.map((l) => ({
          costBasis: quotes.normalizeBasis(l.costBasis),
          lengthMm: numOrNull(l.lengthMm),
          widthMm: numOrNull(l.widthMm),
          heightMm: numOrNull(l.heightMm),
          quantity: Number(l.quantity) || 1,
          unitRatePaise: Math.max(0, Math.round(Number(l.unitRatePaise) || 0)),
          wastagePct: Math.max(0, Number(l.wastagePct) || 0),
          laborHours: Math.max(0, Number(l.laborHours) || 0),
          laborRatePaise: Math.max(0, Math.round(Number(l.laborRatePaise) || 0)),
        })),
        {
          overheadPct: Number(body.overheadPct) || 0,
          marginPct: Number(body.marginPct) || 0,
          marginFloorPct: Number(body.marginFloorPct) || 0,
          discountPaise: Math.max(0, Math.round(Number(body.discountPaise) || 0)),
        },
      );
      json(res, 200, { ok: true, preview });
      return;
    }

    // AI-assist: free text → draft line items (reviewed by a human before saving).
    if (req.url === "/quotes/parse" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quotes/parse");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const text = asTrimmedString(body.text);
      if (!text) { json(res, 400, { ok: false, error: "text is required" }); return; }
      // Resolve the tenant's AI credentials (Integrations key → env fallback) and pick
      // the provider the same way Research Studio does — so this works OpenAI-only and
      // honours RESEARCH_AI_PROVIDER, instead of wrongly preferring Claude whenever any
      // Anthropic key is present (which surfaced as a misleading "Could not parse").
      const creds = await resolveAiCredentials(auth.context.tenantId);
      if (!aiConfigured(creds)) { json(res, 200, { ok: true, lines: [], note: "AI is not configured; add an OpenAI or Anthropic key under Integrations, or enter line items manually." }); return; }
      const provider = chooseProvider(creds);
      const apiKey = providerKey(creds, provider) ?? undefined;
      const system = "You extract furniture/manufacturing quote line items from a free-text description. " +
        "Return ONLY JSON: {\"lines\":[{\"groupName\":string,\"name\":string,\"kind\":\"material|labor|hardware|finish|other\"," +
        "\"costBasis\":\"area|length|perimeter|volume|fixed|hours\",\"lengthMm\":number|null,\"widthMm\":number|null," +
        "\"heightMm\":number|null,\"quantity\":number,\"materialUnit\":string}]}. Convert any dimensions to millimetres. " +
        "A flat panel/top is costBasis \"area\"; a leg/rail is \"length\"; hardware/fixed items are \"fixed\". Do not invent prices.";
      try {
        const raw = await aiCompleteTiered(text, { tier: "cheap", maxTokens: 1200, system, provider, apiKey });
        const parsed = extractJson(raw) as { lines?: unknown[] } | null;
        const out = Array.isArray(parsed?.lines) ? parsed!.lines : [];
        // Clamp everything server-side — never trust AI numbers directly.
        const lines = out.slice(0, 40).map((l) => {
          const o = (l ?? {}) as Record<string, unknown>;
          return {
            groupName: asTrimmedString(o.groupName) ?? "General",
            name: asTrimmedString(o.name) ?? "Component",
            kind: quotes.normalizeKind(o.kind),
            costBasis: quotes.normalizeBasis(o.costBasis),
            lengthMm: numOrNull(o.lengthMm),
            widthMm: numOrNull(o.widthMm),
            heightMm: numOrNull(o.heightMm),
            quantity: Math.max(0, Number(o.quantity) || 1),
            materialUnit: asTrimmedString(o.materialUnit) ?? "sqft",
            unitRatePaise: 0,
          };
        });
        // Distinguish "the model replied but we couldn't extract items" from a hard failure.
        const note = lines.length === 0 ? "The AI could not extract line items from that description — try adding dimensions, or enter them manually." : undefined;
        json(res, 200, { ok: true, lines, ...(note ? { note } : {}) });
      } catch (err) {
        // Log the real reason server-side (key invalid, model access, network) — never
        // leak provider error text to the client.
        console.warn(`[quotes/parse] AI request failed (provider=${provider}):`, err instanceof Error ? err.message : err);
        json(res, 200, { ok: true, lines: [], note: `AI request failed (${provider}). Check the ${provider === "openai" ? "OpenAI" : "Anthropic"} key in Integrations, or enter line items manually.` });
      }
      return;
    }

    if (req.url?.startsWith("/quotes") && parseUrl(req.url).pathname === "/quotes" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /quotes");
      if (!auth.ok) return;
      const qs = parseUrl(req.url).searchParams;
      const limit = asSafeLimit(qs.get("limit"), 50, 200);
      const offset = asSafeOffset(qs.get("offset"));
      const { items, total } = await quotes.listQuotes(auth.context.tenantId, {
        status: asTrimmedString(qs.get("status")) ?? undefined,
        contactId: asTrimmedString(qs.get("contactId")) ?? undefined,
        dealId: asTrimmedString(qs.get("dealId")) ?? undefined,
        limit, offset,
      });
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return;
    }
    if (req.url === "/quotes" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /quotes");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as Record<string, unknown>;
      const title = asTrimmedString(body.title);
      if (!title) { json(res, 400, { ok: false, error: "title is required" }); return; }
      // Resolve the customer: an explicit contactId, else a new-customer object
      // {fullName, phoneE164, email} which we find-or-create by phone. Linking a
      // contact is what lets Send start the follow-up drip (a quote with no contact
      // can only log a task — the drip has no channel to reach).
      let contactId = asTrimmedString(body.contactId);
      if (!contactId && body.customer && typeof body.customer === "object") {
        const cust = body.customer as Record<string, unknown>;
        const phone = normalizePhoneE164(asTrimmedString(cust.phoneE164));
        if (phone) {
          const existing = await prisma.contact.findFirst({ where: { tenantId: auth.context.tenantId, phoneE164: phone }, select: { id: true } });
          if (existing) {
            contactId = existing.id;
          } else {
            const c = await prisma.contact.create({
              data: {
                tenantId: auth.context.tenantId,
                fullName: asTrimmedString(cust.fullName) ?? "Customer",
                phoneE164: phone,
                email: asTrimmedString(cust.email),
                source: "quote",
              },
              select: { id: true },
            });
            contactId = c.id;
          }
        }
      }
      try {
        const quote = await quotes.createQuote(auth.context.tenantId, {
          title,
          contactId,
          companyId: asTrimmedString(body.companyId),
          dealId: asTrimmedString(body.dealId),
          templateId: asTrimmedString(body.templateId),
          overheadPct: numUndef(body.overheadPct),
          marginPct: numUndef(body.marginPct),
          marginFloorPct: numUndef(body.marginFloorPct),
          discountPaise: numUndef(body.discountPaise),
          gstPercent: numUndef(body.gstPercent),
          validUntil: dateOrNull(body.validUntil),
          notes: asTrimmedString(body.notes),
          terms: asTrimmedString(body.terms),
          createdById: auth.context.userId,
          lines: Array.isArray(body.lines) ? (body.lines as quotes.LineInputPayload[]) : undefined,
        });
        json(res, 200, { ok: true, quote });
      } catch (e) {
        json(res, 400, { ok: false, error: e instanceof Error ? e.message : "Invalid quote" });
      }
      return;
    }

    // Sub-routes: /quotes/:id[/lines[/:lineId]|/send|/accept|/reject|/expire|/pdf|/busy-export]
    const quoteMatch = /^\/quotes\/([^/]+)(?:\/(lines|send|accept|reject|expire|pdf|busy-export))?(?:\/([^/]+))?$/.exec(
      parseUrl(req.url ?? "").pathname,
    );
    if (quoteMatch) {
      const quoteId = quoteMatch[1];
      const sub = quoteMatch[2];
      const subId = quoteMatch[3];

      // GET /quotes/:id
      if (!sub && req.method === "GET") {
        const auth = await authorize(req, res, "GET /quotes/:id");
        if (!auth.ok) return;
        const quote = await quotes.getQuote(auth.context.tenantId, quoteId);
        if (!quote) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        json(res, 200, { ok: true, quote });
        return;
      }
      // PATCH /quotes/:id (draft only)
      if (!sub && req.method === "PATCH") {
        const auth = await authorize(req, res, "PATCH /quotes/:id");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const fields: Record<string, unknown> = {};
        const t = asTrimmedString(body.title); if (t) fields.title = t;
        if (body.contactId !== undefined) fields.contactId = asTrimmedString(body.contactId);
        if (body.companyId !== undefined) fields.companyId = asTrimmedString(body.companyId);
        if (body.dealId !== undefined) fields.dealId = asTrimmedString(body.dealId);
        if (body.overheadPct !== undefined) fields.overheadPct = Number(body.overheadPct) || 0;
        if (body.marginPct !== undefined) fields.marginPct = Number(body.marginPct) || 0;
        if (body.marginFloorPct !== undefined) fields.marginFloorPct = Number(body.marginFloorPct) || 0;
        if (body.discountPaise !== undefined) fields.discountPaise = Math.max(0, Math.round(Number(body.discountPaise) || 0));
        if (body.gstPercent !== undefined) fields.gstPercent = Math.max(0, Number(body.gstPercent) || 0);
        if (body.validUntil !== undefined) fields.validUntil = dateOrNull(body.validUntil);
        if (body.notes !== undefined) fields.notes = asTrimmedString(body.notes);
        if (body.terms !== undefined) fields.terms = asTrimmedString(body.terms);
        await quotes.updateQuoteFields(auth.context.tenantId, quoteId, fields);
        // Optional full line-replace (the builder's Edit flow saves all lines at once).
        const quote = Array.isArray(body.lines)
          ? await quotes.replaceQuoteLines(auth.context.tenantId, quoteId, body.lines as quotes.LineInputPayload[])
          : await quotes.getQuote(auth.context.tenantId, quoteId);
        json(res, 200, { ok: true, quote });
        return;
      }
      // DELETE /quotes/:id (draft only)
      if (!sub && req.method === "DELETE") {
        const auth = await authorize(req, res, "DELETE /quotes/:id");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be deleted" }); return; }
        await quotes.deleteQuote(auth.context.tenantId, quoteId);
        json(res, 200, { ok: true });
        return;
      }
      // POST /quotes/:id/lines (draft only)
      if (sub === "lines" && !subId && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/lines");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const name = asTrimmedString(body.name);
        if (!name) { json(res, 400, { ok: false, error: "name is required" }); return; }
        const quote = await quotes.addLine(auth.context.tenantId, quoteId, { ...body, name } as unknown as quotes.LineInputPayload);
        json(res, 200, { ok: true, quote });
        return;
      }
      // PATCH /quotes/:id/lines/:lineId (draft only)
      if (sub === "lines" && subId && req.method === "PATCH") {
        const auth = await authorize(req, res, "PATCH /quotes/:id/lines/:lineId");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const quote = await quotes.updateLine(auth.context.tenantId, quoteId, subId, body as unknown as quotes.LineInputPayload);
        if (!quote) { json(res, 404, { ok: false, error: "Line not found" }); return; }
        json(res, 200, { ok: true, quote });
        return;
      }
      // DELETE /quotes/:id/lines/:lineId (draft only)
      if (sub === "lines" && subId && req.method === "DELETE") {
        const auth = await authorize(req, res, "DELETE /quotes/:id/lines/:lineId");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (raw.status !== "draft") { json(res, 409, { ok: false, error: "Only draft quotes can be edited" }); return; }
        const quote = await quotes.deleteLine(auth.context.tenantId, quoteId, subId);
        if (!quote) { json(res, 404, { ok: false, error: "Line not found" }); return; }
        json(res, 200, { ok: true, quote });
        return;
      }
      // POST /quotes/:id/send — enforce margin floor, freeze, then follow-up (M3).
      if (sub === "send" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/send");
        if (!auth.ok) return;
        const floor = await quotes.quoteFloorStatus(auth.context.tenantId, quoteId);
        if (!floor) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (floor.status !== "draft") { json(res, 409, { ok: false, error: `Quote is already ${floor.status}` }); return; }
        if (!floor.hasLines) { json(res, 422, { ok: false, error: "Quote has no line items" }); return; }
        if (floor.floorViolation) {
          json(res, 422, { ok: false, error: "Quote margin is below the configured floor", minTotalPaise: floor.minTotalPaise, marginFloorPct: floor.marginFloorPct });
          return;
        }
        const quote = await quotes.markSent(auth.context.tenantId, quoteId);
        // Fire the multi-channel follow-up: log a CRM task and (if configured)
        // enroll the contact into the drip sequence. Best-effort — never blocks send.
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        let followup: FollowupResult | undefined;
        if (raw) {
          const { runQuoteFollowup } = await import("./core/quotes/followup");
          followup = await runQuoteFollowup(auth.context.tenantId, {
            id: raw.id, number: raw.number, title: raw.title,
            contactId: raw.contactId, dealId: raw.dealId, createdById: raw.createdById,
          });
        }
        json(res, 200, { ok: true, quote, followup });
        return;
      }
      // POST /quotes/:id/accept — enforce floor, commit price to the linked Deal.
      if (sub === "accept" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/accept");
        if (!auth.ok) return;
        const floor = await quotes.quoteFloorStatus(auth.context.tenantId, quoteId);
        if (!floor) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (floor.status === "accepted") { json(res, 409, { ok: false, error: "Quote is already accepted" }); return; }
        if (floor.floorViolation) {
          json(res, 422, { ok: false, error: "Quote margin is below the configured floor", minTotalPaise: floor.minTotalPaise, marginFloorPct: floor.marginFloorPct });
          return;
        }
        const quote = await quotes.markAccepted(auth.context.tenantId, quoteId);
        // Commit the accepted total to the linked Deal (paise → Decimal rupees).
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (raw?.dealId) {
          const deal = await prisma.deal.findFirst({ where: { id: raw.dealId, tenantId: auth.context.tenantId }, select: { id: true } });
          if (deal) {
            await prisma.deal.update({ where: { id: deal.id }, data: { value: new Prisma.Decimal((raw.totalPaise / 100).toFixed(2)) } });
          }
        }
        json(res, 200, { ok: true, quote });
        return;
      }
      // POST /quotes/:id/reject
      if (sub === "reject" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/reject");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const quote = await quotes.markRejected(auth.context.tenantId, quoteId, asTrimmedString(body.reason));
        json(res, 200, { ok: true, quote });
        return;
      }
      // POST /quotes/:id/expire
      if (sub === "expire" && req.method === "POST") {
        const auth = await authorize(req, res, "POST /quotes/:id/expire");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        const quote = await quotes.markExpired(auth.context.tenantId, quoteId);
        json(res, 200, { ok: true, quote });
        return;
      }
      // GET /quotes/:id/pdf — branded quote PDF (reuses renderBrandedReportPdf).
      if (sub === "pdf" && req.method === "GET") {
        const auth = await authorize(req, res, "GET /quotes/:id/pdf");
        if (!auth.ok) return;
        const quote = await quotes.getQuote(auth.context.tenantId, quoteId);
        if (!quote) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        const brand = await loadReportBrand(auth.context.tenantId);
        const blocks = quotes.quotePdfBlocks(quote);
        const pdf = await renderBrandedReportPdf(brand, {
          title: `Quote ${String(quote.number)}`,
          subtitle: String(quote.title),
          generatedAt: new Date(),
          blocks,
        });
        sendBinary(res, "application/pdf", pdf, `quote-${quote.number}.pdf`);
        return;
      }
      // GET /quotes/:id/busy-export?format=csv|xml — BUSY-ready sales voucher for an
      // accepted quote (Administration → Import Voucher). File export, no live sync.
      if (sub === "busy-export" && req.method === "GET") {
        const auth = await authorize(req, res, "GET /quotes/:id/busy-export");
        if (!auth.ok) return;
        const raw = await quotes.getQuoteRaw(auth.context.tenantId, quoteId);
        if (!raw) { json(res, 404, { ok: false, error: "Quote not found" }); return; }
        if (raw.status !== "accepted") { json(res, 409, { ok: false, error: "Only accepted quotes can be exported to BUSY" }); return; }
        const format = (parseUrl(req.url).searchParams.get("format") ?? "csv").toLowerCase();
        const busy = await import("./core/connectors/busy");
        const config = await busy.resolveBusyConfig(auth.context.tenantId);
        // The quote's own GST rate (if set) wins over the connector default so the
        // voucher matches what the customer was quoted.
        if (raw.gstPercent > 0) config.gstPercent = raw.gstPercent;
        // Party name: linked company, else contact, else the quote title.
        let partyName = raw.title;
        if (raw.companyId) {
          const c = await prisma.company.findFirst({ where: { id: raw.companyId, tenantId: auth.context.tenantId }, select: { name: true } });
          if (c) partyName = c.name;
        } else if (raw.contactId) {
          const c = await prisma.contact.findFirst({ where: { id: raw.contactId, tenantId: auth.context.tenantId }, select: { fullName: true } });
          if (c) partyName = c.fullName;
        }
        const q = { number: raw.number, title: raw.title, acceptedAt: raw.acceptedAt, totalPaise: raw.totalPaise, lineItems: raw.lineItems.map((l) => ({ groupName: l.groupName, lineCostPaise: l.lineCostPaise })) };
        if (format === "xml") {
          sendDoc(res, "application/xml; charset=utf-8", busy.buildBusyXml(q, config, partyName), `busy-voucher-${raw.number}.xml`);
        } else {
          sendDoc(res, "text/csv; charset=utf-8", busy.buildBusyCsv(q, config, partyName), `busy-voucher-${raw.number}.csv`);
        }
        return;
      }
    }

    // ── AI: Provider Status ─────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/providers") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /ai/providers");
      if (!auth.ok) return;
      json(res, 200, { ok: true, claude: CLAUDE_AVAILABLE, openai: OPENAI_AVAILABLE });
      return;
    }

    // ── AI: Smart Insights ──────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/smart-insights") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /ai/smart-insights");
      if (!auth.ok) return;
      const licInsights = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
      if (!licInsights.ok) { json(res, 403, { ok: false, error: licInsights.error }); return; }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const { tenantId } = auth.context;
      const todayStartInsights = new Date(); todayStartInsights.setHours(0, 0, 0, 0);
      const todayEndInsights = new Date(); todayEndInsights.setHours(23, 59, 59, 999);
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true, industry: true } });
      const [openReqs, escalatedReqs, newContactsToday, sentiment] = await Promise.all([
        prisma.serviceRequest.count({ where: { tenantId, status: "open" } }),
        prisma.serviceRequest.count({ where: { tenantId, status: "escalated" } }),
        // Industry-agnostic "incoming" metric: contacts created today (every
        // industry has contacts; stays/check-ins are hospitality-only).
        prisma.contact.count({ where: { tenantId, createdAt: { gte: todayStartInsights, lte: todayEndInsights } } }),
        computeSentimentAnalytics(tenantId)
      ]);
      const topCategories = await prisma.serviceRequest.groupBy({
        by: ["category"],
        where: { tenantId, status: { in: ["open", "escalated"] } },
        _count: { category: true },
        orderBy: { _count: { category: "desc" } },
        take: 3
      });
      // Real sentiment from voice + inbound feedback; null when there is none, so
      // the prompt says "no feedback yet" rather than inventing a score (F-17).
      const avgSentimentScore = sentiment.totalFeedback > 0 ? sentiment.netScore : null;

      try {
        const insights = await generateSmartInsights({
          tenantName: tenant?.name ?? tenantId,
          industry: tenant?.industry ?? null,
          date: new Date().toLocaleDateString("en-IN", { weekday: "long", year: "numeric", month: "long", day: "numeric" }),
          openRequests: openReqs,
          escalatedRequests: escalatedReqs,
          // Revenue requires an external billing/POS source we don't have yet — pass
          // null (rendered "not available") instead of fabricated constants (F-17).
          todayRevenue: null,
          newContacts: newContactsToday,
          avgSentimentScore,
          topPendingCategories: topCategories.map((c) => c.category)
        }, provider);
        json(res, 200, { ok: true, provider, insights, generatedAt: new Date().toISOString() });
      } catch (e) {
        aiError(res, "smart-insights", e);
      }
      return;
    }

    // ── AI: Classify Inbound Event ──────────────────────────────────────────
    if (req.url?.startsWith("/ai/classify-event") && req.method === "POST") {
      const auth = await authorize(req, res, "POST /ai/classify-event");
      if (!auth.ok) return;
      const body = (await parseBody(req)) as { text?: unknown; provider?: unknown };
      const text = asTrimmedString(body.text);
      if (!text) { json(res, 400, { ok: false, error: "text is required" }); return; }
      const provider: AIProvider = asTrimmedString(body.provider) === "openai" ? "openai" : "claude";
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      try {
        const classification = await classifyInboundEvent(auth.context.tenantId, text, provider);
        json(res, 200, { ok: true, provider, classification });
      } catch (e) {
        aiError(res, "classify-event", e);
      }
      return;
    }

    // ── AI: Guest Intelligence ──────────────────────────────────────────────
    if (parseGuestIntelligencePath(req.url) && req.method === "GET") {
      const auth = await authorize(req, res, "GET /ai/guest-intelligence/:guestId");
      if (!auth.ok) return;
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

      try {
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
      } catch (e) {
        aiError(res, "guest-intelligence", e);
      }
      return;
    }

    // ── AI: Revenue Insights ────────────────────────────────────────────────
    if (req.url?.startsWith("/ai/revenue-insights") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /ai/revenue-insights");
      if (!auth.ok) return;
      const licRevInsights = await enforceLicenseFeature(auth.context.tenantId, "ai_features");
      if (!licRevInsights.ok) { json(res, 403, { ok: false, error: licRevInsights.error }); return; }
      const provider = parseAIProvider(req.url);
      if (provider === "openai" && !OPENAI_AVAILABLE) { json(res, 503, { ok: false, error: "OpenAI not configured — set OPENAI_API_KEY" }); return; }
      if (provider === "claude" && !CLAUDE_AVAILABLE) { json(res, 503, { ok: false, error: "Claude not configured — set ANTHROPIC_API_KEY" }); return; }
      if (!AI_AVAILABLE) { json(res, 503, { ok: false, error: "No AI provider configured" }); return; }

      const { tenantId } = auth.context;
      const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });

      const offerStats = await prisma.offerEvent.groupBy({
        by: ["offerType"],
        where: { tenantId },
        _count: { offerType: true },
        _sum: { revenueInr: true },
        orderBy: { _sum: { revenueInr: "desc" } },
        take: 5
      });

      const accepted = await prisma.offerEvent.count({ where: { tenantId, status: "accepted" } });
      const total = await prisma.offerEvent.count({ where: { tenantId } });

      try {
        const insights = await generateRevenueInsights({
          hotelName: hotel?.name ?? tenantId,
          // Occupancy / ADR / RevPAR / room availability need a PMS source we don't
          // have — pass null (rendered "not available") rather than fabricated
          // constants. The model bases recommendations on the real upsell data (F-17).
          occupancyPct: null,
          adrInr: null,
          revParInr: null,
          upsellConversionPct: total > 0 ? Math.round((accepted / total) * 100) : 0,
          topCategories: offerStats.map((o) => ({
            name: o.offerType,
            revenueInr: o._sum.revenueInr ?? 0
          })),
          weekTrend: "up",
          availableRooms: null
        }, provider);
        json(res, 200, { ok: true, provider, insights });
      } catch (e) {
        aiError(res, "revenue-insights", e);
      }
      return;
    }

    // ── POST /night-audit/generate ───────────────────────────────────────────
    if (req.url === "/night-audit/generate" && req.method === "POST") {
      const auth = await authorize(req, res, "POST /night-audit/generate");
      if (!auth.ok) return;
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
        // No room-capacity source → report in-house guests (real) and leave
        // occupancy % null rather than dividing by a magic room count (F-17).
        occupancyPct: null,
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

      let result;
      try {
        result = await generateNightAuditReport(auditData, provider);
      } catch (e) {
        // Don't persist a malformed report (F-11/F-12) — fail cleanly instead.
        aiError(res, "night-audit", e);
        return;
      }
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
      const auth = await authorize(req, res, "GET /night-audit/latest");
      if (!auth.ok) return;
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

    // ── GET /night-audit/history — browsable list of past reports by date (E-15) ──
    if (req.url?.startsWith("/night-audit/history") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /night-audit/history");
      if (!auth.ok) return;
      const licNightHist = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
      if (!licNightHist.ok) { json(res, 403, { ok: false, error: licNightHist.error }); return; }
      const { tenantId } = auth.context;
      const limit = asSafeLimit(parseUrl(req.url).searchParams.get("limit"), 90, 365);
      const reports = await prisma.nightAuditReport.findMany({
        where: { tenantId },
        orderBy: { reportDate: "desc" },
        take: limit,
        select: { reportDate: true, provider: true, generatedAt: true }
      });
      json(res, 200, { ok: true, items: reports });
      return;
    }

    // ── GET /night-audit/report?date=YYYY-MM-DD — a specific past report (E-15) ──
    if (req.url?.startsWith("/night-audit/report") && req.method === "GET") {
      const auth = await authorize(req, res, "GET /night-audit/report");
      if (!auth.ok) return;
      const licNightByDate = await enforceLicenseFeature(auth.context.tenantId, "night_audit");
      if (!licNightByDate.ok) { json(res, 403, { ok: false, error: licNightByDate.error }); return; }
      const { tenantId } = auth.context;
      const reportDate = asTrimmedString(parseUrl(req.url).searchParams.get("date"));
      if (!reportDate || !DATE_ONLY_RE.test(reportDate)) {
        json(res, 400, { ok: false, error: "date must be provided as YYYY-MM-DD" });
        return;
      }
      const report = await prisma.nightAuditReport.findUnique({
        where: { tenantId_reportDate: { tenantId, reportDate } }
      });
      if (!report) { json(res, 404, { ok: false, error: "No night audit report for that date" }); return; }
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      // The raw token goes ONLY in the invite URL; we store its SHA-256 hash so a DB
      // read can't accept invites (F-… H6). Lookups hash the provided token to match.
      const token = randomBytes(32).toString("hex");
      const inv = await prisma.invitation.create({
        data: {
          tenantId: auth.context.tenantId,
          email,
          roleId: role.id,
          token: hashInviteToken(token),
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
        where: { token: hashInviteToken(token) },
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
        where: { token: hashInviteToken(token) },
        include: { role: { select: { id: true, key: true, permissions: true } } }
      });
      if (!inv)         { json(res, 404, { ok: false, error: "Invitation not found" }); return; }
      if (inv.acceptedAt) { json(res, 409, { ok: false, error: "Invitation already accepted" }); return; }
      if (inv.expiresAt < new Date()) { json(res, 410, { ok: false, error: "Invitation expired" }); return; }
      const body = (await parseBody(req)) as { fullName?: unknown };
      const fullName = asTrimmedString(body.fullName) ?? inv.email.split("@")[0] ?? "New User";
      const legacyRole = legacyRoleFor(inv.role.key);
      // Look for an existing membership *in this workspace* only. The same email
      // may legitimately belong to other workspaces (multi-workspace membership) —
      // accepting this invite adds/updates the membership for THIS tenant, never
      // touching the user's rows in other tenants.
      const existing = await prisma.user.findFirst({
        where: { tenantId: inv.tenantId, email: inv.email },
        select: { id: true, isActive: true }
      });
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
        where: { token: hashInviteToken(token) },
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
        json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
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
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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

    // ── CRM: Pipelines ──────────────────────────────────────────────────────
    // GET /pipelines — list the tenant's pipelines (lazily seeding the standard
    // default one on first use so the board always has stages).
    if (parseUrl(req.url).pathname === "/pipelines" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /pipelines");
      if (!auth.ok) return;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return; }
      const { ensureDefaultPipeline, serializePipeline } = await import("./core/crm/pipeline");
      await ensureDefaultPipeline(tenantId);
      const pipelines = await prisma.pipeline.findMany({
        where: { tenantId, archived: false },
        orderBy: [{ isDefault: "desc" }, { createdAt: "asc" }],
        include: { stages: { orderBy: { order: "asc" } } },
      });
      json(res, 200, { ok: true, items: pipelines.map(serializePipeline) });
      return;
    }

    // ── CRM: Forecast ───────────────────────────────────────────────────────
    // GET /deals/forecast — must be matched before /deals/:id.
    if (parseUrl(req.url).pathname === "/deals/forecast" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /deals/forecast");
      if (!auth.ok) return;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return; }
      const { computeForecast } = await import("./core/crm/forecast");
      const pipelineId = parseUrl(req.url).searchParams.get("pipelineId") || undefined;
      const forecast = await computeForecast(tenantId, pipelineId ? { pipelineId } : {});
      json(res, 200, { ok: true, forecast });
      return;
    }

    // ── CRM: Deals — create + list ──────────────────────────────────────────
    if (parseUrl(req.url).pathname === "/deals" && (req.method === "POST" || req.method === "GET")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return; }
      const { validateDealCreate, serializeDeal } = await import("./core/crm/deals");
      const { ensureDefaultPipeline } = await import("./core/crm/pipeline");

      if (req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /deals")) {
          json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
        }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const validated = validateDealCreate(body);
        if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return; }
        const v = validated.value;

        // Resolve the pipeline (explicit, scoped to tenant) or the default.
        const pipeline = v.pipelineId
          ? await prisma.pipeline.findFirst({ where: { id: v.pipelineId, tenantId }, include: { stages: { orderBy: { order: "asc" } } } })
          : await ensureDefaultPipeline(tenantId);
        if (!pipeline) { json(res, 404, { ok: false, error: "Pipeline not found" }); return; }
        const stage = v.stageId ? pipeline.stages.find((s) => s.id === v.stageId) : pipeline.stages[0];
        if (!stage) { json(res, 400, { ok: false, error: "Invalid stage for this pipeline" }); return; }

        // Validate optional links belong to the same tenant.
        if (v.contactId && !(await prisma.contact.findFirst({ where: { id: v.contactId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Contact not found" }); return;
        }
        if (v.companyId && !(await prisma.company.findFirst({ where: { id: v.companyId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Company not found" }); return;
        }
        if (v.ownerId && !(await prisma.user.findFirst({ where: { id: v.ownerId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Owner not found" }); return;
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
        return;
      }

      // GET /deals — list with filters
      if (!canAccess(auth.context.permissions, "GET /deals")) {
        json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
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
      return;
    }

    // ── CRM: Deal AI suggestions — list (safe mode) ─────────────────────────
    if (parseUrl(req.url).pathname === "/deals/suggestions" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /deals/suggestions");
      if (!auth.ok) return;
      const tenantId = auth.context.tenantId;
      const { serializeSuggestion } = await import("./core/crm/suggestions");
      const status = parseUrl(req.url).searchParams.get("status") ?? "pending";
      const where: Record<string, unknown> = { tenantId };
      if (status !== "all") where.status = status;
      const rows = await prisma.dealSuggestion.findMany({
        where, orderBy: { createdAt: "desc" }, take: 100,
        include: { deal: { select: { title: true, pipeline: { select: { stages: { orderBy: { order: "asc" } } } } } } },
      });
      const items = rows.map((s) => serializeSuggestion(s, s.deal.title, s.deal.pipeline.stages));
      json(res, 200, { ok: true, items });
      return;
    }

    // ── CRM: Deal AI suggestions — accept / dismiss ─────────────────────────
    {
      const sp = parseSuggestionPath(req.url);
      if (sp && req.method === "POST") {
        const permKey = sp.action === "accept" ? "POST /deals/suggestions/:id/accept" : "POST /deals/suggestions/:id/dismiss";
        const auth = await authorize(req, res, permKey);
        if (!auth.ok) return;
        const tenantId = auth.context.tenantId;
        const { acceptSuggestion, dismissSuggestion } = await import("./core/crm/suggestions");
        const result = sp.action === "accept"
          ? await acceptSuggestion(tenantId, sp.id, auth.context.userId)
          : await dismissSuggestion(tenantId, sp.id, auth.context.userId);
        if (!result.ok) { json(res, result.status, { ok: false, error: result.error }); return; }
        json(res, 200, { ok: true });
        return;
      }
    }

    // ── CRM: Deals — single / update / delete / move ────────────────────────
    if (parseUrl(req.url).pathname.startsWith("/deals/")) {
      const parsed = parseDealPath(req.url);
      if (parsed) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return;
        const tenantId = auth.context.tenantId;
        const { id, action } = parsed;
        const { buildDealUpdate, serializeDeal } = await import("./core/crm/deals");
        const deal = await prisma.deal.findFirst({ where: { id, tenantId } });

        // GET /deals/:id
        if (action === null && req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /deals/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return; }
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
          return;
        }

        // PATCH /deals/:id
        if (action === null && req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /deals/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return; }
          const body = (await parseBody(req)) as Record<string, unknown>;
          const update = buildDealUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return; }
          if (update.value.contactId && !(await prisma.contact.findFirst({ where: { id: update.value.contactId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Contact not found" }); return;
          }
          if (update.value.companyId && !(await prisma.company.findFirst({ where: { id: update.value.companyId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Company not found" }); return;
          }
          if (update.value.ownerId && !(await prisma.user.findFirst({ where: { id: update.value.ownerId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Owner not found" }); return;
          }
          const updated = await prisma.deal.update({
            where: { id }, data: update.value, include: { stage: true, contact: true, company: true, owner: true },
          });
          json(res, 200, { ok: true, deal: serializeDeal(updated) });
          return;
        }

        // DELETE /deals/:id
        if (action === null && req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /deals/:id")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return; }
          await prisma.deal.delete({ where: { id } });
          json(res, 200, { ok: true });
          return;
        }

        // POST /deals/:id/move — change stage (logs a transition, auto-sets won/lost)
        if (action === "move" && req.method === "POST") {
          if (!canAccess(auth.context.permissions, "POST /deals/:id/move")) {
            json(res, 403, { ok: false, error: "Insufficient permissions" }); return;
          }
          if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return; }
          const body = (await parseBody(req)) as Record<string, unknown>;
          const toStageId = typeof body.stageId === "string" ? body.stageId : null;
          if (!toStageId) { json(res, 400, { ok: false, error: "stageId is required" }); return; }
          // Target stage must belong to THIS deal's pipeline and tenant.
          const toStage = await prisma.stage.findFirst({ where: { id: toStageId, tenantId, pipelineId: deal.pipelineId } });
          if (!toStage) { json(res, 400, { ok: false, error: "Target stage is not in this deal's pipeline" }); return; }
          if (toStage.id === deal.stageId) {
            const same = await prisma.deal.findFirst({ where: { id, tenantId }, include: { stage: true, contact: true, company: true, owner: true } });
            json(res, 200, { ok: true, deal: serializeDeal(same!) });
            return;
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
          return;
        }

        // GET /deals/:id/timeline
        if (action === "timeline" && req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /deals/:id/timeline")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return; }
          const { buildContactTimeline } = await import("./core/crm/timeline");
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
          return;
        }

        // POST /deals/:id/suggest — generate a safe-mode AI stage suggestion
        if (action === "suggest" && req.method === "POST") {
          if (!canAccess(auth.context.permissions, "POST /deals/:id/suggest")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!deal) { json(res, 404, { ok: false, error: "Deal not found" }); return; }
          const { generateDealSuggestion } = await import("./core/crm/suggestions");
          const provider = parseAIProvider(req.url);
          const suggestion = await generateDealSuggestion(tenantId, id, provider);
          json(res, 200, { ok: true, suggestion });
          return;
        }
      }
    }

    // ── CRM: Contacts — create + list ───────────────────────────────────────
    if (parseUrl(req.url).pathname === "/contacts" && (req.method === "POST" || req.method === "GET")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return; }
      const { validateContactCreate, serializeContact } = await import("./core/crm/contacts");

      if (req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /contacts")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const validated = validateContactCreate(body);
        if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return; }
        const v = validated.value;
        if (v.companyId && !(await prisma.company.findFirst({ where: { id: v.companyId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Company not found" }); return;
        }
        if (v.ownerId && !(await prisma.user.findFirst({ where: { id: v.ownerId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Owner not found" }); return;
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
        return;
      }

      // GET /contacts — list with CRM filters
      if (!canAccess(auth.context.permissions, "GET /contacts")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
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
      return;
    }

    // ── CRM: Contact timeline / activities / AI score (Increment C) ──────────
    {
      const sub = parseContactSubPath(req.url);
      if (sub) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return;
        const tenantId = auth.context.tenantId;
        const contact = await prisma.contact.findFirst({ where: { id: sub.id, tenantId }, select: { id: true } });

        // GET /contacts/:id/timeline
        if (sub.action === "timeline" && req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /contacts/:id/timeline")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return; }
          const { buildContactTimeline } = await import("./core/crm/timeline");
          const items = await buildContactTimeline(tenantId, sub.id);
          json(res, 200, { ok: true, items });
          return;
        }

        // POST /contacts/:id/activities — log a note / task / meeting
        if (sub.action === "activities" && req.method === "POST") {
          if (!canAccess(auth.context.permissions, "POST /contacts/:id/activities")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return; }
          const { validateActivityCreate, serializeActivity } = await import("./core/crm/activities");
          const body = (await parseBody(req)) as Record<string, unknown>;
          const validated = validateActivityCreate(body);
          if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return; }
          const v = validated.value;
          if (v.dealId && !(await prisma.deal.findFirst({ where: { id: v.dealId, tenantId } }))) { json(res, 400, { ok: false, error: "Deal not found" }); return; }
          const created = await prisma.activity.create({
            data: { tenantId, contactId: sub.id, dealId: v.dealId, userId: auth.context.userId, type: v.type, title: v.title, body: v.body, dueAt: v.dueAt, status: v.status },
            include: { user: { select: { id: true, fullName: true } } },
          });
          await prisma.contact.update({ where: { id: sub.id }, data: { lastActivityAt: new Date() } });
          json(res, 201, { ok: true, activity: serializeActivity(created) });
          return;
        }

        // POST /contacts/:id/score — AI (or heuristic) lead score
        if (sub.action === "score" && req.method === "POST") {
          if (!canAccess(auth.context.permissions, "POST /contacts/:id/score")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return; }
          const { scoreContact } = await import("./core/crm/scoring");
          const provider = parseAIProvider(req.url);
          const result = await scoreContact(tenantId, sub.id, provider);
          if (!result) { json(res, 404, { ok: false, error: "Contact not found" }); return; }
          json(res, 200, { ok: true, score: result });
          return;
        }
      }
    }

    // ── CRM: Tasks (open activities across the tenant) ──────────────────────
    if (parseUrl(req.url).pathname === "/tasks" && req.method === "GET") {
      const auth = await authorize(req, res, "GET /tasks");
      if (!auth.ok) return;
      const tenantId = auth.context.tenantId;
      const { serializeActivity } = await import("./core/crm/activities");
      const qs = parseUrl(req.url).searchParams;
      const status = qs.get("status") ?? "open";
      const where: Record<string, unknown> = { tenantId, type: "task" };
      if (status !== "all") where.status = status;
      if (qs.get("mine") === "true") where.userId = auth.context.userId;
      const rows = await prisma.activity.findMany({ where, orderBy: [{ dueAt: "asc" }, { createdAt: "desc" }], take: 200, include: { user: { select: { id: true, fullName: true } }, contact: { select: { id: true, fullName: true } } } });
      json(res, 200, { ok: true, items: rows.map((a) => ({ ...serializeActivity(a), contactName: a.contact?.fullName ?? null })) });
      return;
    }

    // ── CRM: Activity update / delete (complete a task, edit a note) ─────────
    if (parseUrl(req.url).pathname.startsWith("/activities/")) {
      const id = parseCrmIdPath(req.url, "activities");
      if (id) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return;
        const tenantId = auth.context.tenantId;
        const activity = await prisma.activity.findFirst({ where: { id, tenantId } });

        if (req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /activities/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!activity) { json(res, 404, { ok: false, error: "Activity not found" }); return; }
          const { buildActivityUpdate, serializeActivity } = await import("./core/crm/activities");
          const body = (await parseBody(req)) as Record<string, unknown>;
          const update = buildActivityUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return; }
          const updated = await prisma.activity.update({ where: { id }, data: update.value, include: { user: { select: { id: true, fullName: true } } } });
          json(res, 200, { ok: true, activity: serializeActivity(updated) });
          return;
        }
        if (req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /activities/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!activity) { json(res, 404, { ok: false, error: "Activity not found" }); return; }
          await prisma.activity.delete({ where: { id } });
          json(res, 200, { ok: true });
          return;
        }
      }
    }

    // ── CRM: Contacts — single / update / delete ────────────────────────────
    if (parseUrl(req.url).pathname.startsWith("/contacts/")) {
      const id = parseCrmIdPath(req.url, "contacts");
      if (id) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return;
        const tenantId = auth.context.tenantId;
        const { buildContactUpdate, serializeContact } = await import("./core/crm/contacts");
        const { serializeDeal } = await import("./core/crm/deals");
        const contact = await prisma.contact.findFirst({ where: { id, tenantId } });

        if (req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /contacts/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return; }
          const [full, deals] = await Promise.all([
            prisma.contact.findFirst({ where: { id, tenantId }, include: { company: true, owner: true, _count: { select: { deals: true } } } }),
            prisma.deal.findMany({ where: { tenantId, contactId: id }, orderBy: { updatedAt: "desc" }, include: { stage: true, contact: true, company: true, owner: true } }),
          ]);
          json(res, 200, { ok: true, contact: serializeContact(full!), deals: deals.map(serializeDeal) });
          return;
        }

        if (req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /contacts/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return; }
          const body = (await parseBody(req)) as Record<string, unknown>;
          const update = buildContactUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return; }
          if (update.value.companyId && !(await prisma.company.findFirst({ where: { id: update.value.companyId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Company not found" }); return;
          }
          if (update.value.ownerId && !(await prisma.user.findFirst({ where: { id: update.value.ownerId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Owner not found" }); return;
          }
          const updated = await prisma.contact.update({ where: { id }, data: update.value, include: { company: true, owner: true, _count: { select: { deals: true } } } });
          json(res, 200, { ok: true, contact: serializeContact(updated) });
          return;
        }

        if (req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /contacts/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!contact) { json(res, 404, { ok: false, error: "Contact not found" }); return; }
          await prisma.contact.delete({ where: { id } });
          json(res, 200, { ok: true });
          return;
        }
      }
    }

    // ── CRM: Companies — create + list ──────────────────────────────────────
    if (parseUrl(req.url).pathname === "/companies" && (req.method === "POST" || req.method === "GET")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
      const tenantId = auth.context.tenantId;
      if (!(await ensureTenantAccess(tenantId))) { json(res, 404, { ok: false, error: "Tenant not found" }); return; }
      const { validateCompanyCreate, serializeCompany } = await import("./core/crm/companies");

      if (req.method === "POST") {
        if (!canAccess(auth.context.permissions, "POST /companies")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
        const body = (await parseBody(req)) as Record<string, unknown>;
        const validated = validateCompanyCreate(body);
        if (!validated.ok) { json(res, 400, { ok: false, error: validated.error }); return; }
        const v = validated.value;
        if (v.ownerId && !(await prisma.user.findFirst({ where: { id: v.ownerId, tenantId } }))) {
          json(res, 400, { ok: false, error: "Owner not found" }); return;
        }
        const created = await prisma.company.create({
          data: { tenantId, name: v.name, domain: v.domain, industry: v.industry, size: v.size, ownerId: v.ownerId, tags: v.tags, notes: v.notes },
          include: { owner: true, _count: { select: { contacts: true, deals: true } } },
        });
        json(res, 201, { ok: true, company: serializeCompany(created) });
        return;
      }

      // GET /companies — list
      if (!canAccess(auth.context.permissions, "GET /companies")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
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
      return;
    }

    // ── CRM: Companies — single / update / delete ───────────────────────────
    if (parseUrl(req.url).pathname.startsWith("/companies/")) {
      const id = parseCrmIdPath(req.url, "companies");
      if (id) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return;
        const tenantId = auth.context.tenantId;
        const { buildCompanyUpdate, serializeCompany } = await import("./core/crm/companies");
        const { serializeContact } = await import("./core/crm/contacts");
        const { serializeDeal } = await import("./core/crm/deals");
        const company = await prisma.company.findFirst({ where: { id, tenantId } });

        if (req.method === "GET") {
          if (!canAccess(auth.context.permissions, "GET /companies/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!company) { json(res, 404, { ok: false, error: "Company not found" }); return; }
          const [full, contacts, deals] = await Promise.all([
            prisma.company.findFirst({ where: { id, tenantId }, include: { owner: true, _count: { select: { contacts: true, deals: true } } } }),
            prisma.contact.findMany({ where: { tenantId, companyId: id }, orderBy: { updatedAt: "desc" }, include: { company: true, owner: true } }),
            prisma.deal.findMany({ where: { tenantId, companyId: id }, orderBy: { updatedAt: "desc" }, include: { stage: true, contact: true, company: true, owner: true } }),
          ]);
          json(res, 200, { ok: true, company: serializeCompany(full!), contacts: contacts.map(serializeContact), deals: deals.map(serializeDeal) });
          return;
        }

        if (req.method === "PATCH") {
          if (!canAccess(auth.context.permissions, "PATCH /companies/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!company) { json(res, 404, { ok: false, error: "Company not found" }); return; }
          const body = (await parseBody(req)) as Record<string, unknown>;
          const update = buildCompanyUpdate(body);
          if (!update.ok) { json(res, 400, { ok: false, error: update.error }); return; }
          if (update.value.ownerId && !(await prisma.user.findFirst({ where: { id: update.value.ownerId, tenantId } }))) {
            json(res, 400, { ok: false, error: "Owner not found" }); return;
          }
          const updated = await prisma.company.update({ where: { id }, data: update.value, include: { owner: true, _count: { select: { contacts: true, deals: true } } } });
          json(res, 200, { ok: true, company: serializeCompany(updated) });
          return;
        }

        if (req.method === "DELETE") {
          if (!canAccess(auth.context.permissions, "DELETE /companies/:id")) { json(res, 403, { ok: false, error: "Insufficient permissions" }); return; }
          if (!company) { json(res, 404, { ok: false, error: "Company not found" }); return; }
          await prisma.company.delete({ where: { id } });
          json(res, 200, { ok: true });
          return;
        }
      }
    }

    // ── Voice Campaigns: create + list ──────────────────────────────────────
    if (parseUrl(req.url).pathname === "/campaigns" && (req.method === "POST" || req.method === "GET")) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
            // Persist the 1..N test arms as child rows.
            variants: v.variants.length > 0 ? {
              create: v.variants.map((vr, i) => ({
                tenantId, key: vr.key, label: vr.label, voice: vr.voice,
                persona: vr.persona, scriptOverride: vr.scriptOverride, weight: vr.weight, sortOrder: i,
              })),
            } : undefined,
          },
          include: { variants: { orderBy: { sortOrder: "asc" } } },
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
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return;
    }

    // ── Voice Campaigns: single / update / delete / lifecycle actions ────────
    if (parseUrl(req.url).pathname.startsWith("/campaigns/")) {
      const parsed = parseCampaignPath(req.url);
      if (parsed) {
        const auth = await authorize(req, res, null);
        if (!auth.ok) return;
        const tenantId = auth.context.tenantId;
        const { id, action } = parsed;

        const { buildCampaignUpdate, serializeCampaign, outcomeBreakdown, provisionVariantAssistants } =
          await import("./core/campaigns/service");

        // Resolve the campaign scoped to this tenant (with its A/B/N variants).
        const campaign = await prisma.voiceCampaign.findFirst({
          where: { id, tenantId },
          include: { variants: { orderBy: { sortOrder: "asc" } } },
        });

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
          const editsVariants = body.variants !== undefined;
          const update = buildCampaignUpdate(body);
          // Tolerate a variants-only PATCH (buildCampaignUpdate has no other fields to apply).
          if (!update.ok && !editsVariants) { json(res, 400, { ok: false, error: update.error }); return; }
          // Variant edits are only allowed before the campaign goes live, since
          // assistants are provisioned (and leads assigned) on activation.
          if (editsVariants) {
            if (campaign.status !== "draft") {
              json(res, 409, { ok: false, error: "Variants can only be changed while the campaign is a draft" }); return;
            }
            const { validateVariants } = await import("./core/campaigns/service");
            const voice = (serializeCampaign(campaign).channels as string[]).includes("voice");
            const v = validateVariants(body.variants, { requireVoice: voice });
            if (!v.ok) { json(res, 400, { ok: false, error: v.error }); return; }
            await prisma.campaignVariant.deleteMany({ where: { campaignId: id } });
            await prisma.$transaction(v.value.map((vr, i) => prisma.campaignVariant.create({
              data: { campaignId: id, tenantId, key: vr.key, label: vr.label, voice: vr.voice, persona: vr.persona, scriptOverride: vr.scriptOverride, weight: vr.weight, sortOrder: i },
            })));
          }
          if (update.ok) await prisma.voiceCampaign.update({ where: { id }, data: update.value });
          const refreshed = await prisma.voiceCampaign.findFirst({ where: { id }, include: { variants: { orderBy: { sortOrder: "asc" } } } });
          json(res, 200, { ok: true, campaign: serializeCampaign(refreshed!) });
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
          const variantRows = campaign.variants;
          // Voice channel: provision a Vapi assistant per variant. Non-voice
          // channels (WhatsApp/email) need no provisioning and activate directly.
          if (channels.includes("voice")) {
            if (variantRows.length === 0) {
              json(res, 400, { ok: false, error: "Add at least one voice variant before activating" });
              return;
            }
            const { resolveVapiCredentials, isVapiConfigured, createAssistant, deleteAssistant, webhookHostFromPublicUrl } = await import("./core/campaigns/vapi");
            const creds = await resolveVapiCredentials(tenantId);
            if (!isVapiConfigured(creds)) {
              json(res, 400, { ok: false, error: "voice_vapi connector not configured — set VAPI_API_KEY or enable the connector" });
              return;
            }
            // Provision only the arms not already provisioned (resume keeps existing).
            const unprovisioned = variantRows.filter((v) => !v.vapiAssistantId);
            if (unprovisioned.length > 0) {
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
              const provisioned = await provisionVariantAssistants({
                campaign: {
                  name: campaign.name, scriptTemplate: campaign.scriptTemplate ?? "",
                  outcomeTypes: serializeCampaign(campaign).outcomeTypes,
                },
                variants: unprovisioned.map((v) => ({ key: v.key, label: v.label, voice: v.voice, persona: v.persona, scriptOverride: v.scriptOverride })),
                creds, apiDomain, agentName,
                createAssistant, deleteAssistant,
              });
              if (!provisioned.ok) { json(res, 502, { ok: false, error: provisioned.error }); return; }
              await prisma.$transaction(
                Object.entries(provisioned.assistants).map(([key, assistantId]) =>
                  prisma.campaignVariant.update({ where: { campaignId_key: { campaignId: id, key } }, data: { vapiAssistantId: assistantId } })),
              );
            }
          }
          const updated = await prisma.voiceCampaign.update({
            where: { id },
            data: { status: "active" },
            include: { variants: { orderBy: { sortOrder: "asc" } } },
          });
          json(res, 200, { ok: true, campaign: serializeCampaign(updated) });
          return;
        }
      }
    }

    // ── Voice Campaign leads: import / list / delete ────────────────────────
    const leadsPath = parseCampaignLeadsPath(req.url);
    if (leadsPath) {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
        // Roll imported leads up to durable Contacts (CRM hub) — idempotent.
        const { backfillContactsFromLeads } = await import("./core/crm/contacts");
        await backfillContactsFromLeads(tenantId);
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
        json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
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
      const auth = await authorize(req, res, "GET /campaigns/:id/analytics");
      if (!auth.ok) return;
      const campaign = await prisma.voiceCampaign.findFirst({
        where: { id: analyticsId, tenantId: auth.context.tenantId },
        select: { id: true, variants: { orderBy: { sortOrder: "asc" }, select: { key: true, label: true } } },
      });
      if (!campaign) { json(res, 404, { ok: false, error: "Campaign not found" }); return; }

      const rows = await prisma.callRecord.findMany({
        where: { campaignId: analyticsId },
        select: { abVariant: true, status: true, outcome: true, durationSeconds: true, sentiment: true, meetingBooked: true },
      });
      const { summarizeVariant, decideLeaderN, sentimentScore } = await import("./core/campaigns/analytics");
      const armDefs = campaign.variants.map((v) => ({ key: v.key, label: v.label }));
      const NO_ANSWER = new Set(["no_answer"]);
      const blank = () => ({ dials: 0, answered: 0, interested: 0, meetingsBooked: 0, durationSum: 0, durationCount: 0, sentimentScoreSum: 0, sentimentRatedCount: 0 });
      const acc: Record<string, ReturnType<typeof blank>> = {};
      for (const arm of armDefs) acc[arm.key] = blank();
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
      const variants = armDefs.map((arm) => ({ key: arm.key, label: arm.label, ...summarizeVariant(toRaw(acc[arm.key]!)) }));
      const decision = decideLeaderN(variants.map((v) => ({ key: v.key, stats: v })));
      const overall = {
        totalLeads: await prisma.campaignLead.count({ where: { campaignId: analyticsId } }),
        dials: variants.reduce((s, v) => s + v.dials, 0),
        answered: variants.reduce((s, v) => s + v.answered, 0),
        interested: variants.reduce((s, v) => s + v.interested, 0),
        meetingsBooked: variants.reduce((s, v) => s + v.meetingsBooked, 0),
      };
      // Back-compat: expose the first two arms as variantA/variantB for older clients.
      const variantA = variants.find((v) => v.key === "A") ?? variants[0] ?? null;
      const variantB = variants.find((v) => v.key === "B") ?? variants[1] ?? null;
      json(res, 200, { ok: true, overall, variants, variantA, variantB, ...decision });
      return;
    }

    // ── Voice Campaign: message deliveries (activity feed) ──────────────────
    // Surfaces WhatsApp/email sends (MessageDelivery) for a campaign so the UI
    // can render a live activity feed. Paginated, newest first, optional
    // ?channel= and ?status= filters. Tenant-scoped via the campaign lookup.
    const deliveriesId = parseCampaignDeliveriesPath(req.url);
    if (deliveriesId && req.method === "GET") {
      const auth = await authorize(req, res, "GET /campaigns/:id/deliveries");
      if (!auth.ok) return;
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
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return;
    }

    // ── Voice Campaign: calls list / detail (+ CSV export) ──────────────────
    const callsPath = parseCampaignCallsPath(req.url);
    if (callsPath && req.method === "GET") {
      const auth = await authorize(req, res, null);
      if (!auth.ok) return;
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
      json(res, 200, { ok: true, items, page: { limit, offset, total, hasMore: offset + items.length < total } });
      return;
    }

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
  const server = buildServer();
  server.listen(port, () => {
    console.log("Eynis API listening on port " + port);
    // Back-fill any tenant whose system roles predate newer permissions (e.g. CRM).
    void syncSystemRolePermissions()
      .then(() => console.log("Eynis system-role permissions synced"))
      .catch((err) => console.error("system-role permission sync failed", err));
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
