import { LeadImportWizard } from "../../../../../components/ui/lead-import-wizard";

export const dynamic = "force-dynamic";

export default async function ImportLeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadImportWizard campaignId={id} />;
}
