import type { ReactNode } from "react";
import { requireIndustry, requireRouteAccess } from "../../lib/route-gate";

// Server-side gates: /inventory is the F&B-flavored stock view (manufacturing
// uses /materials for the same store), plus the manage_inventory permission.
export const dynamic = "force-dynamic";

export default async function GateLayout({ children }: { children: ReactNode }) {
  await requireRouteAccess("/inventory");
  await requireIndustry("fnb");
  return <>{children}</>;
}
