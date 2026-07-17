import { cache } from "react";
import { getApiBaseUrl, tokenExchangeHeaders } from "./api";
import { currentUser } from "@clerk/nextjs/server";
import type { OrgRole } from "./rbac";
import type { TenantBranding } from "./theme";
import { getActiveImpersonation } from "./impersonation";
import { readActiveWorkspace } from "./active-workspace";

// One membership of the signed-in identity (multi-workspace). Summary used to
// populate the workspace switcher.
export interface WorkspaceSummary {
  tenantId: string;
  propertyName: string | null;
  industry: string | null;
  roleKey: string | null;
}

export interface UserContext {
  tenantId: string | null;
  role: string | null;        // legacy role: owner / front_desk / housekeeping / fnb_manager
  roleKey: string | null;     // system role key: admin / manager / supervisor / agent / viewer
  orgRole: OrgRole;           // mapped UI role
  industry: string | null;
  propertyName: string | null;
  branding: TenantBranding | null;  // per-tenant white-label overrides (null = industry defaults)
  whitelabelTier: string | null;    // white-label tier (E-9); gates deep overrides
  fullName: string | null;
  email: string | null;
  exists: boolean;            // true if user has a DB record
  // All workspaces this identity belongs to (multi-workspace). Drives the
  // switcher; empty when the user has no membership yet.
  workspaces: WorkspaceSummary[];
  // Impersonation (E-6): non-null while an admin is viewing the app as another
  // user. The identity fields above reflect the *target*; this carries who is
  // really behind the session so the UI can show a banner.
  impersonating: {
    impersonatorEmail: string;
    impersonatorName: string | null;
    targetEmail: string;
    targetName: string | null;
  } | null;
}

interface Membership {
  tenantId: string;
  role: string | null;
  roleKey: string | null;
  industry: string | null;
  propertyName: string | null;
  branding: TenantBranding | null;
  whitelabelTier: string | null;
  fullName: string | null;
}

// New Role.key → mapped UI org role (target identity during impersonation).
const SYSTEM_KEY_TO_ORG: Record<string, OrgRole> = {
  admin: "org_admin", manager: "org_manager", supervisor: "org_supervisor", agent: "org_agent", viewer: "org_viewer",
};


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

async function identifyByEmail(email: string): Promise<Membership[]> {
  // Hard 3-second timeout. If the API is down or slow we MUST NOT hang the
  // server render — that's what produced the blank-screen-on-login bug.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const res = await fetch(`${getApiBaseUrl()}/auth/identify?email=${encodeURIComponent(email)}`, { cache: "no-store", signal: ctrl.signal, headers: tokenExchangeHeaders() });
    if (!res.ok) return [];
    const data = await res.json() as {
      ok: boolean; exists?: boolean;
      workspaces?: Array<{ tenantId: string; role?: string; roleKey?: string | null; industry?: string; propertyName?: string; branding?: TenantBranding | null; whitelabelTier?: string | null; fullName?: string }>;
    };
    if (!data.ok || !data.exists || !data.workspaces?.length) return [];
    return data.workspaces.map(w => ({
      tenantId: w.tenantId,
      role: w.role ?? null,
      roleKey: w.roleKey ?? null,
      industry: w.industry ?? null,
      propertyName: w.propertyName ?? null,
      branding: w.branding ?? null,
      whitelabelTier: w.whitelabelTier ?? null,
      fullName: w.fullName ?? null,
    }));
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

// Wrapped in React `cache()` so repeated calls within a single server request
// render (root layout + page + getUserWorkspace, etc.) dedupe to one /auth/identify
// fetch. cache() keys on call-site args: no-arg calls collapse to one entry,
// while `{ ignoreImpersonation: true }` callers (api.ts / api/workspace) get their
// own. Per-request only — never shared across requests.
export const resolveUserContext = cache(async function resolveUserContext(opts: { ignoreImpersonation?: boolean } = {}): Promise<UserContext> {
  let clerkUser: Awaited<ReturnType<typeof currentUser>> = null;
  try {
    clerkUser = await currentUser();
  } catch {
    // Clerk not configured
  }

  if (!clerkUser) {
    return { tenantId: null, role: null, roleKey: null, orgRole: "org_admin", industry: null, propertyName: null, branding: null, whitelabelTier: null, fullName: null, email: null, exists: false, workspaces: [], impersonating: null };
  }

  const email = clerkUser.primaryEmailAddress?.emailAddress ?? null;

  // DB is the single source of truth. If no membership exists, the user is "new"
  // regardless of what Clerk metadata says (which could be stale from a wiped hotel).
  const memberships = email ? await identifyByEmail(email) : [];

  if (memberships.length > 0) {
    // Pick the active workspace: the cookie selection if it matches a real
    // membership, otherwise the first (oldest) one. The cookie never grants
    // access on its own — it must resolve to a genuine membership here.
    const wanted = await readActiveWorkspace();
    const active = (wanted && memberships.find(m => m.tenantId === wanted)) || memberships[0];
    const workspaces: WorkspaceSummary[] = memberships.map(m => ({
      tenantId: m.tenantId, propertyName: m.propertyName, industry: m.industry, roleKey: m.roleKey,
    }));

    const base: UserContext = {
      tenantId: active.tenantId,
      role: active.role,
      roleKey: active.roleKey,
      orgRole: toOrgRole(active.roleKey, active.role),
      industry: active.industry ?? "hospitality",
      propertyName: active.propertyName ?? null,
      branding: active.branding ?? null,
      whitelabelTier: active.whitelabelTier ?? null,
      fullName: active.fullName ?? null,
      email,
      exists: true,
      workspaces,
      impersonating: null,
    };

    // Impersonation override (E-6): reflect the *target* user's identity and role
    // so nav, the route guard, and the role chip match what the API enforces.
    // Tenant/industry/branding stay the same (impersonation is tenant-scoped).
    if (!opts.ignoreImpersonation) {
      const imp = await getActiveImpersonation();
      if (imp) {
        return {
          ...base,
          role: null,
          roleKey: imp.target.roleKey,
          orgRole: (imp.target.roleKey && SYSTEM_KEY_TO_ORG[imp.target.roleKey]) || "org_viewer",
          fullName: imp.target.fullName,
          email: imp.target.email,
          impersonating: {
            impersonatorEmail: imp.impersonator.email,
            impersonatorName: imp.impersonator.fullName,
            targetEmail: imp.target.email,
            targetName: imp.target.fullName,
          },
        };
      }
    }
    return base;
  }

  // No membership — user must (re-)onboard. Don't trust Clerk metadata pointing to deleted hotels.
  return { tenantId: null, role: null, roleKey: null, orgRole: "org_admin", industry: null, propertyName: null, branding: null, whitelabelTier: null, fullName: clerkUser.fullName ?? null, email, exists: false, workspaces: [], impersonating: null };
});
