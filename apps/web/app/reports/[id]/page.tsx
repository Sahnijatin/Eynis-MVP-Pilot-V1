import { ReportView } from "../../../components/ui/report-view";

export const dynamic = "force-dynamic";

export default async function ReportViewPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportView reportId={id} />;
}
