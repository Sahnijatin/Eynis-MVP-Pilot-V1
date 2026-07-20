import { fetchAutomations, fetchAutomationExecutions, fetchSequences } from "../../lib/data";
import { getUserWorkspace } from "../../lib/workspace";
import { AutomationsClient } from "../../components/ui/automations-client";
import { JourneyAutomationsClient } from "../../components/ui/journey-automations-client";

export const dynamic = "force-dynamic";

// Active sequences a "New Flow" enroll action (multi-touch follow-up / nurture drip)
// can enroll contacts into — offered in the New Flow modal's sequence picker.
async function activeSequenceOptions(): Promise<Array<{ id: string; name: string }>> {
  try {
    const seq = await fetchSequences();
    return seq.ok ? seq.items.filter((s) => s.status === "active").map((s) => ({ id: s.id, name: s.name })) : [];
  } catch { return []; }
}

export default async function AutomationsPage() {
  const { industry, config } = await getUserWorkspace();

  // Non-hospitality industries: the interactive journey-flow builder. Real flows the
  // tenant has created are fetched and rendered with working pause/resume; the "New
  // Flow" button and example templates create real, persisted flows.
  if (industry !== "hospitality") {
    let flows: Awaited<ReturnType<typeof fetchAutomations>>["items"] = [];
    let sequences: Array<{ id: string; name: string }> = [];
    try {
      const [data, seqs] = await Promise.all([fetchAutomations(), activeSequenceOptions()]);
      sequences = seqs;
      // Only surface custom journey flows here (operational engine rules live on the
      // hospitality/ops surface); a flow created via New Flow is marketing + custom.
      if (data.ok) flows = data.items.filter((i) => i.custom || i.ruleType === "marketing");
    } catch { /* render empty — the client still offers New Flow + templates */ }
    return (
      <JourneyAutomationsClient
        accentColor={config.accentColor}
        industryLabel={config.name}
        initialFlows={flows}
        sequences={sequences}
      />
    );
  }

  // Hospitality: fetch live data from the API and hand it to the interactive
  // client (pause/resume rules, filter, export CSV).
  let data: Awaited<ReturnType<typeof fetchAutomations>> | null = null;
  let execData: Awaited<ReturnType<typeof fetchAutomationExecutions>> | null = null;
  let sequences: Array<{ id: string; name: string }> = [];
  let error = "";
  try {
    // 200 recent executions: 15 rows feed the log below, the rest feed the
    // per-day activity chart so it reflects real engine history.
    [data, execData, sequences] = await Promise.all([fetchAutomations(), fetchAutomationExecutions(200), activeSequenceOptions()]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load automations";
  }

  const summary = data?.summary ?? { totalAutomations: 0, activeFlows: 0, avgConversion: 0, revenueAttributed: 0, totalExecutions: 0 };

  return (
    <AutomationsClient
      initialItems={data?.items ?? []}
      initialSummary={summary}
      initialExecutions={execData?.items ?? []}
      error={error}
      sequences={sequences}
    />
  );
}
