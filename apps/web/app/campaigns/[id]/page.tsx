import { notFound } from "next/navigation";
import { fetchCampaign, fetchCampaignLeads } from "../../../lib/data";
import { CampaignDetailClient } from "../../../components/ui/campaign-detail-client";

export const dynamic = "force-dynamic";

export default async function CampaignDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let detail, leads;
  try {
    [detail, leads] = await Promise.all([fetchCampaign(id), fetchCampaignLeads(id, { limit: 50 })]);
  } catch {
    notFound();
  }
  if (!detail?.ok || !detail.campaign) notFound();
  return (
    <CampaignDetailClient
      campaign={detail.campaign}
      stats={detail.stats}
      leads={leads?.items ?? []}
      leadTotal={leads?.page?.total ?? 0}
    />
  );
}
