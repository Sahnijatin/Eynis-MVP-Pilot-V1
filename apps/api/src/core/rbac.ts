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
  const key = LEGACY_ROLE_TO_KEY[role] ?? "viewer";
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
      update: {},
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
