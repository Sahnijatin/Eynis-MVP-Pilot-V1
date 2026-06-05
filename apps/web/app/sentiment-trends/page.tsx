import { fetchSentiment } from "../../lib/data";
import { SentimentTrendsClient } from "../../components/ui/sentiment-trends-client";

export const dynamic = "force-dynamic";

export default async function SentimentTrendsPage() {
  const data = await fetchSentiment();
  return <SentimentTrendsClient data={data} />;
}
