import { getUserWorkspace } from "../../lib/workspace";
import { getIndustryConfig } from "../../lib/industry-config";
import { CustomersClient } from "../../components/ui/customers-client";

export const dynamic = "force-dynamic";

export default async function CustomersPage() {
  let terminology = getIndustryConfig("manufacturing").terminology;
  let industry = "manufacturing";
  try {
    const ws = await getUserWorkspace();
    terminology = ws.config.terminology;
    industry = ws.industry ?? "manufacturing";
  } catch { }
  return <CustomersClient terminology={terminology} industry={industry} />;
}
