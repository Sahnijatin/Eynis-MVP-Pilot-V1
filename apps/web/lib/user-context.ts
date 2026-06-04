import { currentUser } from "@clerk/nextjs/server";
import type { OrgRole } from "./rbac";
import type { TenantBranding } from "./theme";

export interface UserContext {
  tenantId: string | null;
  role: string | null;        // legacy role: owner / front_desk / housekeeping / fnb_manager
  roleKey: string | null;     // system role key: admin / manager / supervisor / agent / viewer
  orgRole: OrgRole;           // mapped UI role
  industry: string | null;
  propertyName: string | null;
  branding: TenantBranding | null;  // per-tenant white-label overrides (null = industry defaults)
  fullName: string | null;
  email: string | null;
  exists: boolean;            // true if user has a DB record
}

const apiBase = () => process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";

const LEGACY_TO_ORG_ROLE: Record<string, OrgRole> = {
  owner:        "org_admin",
  front_desk:   "org_manager",
  fnb_manager:  "org_supervisor",
  housekeeping: "org_agent",
};

const SYSTEM_KEY_TO_ORG_ROLE: Record<string, OrgRole> = {
  admin:      "org_admin",
  manager:    "org_manager",
  supervisor: "org_supervisor",
  agent:      "org_agent",
  viewer:     "org_viewer",
};

function toOrgRole(roleKey: string | null, legacyRole: string | null): OrgRole {
  if (roleKey && SYSTEM_KEY_TO_ORG_ROLE[roleKey]) return SYSTEM_KEY_TO_ORG_ROLE[roleKey];
  if (legacyRole && LEGACY_TO_ORG_ROLE[legacyRole]) return LEGACY_TO_ORG_ROLE[legacyRole];
  // Unknown/unmapped role → least privilege. This only affects UI nav (the API is
  // authoritative for permissions); defaulting to admin would over-expose nav.
  return "org_viewer";
}

async function identifyByEmail(email: string) {
  // Hard 3-second timeout. If the API is down or slow we MUST NOT hang the
  // server render — that's what produced the blank-screen-on-login bug.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${apiBase()}/auth/identify?email=${encodeURIComponent(email)}`, { cache: "no-store", signal: ctrl.signal });
    if (!res.ok) return null;
    const data = await res.json() as { ok: boolean; exists?: boolean; tenantId?: string; role?: string; roleKey?: string | null; industry?: string; propertyName?: string; branding?: TenantBranding | null; fullName?: string };
    if (!data.ok || !data.exists) return null;
    return {
      tenantId: data.tenantId ?? null,
      role: data.role ?? null,
      roleKey: data.roleKey ?? null,
      industry: data.industry ?? null,
      propertyName: data.propertyName ?? null,
      branding: data.branding ?? null,
      fullName: data.fullName ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function resolveUserContext(): Promise<UserContext> {
  let clerkUser: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    clerkUser = await currentUser();
  } catch {
    // Clerk not configured
  }

  if (!clerkUser) {
    return { tenantId: null, role: null, roleKey: null, orgRole: "org_admin", industry: null, propertyName: null, branding: null, fullName: null, email: null, exists: false };
  }

  const email = clerkUser.primaryEmailAddress?.emailAddress ?? null;

  // DB is the single source of truth. If no DB record exists, the user is "new"
  // regardless of what Clerk metadata says (which could be stale from a wiped hotel).
  const dbUser = email ? await identifyByEmail(email) : null;

  if (dbUser && dbUser.tenantId) {
    return {
      tenantId: dbUser.tenantId,
      role: dbUser.role,
      roleKey: dbUser.roleKey,
      orgRole: toOrgRole(dbUser.roleKey, dbUser.role),
      industry: dbUser.industry ?? "hospitality",
      propertyName: dbUser.propertyName ?? null,
      branding: dbUser.branding ?? null,
      fullName: dbUser.fullName ?? null,
      email,
      exists: true,
    };
  }

  // No DB record — user must (re-)onboard. Don't trust Clerk metadata pointing to deleted hotels.
  return { tenantId: null, role: null, roleKey: null, orgRole: "org_admin", industry: null, propertyName: null, branding: null, fullName: clerkUser.fullName ?? null, email, exists: false };
}
