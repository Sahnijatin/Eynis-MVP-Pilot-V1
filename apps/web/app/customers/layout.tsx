import type { ReactNode } from "react";
import { requireIndustry, requireRouteAccess } from "../../lib/route-gate";

// Server-side industry gate (3.5): this vertical's routes redirect other
// industries to the dashboard instead of rendering wrong-industry content.
export const dynamic = "force-dynamic";

export default async function GateLayout({ children }: { children: ReactNode }) {
  await requireRouteAccess("/customers");
  await requireIndustry("manufacturing", "fnb", "travel", "it_services");
  return <>{children}</>;
}
