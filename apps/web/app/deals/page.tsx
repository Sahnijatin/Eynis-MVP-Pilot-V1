import { fetchDeals, fetchPipelines, fetchForecast, fetchTeamUsers, fetchContacts, fetchCompanies, fetchDealSuggestions } from "../../lib/data";
import type { DealRow, PipelineRow, ForecastSummary, DealSuggestionRow } from "../../lib/data";
import { DealsBoardClient } from "../../components/ui/deals-board-client";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  let pipelines: PipelineRow[] = [];
  let deals: DealRow[] = [];
  let forecast: ForecastSummary | null = null;
  let owners: Array<{ id: string; fullName: string }> = [];
  let contacts: Array<{ id: string; fullName: string }> = [];
  let companies: Array<{ id: string; name: string }> = [];
  let suggestions: DealSuggestionRow[] = [];

  try {
    const [pRes, dRes, fRes, uRes, cRes, coRes, sRes] = await Promise.all([
      fetchPipelines(),
      fetchDeals(),
      fetchForecast(),
      fetchTeamUsers().catch(() => ({ ok: false, users: [] as Array<{ id: string; fullName: string }> })),
      fetchContacts().catch(() => ({ ok: false, items: [] as Array<{ id: string; fullName: string }> })),
      fetchCompanies().catch(() => ({ ok: false, items: [] as Array<{ id: string; name: string }> })),
      fetchDealSuggestions().catch(() => ({ ok: false, items: [] as DealSuggestionRow[] })),
    ]);
    if (pRes.ok) pipelines = pRes.items;
    if (dRes.ok) deals = dRes.items;
    if (fRes.ok && fRes.forecast) forecast = fRes.forecast;
    owners = (uRes.users ?? []).map((u) => ({ id: u.id, fullName: u.fullName }));
    contacts = (cRes.items ?? []).map((c) => ({ id: c.id, fullName: c.fullName }));
    companies = (coRes.items ?? []).map((c) => ({ id: c.id, name: c.name }));
    if (sRes.ok) suggestions = sRes.items;
  } catch {
    /* render with whatever resolved; client shows an empty state */
  }

  return (
    <DealsBoardClient
      initialPipelines={pipelines}
      initialDeals={deals}
      initialForecast={forecast}
      owners={owners}
      contacts={contacts}
      companies={companies}
      initialSuggestions={suggestions}
    />
  );
}
