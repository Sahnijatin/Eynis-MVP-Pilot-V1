import { getUserWorkspace } from "../../lib/workspace";
import { getIndustryConfig } from "../../lib/industry-config";
import { CustomersClient } from "../../components/ui/customers-client";
import { CustomersIntel } from "../../components/ui/customers-intel";
import { fetchContactIntel } from "../../lib/data";

export const dynamic = "force-dynamic";

// Client records (Phase 7). Manufacturing renders REAL intelligence computed
// from live quotes/orders; F&B and travel keep their Preview until wired.
export default async function CustomersPage() {
  let terminology = getIndustryConfig("manufacturing").terminology;
  let industry = "manufacturing";
  try {
    const ws = await getUserWorkspace();
    terminology = ws.config.terminology;
    industry = ws.industry ?? "manufacturing";
  } catch { }
  if (industry === "manufacturing") {
    const intel = await fetchContactIntel();
    return <CustomersIntel items={intel.items} entityLabel="Client Intelligence" />;
  }
  return <CustomersClient terminology={terminology} industry={industry} />;
}
