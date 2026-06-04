import { fetchSequences, fetchSegments } from "../../lib/data";
import { SequencesClient } from "../../components/ui/sequences-client";

export const dynamic = "force-dynamic";

export default async function SequencesPage() {
  let sequences: Awaited<ReturnType<typeof fetchSequences>>["items"] = [];
  let segments: Awaited<ReturnType<typeof fetchSegments>>["items"] = [];
  try {
    const [s, seg] = await Promise.all([fetchSequences(), fetchSegments()]);
    if (s.ok) sequences = s.items;
    if (seg.ok) segments = seg.items;
  } catch { /* render empty state */ }
  return <SequencesClient initialSequences={sequences} segments={segments} />;
}
