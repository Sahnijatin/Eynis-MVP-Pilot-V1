import type { ReactNode } from "react";
import { requireIndustry, requireRouteAccess } from "../../lib/route-gate";

// Server-side gates: Material Yield is the manufacturing view of the shared
// inventory store, plus the manage_inventory permission.
export const dynamic = "force-dynamic";

export default async function GateLayout({ children }: { children: ReactNode }) {
  await requireRouteAccess("/materials");
  await requireIndustry("manufacturing");
  return <>{children}</>;
}
