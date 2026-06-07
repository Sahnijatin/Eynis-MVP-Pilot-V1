import { getUserWorkspace } from "../../lib/workspace";
import { fetchResearchTemplates, fetchResearchRuns, fetchResearchSources } from "../../lib/data";
import ResearchStudioClient from "../../components/ui/research-studio-client";

export const dynamic = "force-dynamic";

// Research Studio (RS-1). A configurable research-and-report module: define what to
// research, which (self-hosted) sources to use and how the report is structured,
// then run it against any prospect/deal/company and preview + export the branded report.
export default async function ResearchPage({ searchParams }: { searchParams: Promise<{ run?: string }> }) {
  const { run } = await searchParams;
  const { config } = await getUserWorkspace();
  const [templates, runs, catalog] = await Promise.all([
    fetchResearchTemplates(),
    fetchResearchRuns(),
    fetchResearchSources(),
  ]);

  return (
    <ResearchStudioClient
      accent={config.accentColor}
      initialTemplates={templates.items}
      initialRuns={runs.items}
      catalog={catalog}
      licenseError={templates.ok ? null : templates.error ?? null}
      initialRunId={typeof run === "string" ? run : null}
    />
  );
}
