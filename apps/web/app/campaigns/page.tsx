import { fetchCampaigns, type CampaignSummary } from "../../lib/data";
import { CampaignsClient } from "../../components/ui/campaigns-client";

export const dynamic = "force-dynamic";

export default async function CampaignsPage() {
  let items: CampaignSummary[] = [];
  try {
    const res = await fetchCampaigns();
    items = res.items ?? [];
  } catch { }
  return <CampaignsClient items={items} />;
}
