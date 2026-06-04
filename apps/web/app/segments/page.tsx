import { fetchSegments } from "../../lib/data";
import { SegmentsClient } from "../../components/ui/segments-client";

export const dynamic = "force-dynamic";

export default async function SegmentsPage() {
  let segments: Awaited<ReturnType<typeof fetchSegments>>["items"] = [];
  try {
    const r = await fetchSegments();
    if (r.ok) segments = r.items;
  } catch { /* render empty state */ }
  return <SegmentsClient initialSegments={segments} />;
}
