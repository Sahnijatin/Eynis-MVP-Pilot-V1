// Auth / identity / registration router (#164) — token exchange, impersonation
// (start/stop/recent), the public email→workspace lookup, host/slug→tenant
// resolution, and public workspace registration. Extracted verbatim from
// server.ts; returns true when it handled the request, false to let the dispatcher
// continue.
//
// Several routes are PUBLIC (identify / resolve / register / token) and carry their
// own protections — the token-exchange shared secret (C1), per-IP rate limits
// (F-24), and (register) tenant provisioning. Moved together so the identity
// surface lives in one place.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { UserRole, SystemRoleKey } from "@eynis/shared";
import { prisma } from "../db/prisma";
import { authorize } from "./authz";
import { json, parseBody, parseUrl, asTrimmedString, clientIp } from "../http/helpers";
import { rateLimit } from "./rate-limit";
import { createAuthToken, verifyTokenExchangeSecret } from "./auth";
import { parsePermissions, getPermissionsForLegacyRole, seedDefaultRolesForHotel, seedLicenseForHotel } from "./rbac";
import { seedIndustryDefaults } from "./quotes/provision";
import { seedAutomationRulesForTenant } from "./automations/provision";
import { BRANDING_SELECT } from "./tenant/branding";

export async function handleAuthRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  if (req.url === "/auth/token" && req.method === "POST") {
    // Identity boundary (Phase 9 / C1): only the Clerk-authenticated web tier
    // may exchange an email for a tenant JWT. Enforced whenever the shared
    // secret is configured; production requires it at startup.
    if (!verifyTokenExchangeSecret(req)) {
      json(res, 401, { ok: false, error: "Invalid token exchange secret" });
      return true;
    }
    const body = (await parseBody(req)) as { tenantId?: unknown; hotelId?: unknown; email?: unknown; role?: unknown; roleKey?: unknown };
    const tenantId = asTrimmedString(body.tenantId) ?? asTrimmedString(body.hotelId); // accept legacy hotelId during transition
    const email = asTrimmedString(body.email)?.toLowerCase();
    const roleKey = asTrimmedString(body.roleKey);
    const role = asTrimmedString(body.role) as UserRole | null;
    if (!tenantId || !email || (!role && !roleKey)) {
      json(res, 400, { ok: false, error: "tenantId, email, and one of role|roleKey are required" });
      return true;
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
      return true;
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
    return true;
  }

  // ── POST /auth/impersonate — start impersonating a real user (E-6) ──────────
  // Server-authoritative: issues a token that authenticates as the TARGET user
  // (their real role + permissions, loaded live from the DB) while recording the
  // original admin. Gated by `impersonate_users`, tenant-scoped, audit-logged.
  if (req.url === "/auth/impersonate" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /auth/impersonate");
    if (!auth.ok) return true;
    // No nested impersonation: an impersonated session never carries the
    // permission (we strip it below), but guard explicitly for clarity.
    if (auth.context.impersonatorUserId) {
      json(res, 409, { ok: false, error: "Already impersonating — stop the current session first" });
      return true;
    }
    const body = (await parseBody(req)) as { targetUserId?: unknown };
    const targetUserId = asTrimmedString(body.targetUserId);
    if (!targetUserId) {
      json(res, 400, { ok: false, error: "targetUserId is required" });
      return true;
    }
    if (targetUserId === auth.context.userId) {
      json(res, 400, { ok: false, error: "You cannot impersonate yourself" });
      return true;
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
      return true;
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
    return true;
  }

  // ── POST /auth/impersonate/stop — end an impersonation session (E-6) ────────
  // Any authenticated session may call this; it only logs when the caller is
  // actually impersonating. The web also clears its cookie regardless.
  if (req.url === "/auth/impersonate/stop" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /auth/impersonate/stop");
    if (!auth.ok) return true;
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
    return true;
  }

  // ── GET /auth/impersonations/recent — recent targets for the modal (E-6) ────
  // Derived from the audit log so we don't need a separate table; deduped by
  // target and scoped to the requesting admin.
  if (req.url?.startsWith("/auth/impersonations/recent") && req.method === "GET") {
    const auth = await authorize(req, res, "GET /auth/impersonations/recent");
    if (!auth.ok) return true;
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
    return true;
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
      return true;
    }
    // Same identity boundary as /auth/token (Phase 9 / C1): with the shared
    // secret configured this stops being a public tenantId/roleKey oracle.
    if (!verifyTokenExchangeSecret(req)) {
      json(res, 401, { ok: false, error: "Invalid token exchange secret" });
      return true;
    }
    const email = parseUrl(req.url).searchParams.get("email")?.toLowerCase().trim();
    if (!email) {
      json(res, 400, { ok: false, error: "email is required" });
      return true;
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
      return true;
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
    return true;
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
      if (isPlatformHost) { json(res, 200, { ok: true, found: false }); return true; }
      if (rawHost.endsWith(`.${platform}`)) {
        slug = slug ?? rawHost.slice(0, rawHost.length - platform.length - 1).split(".").pop() ?? null;
      } else {
        customDomain = rawHost;
      }
    }
    if (!slug && !customDomain) { json(res, 200, { ok: true, found: false }); return true; }

    const or = [customDomain ? { customDomain } : null, slug ? { slug } : null].filter(Boolean) as object[];
    const tenant = await prisma.tenant.findFirst({
      where: { OR: or },
      select: { id: true, industry: true, name: true, whitelabelTier: true, branding: { select: BRANDING_SELECT } },
    });
    if (!tenant) { json(res, 200, { ok: true, found: false }); return true; }
    json(res, 200, {
      ok: true, found: true,
      tenantId: tenant.id, industry: tenant.industry, propertyName: tenant.name,
      whitelabelTier: tenant.whitelabelTier,
      branding: tenant.branding ?? null,
    });
    return true;
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
      return true;
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
      return true;
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
      return true;
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
    return true;
  }

  return false;
}
