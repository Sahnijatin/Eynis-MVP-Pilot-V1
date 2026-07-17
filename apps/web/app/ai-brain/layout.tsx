import type { ReactNode } from "react";
import { requireIndustry, requireRouteAccess } from "../../lib/route-gate";

// Server-side gates: AI Brain is in the nav of every industry except
// hospitality (which has its own intelligence surfaces), and needs the
// view_ai_brain permission.
export const dynamic = "force-dynamic";

export default async function GateLayout({ children }: { children: ReactNode }) {
  await requireRouteAccess("/ai-brain");
  await requireIndustry("manufacturing", "fnb", "travel", "healthcare");
  return <>{children}</>;
}
