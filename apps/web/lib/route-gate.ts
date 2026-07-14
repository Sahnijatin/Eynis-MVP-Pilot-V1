import { redirect } from "next/navigation";
import { getUserWorkspace } from "./workspace";
import type { Industry } from "./industry-config";

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
