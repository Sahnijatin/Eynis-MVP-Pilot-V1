import { fetchUpsellCampaigns } from "../../lib/data";
import { UpsellCampaignsClient } from "../../components/ui/upsell-campaigns-client";

export const dynamic = "force-dynamic";

export default async function UpsellCampaignsPage() {
  const data = await fetchUpsellCampaigns();
  return <UpsellCampaignsClient data={data} />;
}
