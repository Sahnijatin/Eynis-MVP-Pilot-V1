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
    // Transient API failure (timeout/network) — an existing campaign must not
    // render as "not found". Show an honest retry state instead.
    return (
      <div className="max-w-lg mx-auto mt-16 text-center">
        <h1 className="text-lg font-semibold text-fg mb-2">Couldn&apos;t load this campaign</h1>
        <p className="text-sm text-fg-muted mb-4">The service didn&apos;t respond in time. Your data is safe — try again.</p>
        <a href="" className="text-sm font-medium underline" style={{ color: "var(--color-primary, #0f766e)" }}>Reload</a>
      </div>
    );
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
