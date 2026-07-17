import type { ReactNode } from "react";
import { requireIndustry } from "../../../lib/route-gate";

// Industry gate: Revenue Analytics appears in every industry's nav except
// hospitality, which has /revenue-intelligence instead. The view_analytics
// permission gate is inherited from the parent /analytics layout.
export const dynamic = "force-dynamic";

export default async function GateLayout({ children }: { children: ReactNode }) {
  await requireIndustry("manufacturing", "fnb", "travel", "healthcare");
  return <>{children}</>;
}
