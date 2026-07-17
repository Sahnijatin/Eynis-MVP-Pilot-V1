import { getUserWorkspace } from "../../lib/workspace";
import { getIndustryConfig } from "../../lib/industry-config";
import { CustomersClient } from "../../components/ui/customers-client";
import { CustomersIntel } from "../../components/ui/customers-intel";
import { fetchContactIntel } from "../../lib/data";

export const dynamic = "force-dynamic";

// Client records (Phase 7 + Wave 5). Manufacturing, F&B and Travel render REAL
// intelligence computed from live quotes/orders/contacts; healthcare keeps its
// Preview until wired.
const INTEL_LABEL: Record<string, string> = {
  manufacturing: "Client Intelligence",
  fnb: "Customer Loyalty",
  travel: "Client Database",
};

export default async function CustomersPage() {
  let terminology = getIndustryConfig("manufacturing").terminology;
  let industry = "manufacturing";
  try {
    const ws = await getUserWorkspace();
    terminology = ws.config.terminology;
    industry = ws.industry ?? "manufacturing";
  } catch { }
  if (industry in INTEL_LABEL) {
    const intel = await fetchContactIntel();
    return <CustomersIntel items={intel.items} entityLabel={INTEL_LABEL[industry] ?? "Customer Records"} />;
  }
  return <CustomersClient terminology={terminology} industry={industry} />;
}
