import { redirect } from "next/navigation";
import { getUserWorkspace } from "./workspace";
import { resolveUserContext } from "./user-context";
import { canAccessRoute } from "./rbac";
import type { Industry } from "./industry-config";

// Server-side permission gating. The AppShell's client-side route guard is
// UX only — it redirects after the restricted page has already server-rendered,
// and in the static-token deployment mode (EYNIS_API_TOKEN) the rendered HTML
// carries real data. Layouts of permission-gated routes call this so the server
// never renders a page the role can't access. The permission map is the same
// ROUTE_PERMISSIONS the client guard uses; the API stays the authority on data.
export async function requireRouteAccess(pathname: string): Promise<void> {
  const ctx = await resolveUserContext(); // per-request cached
  if (!canAccessRoute(ctx.orgRole, pathname)) redirect("/dashboard");
}

// Server-side industry gating (improvement plan 3.5). Hiding a module from the
// nav is cosmetic — any tenant can type a vertical URL and would get another
// industry's page. Vertical-specific routes call this from a server layout (or
// page) so a wrong-industry visit redirects to the dashboard instead of
// rendering. An unresolved industry (workspace lookup failed) falls back to
// getUserWorkspace's hospitality default rather than blocking, matching the
// dashboard's defensive behaviour — the API remains the authority for data.
export async function requireIndustry(...industries: Industry[]): Promise<void> {
  const ws = await getUserWorkspace();
  const industry = ws.industry ?? "hospitality";
  if (!industries.includes(industry)) redirect("/dashboard");
}
