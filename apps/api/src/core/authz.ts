// Route authorization kernel (improvement plan 5.1/5.2) — extracted verbatim
// from server.ts so domain routers share ONE auth path. permissionMap is the
// single source of truth for what every JWT route requires; the authz-matrix
// test walks it and proves 401/403 behaviour for the whole surface.

import type { IncomingMessage, ServerResponse } from "node:http";
import type { UserRole } from "@eynis/shared";
import type { Permission } from "./permissions";
import { prisma } from "../db/prisma";
import { parseBearerToken, verifyAuthToken } from "./auth";
import { parsePermissions, getPermissionsForLegacyRole, hasPermission } from "./rbac";
import { json } from "../http/helpers";

// Exported so the authz-matrix test can walk every route and prove the map is
// enforced (5.3) — this table is the single source of truth for route authz.
export const permissionMap: Record<string, Permission | null> = {
  "GET /context":                          null,
  "POST /auth/impersonate":                "impersonate_users",
  "POST /auth/impersonate/stop":           null,
  "GET /auth/impersonations/recent":       "impersonate_users",
  "PATCH /me":                             null,
  "GET /me/notifications":                 null,
  "PATCH /me/notifications":               null,
  "GET /tenant/profile":                   "manage_settings",
  "PATCH /tenant/profile":                 "manage_settings",
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
  "GET /notifications":                   null, // any authenticated user; each signal is gated by its own permission inside the handler
  "GET /users":                           "manage_users",
  "GET /guests":                          "view_guests",
  "GET /guests/:id":                      "view_guests",
  "GET /analytics/revenue-intelligence":  "view_reports",
  "GET /analytics/staff-performance":     "view_reports",
  "GET /analytics/sentiment":             "view_reports",
  "GET /analytics/upsell-campaigns":      "manage_campaigns",
  "GET /analytics/attribution":           "view_reports",
  "GET /analytics/attribution/export":    "view_reports",
  "GET /inventory/items":                 "view_reports",
  "POST /inventory/items":                "manage_inventory",
  "PUT /inventory/items/:id":             "manage_inventory",
  "DELETE /inventory/items/:id":          "manage_inventory",
  "GET /inventory/movements":             "view_reports",
  "GET /menu/items":                      "view_reports",
  "POST /menu/items":                     "manage_inventory",
  "PATCH /menu/items/:id":                "manage_inventory",
  "DELETE /menu/items/:id":               "manage_inventory",
  "GET /inventory/yield":                 "view_reports",
  "GET /automations":                     "manage_automations",
  "POST /automations":                    "manage_automations",
  "GET /automations/executions":          "manage_automations",
  "PATCH /automations/:id":               "manage_automations",
  "GET /connectors/registry":             "manage_connectors",
  "GET /connectors/configs":              "manage_connectors",
  "PUT /connectors/configs/:key":         "manage_connectors",
  "DELETE /connectors/configs/:key":      "manage_connectors",
  "POST /connectors/events/ingest":       "manage_requests",
  "POST /connectors/intake/csv":          "manage_requests",
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
  // NOTE: POST /connectors/pms/webhook is deliberately NOT here — it is a public
  // endpoint authenticated by shared secret (fails closed in production), not JWT.
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
  "POST /tasks":                          "manage_crm",
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
  "POST /quotes/:id/public-link":         "manage_crm",
  // Orders (Phase 7): the fulfillment pipeline behind mfg/F&B Live Orders.
  "GET /orders":                          "view_crm",
  "GET /orders/:id":                      "view_crm",
  "PATCH /orders/:id":                    "manage_crm",
  "GET /bookings":                        "view_crm",
  "POST /bookings":                       "manage_crm",
  "PATCH /bookings/:id":                  "manage_crm",
  "DELETE /bookings/:id":                 "manage_crm",
  "GET /patients":                        "view_crm",
  "POST /patients":                       "manage_crm",
  "PATCH /patients/:id":                  "manage_crm",
  "DELETE /patients/:id":                 "manage_crm",
  "GET /appointments":                    "view_crm",
  "POST /appointments":                   "manage_crm",
  "PATCH /appointments/:id":              "manage_crm",
  "DELETE /appointments/:id":             "manage_crm",
  "GET /contacts/intel":                  "view_crm",
  // Campaigns launch-hardening (Phase 8).
  "POST /campaigns/erasure":              "manage_campaigns",
  "POST /connectors/configs/:key/test":   "manage_connectors",
  // Reports (E-16). Base permission here; per-source access + creator-only
  // rules stay contextual in the handlers.
  "GET /reports/sources":                 "view_reports",
  "POST /reports/run":                    "view_reports",
  "GET /reports":                         "view_reports",
  "POST /reports":                        "view_reports",
  "GET /reports/:id/run":                 "view_reports",
  "GET /reports/:id/export":              "view_reports",
  "GET /reports/:id":                     "view_reports",
  "GET /reports/:id/shares":              "view_reports",
  "PUT /reports/:id/shares":              "view_reports",
  "PUT /reports/:id":                     "view_reports",
  "DELETE /reports/:id":                  "view_reports",
  // Research Studio (RS-1..4). Base permission here; license gating, share-ACL
  // visibility and creator-only rules stay contextual in the handlers.
  "GET /research/sources":                "view_research",
  "GET /research/templates":              "view_research",
  "POST /research/templates":             "manage_research",
  "GET /research/templates/:id":          "view_research",
  "PUT /research/templates/:id":          "manage_research",
  "DELETE /research/templates/:id":       "manage_research",
  "GET /research/triggers":               "view_research",
  "POST /research/triggers":              "manage_research",
  "DELETE /research/triggers/:stageId":   "manage_research",
  "POST /research/runs":                  "run_research",
  "GET /research/runs":                   "view_research",
  "GET /research/runs/:id":               "view_research",
  "POST /research/runs/:id/rerun":        "run_research",
  "GET /research/runs/:id/export":        "view_research",
  "GET /research/runs/:id/schedule":      "view_research",
  "POST /research/runs/:id/schedule":     "run_research",
  "GET /research/schedules":              "view_research",
  "PATCH /research/schedules/:id":        "run_research",
  "DELETE /research/schedules/:id":       "run_research",
  "GET /research/runs/:id/shares":        "view_research",
  "PUT /research/runs/:id/shares":        "view_research",
};

export const canAccess = (permissions: string[], key: string): boolean => {
  const req = permissionMap[key];
  return req === null || hasPermission(permissions, req);
};


const authError = "Missing or invalid bearer token";

export const getAuthenticatedContext = async (req: IncomingMessage) => {
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
export async function authorize(
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


// Confirms the tenant exists. Used by public/webhook paths where tenantId
// arrives in the request body rather than a verified JWT claim.
export const ensureTenantAccess = async (tenantId: string) => {
  const hotel = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true } });
  return Boolean(hotel);
};
