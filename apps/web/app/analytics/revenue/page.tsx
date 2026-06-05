import { getUserWorkspace } from "../../../lib/workspace";
import AnalyticsClient from "../../../components/ui/analytics-client";

export const dynamic = "force-dynamic";

export default async function RevenueAnalyticsPage() {
  const { config } = await getUserWorkspace().catch(() => ({
    config: { terminology: { requestPlural: "Transactions", entityPlural: "Clients" } }
  }));

  return <AnalyticsClient terminology={config.terminology} />;
}
