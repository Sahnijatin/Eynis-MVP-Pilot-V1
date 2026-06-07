import { fetchSentiment } from "../../lib/data";
import { SentimentTrendsClient } from "../../components/ui/sentiment-trends-client";

export const dynamic = "force-dynamic";

export default async function SentimentTrendsPage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const data = await fetchSentiment(sp.from, sp.to);
  return <SentimentTrendsClient data={data} from={sp.from} to={sp.to} />;
}
