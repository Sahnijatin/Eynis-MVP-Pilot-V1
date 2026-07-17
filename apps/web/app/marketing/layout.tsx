import type { ReactNode } from "react";
import { requireRouteAccess } from "../../lib/route-gate";

// Server-side permission gate: never render this route group's pages for a
// role the ROUTE_PERMISSIONS map excludes (the client guard is UX only).
export const dynamic = "force-dynamic";

export default async function GateLayout({ children }: { children: ReactNode }) {
  await requireRouteAccess("/marketing");
  return <>{children}</>;
}
