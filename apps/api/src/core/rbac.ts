import { prisma } from "../db/prisma";
import {
  DEFAULT_ROLE_PERMISSIONS,
  LEGACY_ROLE_TO_KEY,
  ROLE_KEY_TO_LEGACY,
  SYSTEM_ROLE_DISPLAY_NAMES,
  SYSTEM_ROLE_KEYS,
  type Permission,
} from "./permissions";

// ── Permission parsing ────────────────────────────────────────────────────────

export const parsePermissions = (json: string): string[] => {
  try {
    const arr = JSON.parse(json) as unknown;
    return Array.isArray(arr)
      ? (arr as unknown[]).filter((x): x is string => typeof x === "string")
      : [];
  } catch {
    return [];
  }
};

// ── Runtime permission check ──────────────────────────────────────────────────

export const hasPermission = (
  permissions: string[],
  permission: Permission | string,
): boolean => permissions.includes(permission);

// ── Legacy role fallback ──────────────────────────────────────────────────────
// Used when a User has no roleId (pre-RBAC users) — derives permissions from
// the old UserRole string stored in User.role.

export const getPermissionsForLegacyRole = (role: string): string[] => {
  // Accept a legacy hospitality role, or (defensively) a new role key. An
  // unrecognised role grants NOTHING — previously it silently defaulted to
  // "viewer", handing read access to requests/guests/reports to any unknown
  // role (F-23: default-deny instead of default-allow).
  const key = LEGACY_ROLE_TO_KEY[role] ?? (DEFAULT_ROLE_PERMISSIONS[role] ? role : null);
  if (!key) return [];
  return (DEFAULT_ROLE_PERMISSIONS[key] ?? []) as string[];
};

// Returns the legacy UserRole string that should be stored in User.role for
// a given new Role.key (keeps JWT / policyMap backward-compatible).
export const legacyRoleFor = (key: string): string =>
  ROLE_KEY_TO_LEGACY[key] ?? "housekeeping";

// ── DB helpers (idempotent, safe to call in seed or on-demand) ────────────────

export const seedDefaultRolesForHotel = async (tenantId: string): Promise<void> => {
  for (const key of SYSTEM_ROLE_KEYS) {
    const perms = DEFAULT_ROLE_PERMISSIONS[key] ?? [];
    await prisma.role.upsert({
      where: { tenantId_key: { tenantId, key } },
      // System-role permissions are not user-editable (only the displayName can
      // be renamed), so keep them in sync with the code-defined defaults. This
      // back-fills permissions added after the tenant was first seeded (e.g. the
      // CRM permissions) instead of leaving the role on a stale snapshot.
      update: { permissions: JSON.stringify(perms), isSystem: true, isCustom: false },
      create: {
        tenantId,
        key,
        displayName: SYSTEM_ROLE_DISPLAY_NAMES[key] ?? key,
        permissions: JSON.stringify(perms),
        isSystem: true,
        isCustom: false,
      },
    });
  }
};

// Self-healing back-fill: keep every existing tenant's SYSTEM role permissions
// in sync with the current DEFAULT_ROLE_PERMISSIONS. Safe to run on every boot —
// it only touches `isSystem` roles (custom roles carry their own permissions and
// are never matched), and is idempotent. Because permissions are loaded live
// from the Role table on each request, the next request after this runs picks up
// the corrected set without any token re-issue.
export const syncSystemRolePermissions = async (): Promise<void> => {
  for (const key of SYSTEM_ROLE_KEYS) {
    const perms = JSON.stringify(DEFAULT_ROLE_PERMISSIONS[key] ?? []);
    await prisma.role.updateMany({
      where: { key, isSystem: true },
      data: { permissions: perms },
    });
  }
};

export const seedLicenseForHotel = async (
  tenantId: string,
  plan = "starter",
  maxSeats = 5,
): Promise<void> => {
  await prisma.license.upsert({
    where: { tenantId },
    update: {},
    create: {
      tenantId,
      plan,
      maxSeats,
      renewsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
    },
  });
};

// ── Seat-count helpers ────────────────────────────────────────────────────────

export const getActiveUserCount = async (tenantId: string): Promise<number> =>
  prisma.user.count({ where: { tenantId, isActive: true } });

export const isWithinSeatLimit = async (tenantId: string): Promise<boolean> => {
  const license = await prisma.license.findUnique({ where: { tenantId } });
  if (!license) return true; // no license record → no restriction (dev/seed case)
  const used = await getActiveUserCount(tenantId);
  return used < license.maxSeats;
};
