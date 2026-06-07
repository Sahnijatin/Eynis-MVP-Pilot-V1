import { ReportBuilder } from "../../../../components/ui/report-builder";

export const dynamic = "force-dynamic";

export default async function EditReportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <ReportBuilder reportId={id} />;
}
