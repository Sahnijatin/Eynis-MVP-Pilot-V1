import { fetchDeals, fetchPipelines, fetchForecast, fetchTeamUsers, fetchGuests } from "../../lib/data";
import type { DealRow, PipelineRow, ForecastSummary } from "../../lib/data";
import { DealsBoardClient } from "../../components/ui/deals-board-client";

export const dynamic = "force-dynamic";

export default async function DealsPage() {
  let pipelines: PipelineRow[] = [];
  let deals: DealRow[] = [];
  let forecast: ForecastSummary | null = null;
  let owners: Array<{ id: string; fullName: string }> = [];
  let contacts: Array<{ id: string; fullName: string }> = [];

  try {
    const [pRes, dRes, fRes, uRes, gRes] = await Promise.all([
      fetchPipelines(),
      fetchDeals(),
      fetchForecast(),
      fetchTeamUsers().catch(() => ({ ok: false, users: [] as Array<{ id: string; fullName: string }> })),
      fetchGuests({ limit: 100 }).catch(() => ({ ok: false, items: [] as Array<{ id: string; fullName: string }> })),
    ]);
    if (pRes.ok) pipelines = pRes.items;
    if (dRes.ok) deals = dRes.items;
    if (fRes.ok && fRes.forecast) forecast = fRes.forecast;
    owners = (uRes.users ?? []).map((u) => ({ id: u.id, fullName: u.fullName }));
    contacts = (gRes.items ?? []).map((c) => ({ id: c.id, fullName: c.fullName }));
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
    />
  );
}
