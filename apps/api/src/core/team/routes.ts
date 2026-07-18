// Team domain router (#164) — team members, invitations (incl. the two public
// invite routes), roles, and license/seat info. Extracted verbatim from server.ts.
// Returns true when it handled the request; false lets the dispatcher continue.
import type { IncomingMessage, ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import type { UserRole, SystemRoleKey } from "@eynis/shared";
import { prisma } from "../../db/prisma";
import { authorize } from "../authz";
import { json, parseBody, asTrimmedString, parseUrl } from "../../http/helpers";
import { hasPermission, isWithinSeatLimit, legacyRoleFor, parsePermissions } from "../rbac";
import { createAuthToken } from "../auth";
import { hashToken as hashInviteToken } from "../crypto/secrets";
import { ALL_PERMISSIONS } from "../permissions";
import { enforceLicenseFeature } from "../license";

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

export async function handleTeamRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  // ── GET /team/users — list team members with role + seat usage ────────────
  if (req.url === "/team/users" && req.method === "GET") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    if (!hasPermission(auth.context.permissions, "manage_users")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
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
    return true;
  }

  // ── POST /team/invitations — generate invite link ─────────────────────────
  if (req.url === "/team/invitations" && req.method === "POST") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    if (!hasPermission(auth.context.permissions, "invite_users")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
    }
    const body = (await parseBody(req)) as { email?: unknown; roleId?: unknown };
    const email = asTrimmedString(body.email)?.toLowerCase();
    const roleId = asTrimmedString(body.roleId);
    if (!email || !roleId) {
      json(res, 400, { ok: false, error: "email and roleId are required" }); return true;
    }
    const role = await prisma.role.findFirst({
      where: { id: roleId, tenantId: auth.context.tenantId },
      select: { id: true, key: true, displayName: true }
    });
    if (!role) { json(res, 404, { ok: false, error: "Role not found" }); return true; }
    const within = await isWithinSeatLimit(auth.context.tenantId);
    if (!within) {
      json(res, 403, { ok: false, error: "Seat limit reached — upgrade your plan to invite more users" }); return true;
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
    return true;
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
    if (!inv) { json(res, 404, { ok: false, error: "Invitation not found" }); return true; }
    json(res, 200, {
      ok: true,
      email: inv.email,
      hotelName: inv.tenant.name,
      roleName: inv.role.displayName,
      roleKey: inv.role.key,
      expired: inv.expiresAt < new Date(),
      accepted: !!inv.acceptedAt
    });
    return true;
  }

  // ── POST /team/invitations/:token/accept — create account (public) ────────
  if (parseInviteAccept(req.url) && req.method === "POST") {
    const token = parseInviteAccept(req.url)!;
    const inv = await prisma.invitation.findUnique({
      where: { token: hashInviteToken(token) },
      include: { role: { select: { id: true, key: true, permissions: true } } }
    });
    if (!inv)         { json(res, 404, { ok: false, error: "Invitation not found" }); return true; }
    if (inv.acceptedAt) { json(res, 409, { ok: false, error: "Invitation already accepted" }); return true; }
    if (inv.expiresAt < new Date()) { json(res, 410, { ok: false, error: "Invitation expired" }); return true; }
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
      return true;
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
    return true;
  }

  // ── PUT /team/users/:id — change role or active status ───────────────────
  if (parseTeamUserId(req.url) && req.method === "PUT") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    if (!hasPermission(auth.context.permissions, "manage_users")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
    }
    const targetId = parseTeamUserId(req.url)!;
    const target = await prisma.user.findFirst({
      where: { id: targetId, tenantId: auth.context.tenantId },
      include: { systemRole: { select: { key: true } } }
    });
    if (!target) { json(res, 404, { ok: false, error: "User not found" }); return true; }
    if (targetId === auth.context.userId) {
      json(res, 400, { ok: false, error: "Cannot modify your own account" }); return true;
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
      if (!newRole) { json(res, 404, { ok: false, error: "Role not found" }); return true; }
      updates.roleId = newRole.id;
      updates.role   = legacyRoleFor(newRole.key);
      newRoleKey = newRole.key;
    }
    if (Object.keys(updates).length === 0) {
      json(res, 400, { ok: false, error: "Provide roleId or isActive to update" }); return true;
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
        return true;
      }
    }
    const updated = await prisma.user.update({
      where: { id: targetId },
      data: updates,
      select: { id: true, fullName: true, email: true, role: true, isActive: true,
                systemRole: { select: { key: true, displayName: true } } }
    });
    json(res, 200, { ok: true, user: updated });
    return true;
  }

  // ── GET /team/license — plan info + seat usage ────────────────────────────
  if (req.url === "/team/license" && req.method === "GET") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    if (!hasPermission(auth.context.permissions, "manage_billing")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
    }
    const license = await prisma.license.findUnique({ where: { tenantId: auth.context.tenantId } });
    const usedSeats = await prisma.user.count({ where: { tenantId: auth.context.tenantId, isActive: true } });
    json(res, 200, {
      ok: true,
      license: license
        ? { plan: license.plan, maxSeats: license.maxSeats, usedSeats, renewsAt: license.renewsAt }
        : { plan: "starter", maxSeats: 5, usedSeats, renewsAt: null }
    });
    return true;
  }

  // ── GET /team/roles — list roles with user counts ─────────────────────────
  if (req.url === "/team/roles" && req.method === "GET") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    if (!hasPermission(auth.context.permissions, "manage_roles")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
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
    return true;
  }

  // ── PUT /team/roles/:id — rename a role's displayName ────────────────────
  if (parseTeamRoleId(req.url) && req.method === "PUT") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    if (!hasPermission(auth.context.permissions, "manage_roles")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
    }
    const roleId = parseTeamRoleId(req.url)!;
    const role = await prisma.role.findFirst({ where: { id: roleId, tenantId: auth.context.tenantId } });
    if (!role) { json(res, 404, { ok: false, error: "Role not found" }); return true; }
    const body = (await parseBody(req)) as { displayName?: unknown };
    const displayName = asTrimmedString(body.displayName);
    if (!displayName) { json(res, 400, { ok: false, error: "displayName is required" }); return true; }
    const updated = await prisma.role.update({
      where: { id: roleId },
      data: { displayName }
    });
    json(res, 200, {
      ok: true,
      role: { id: updated.id, key: updated.key, displayName: updated.displayName }
    });
    return true;
  }

  // ── POST /team/roles — create a custom role ───────────────────────────────
  if (req.url === "/team/roles" && req.method === "POST") {
    const auth = await authorize(req, res, null);
    if (!auth.ok) return true;
    if (!hasPermission(auth.context.permissions, "create_custom_roles")) {
      json(res, 403, { ok: false, error: "Insufficient permissions" }); return true;
    }
    const licCustomRoles = await enforceLicenseFeature(auth.context.tenantId, "custom_roles");
    if (!licCustomRoles.ok) { json(res, 403, { ok: false, error: licCustomRoles.error }); return true; }
    const body = (await parseBody(req)) as { displayName?: unknown; key?: unknown; permissions?: unknown };
    const displayName = asTrimmedString(body.displayName);
    const key = asTrimmedString(body.key)?.toLowerCase().replace(/\s+/g, "_");
    if (!displayName || !key) { json(res, 400, { ok: false, error: "displayName and key are required" }); return true; }
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
    if (existing) { json(res, 409, { ok: false, error: "A role with that key already exists" }); return true; }
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
    return true;
  }

  return false;
}
