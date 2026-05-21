import { fetchSentiment } from "../../lib/data";
import { AlertTriangle, Radio } from "lucide-react";
import { SentimentLineChart } from "../../components/ui/charts";

export const dynamic = "force-dynamic";

const feedbackTerms = [
  { term: "Welcoming", size: "text-3xl", color: "text-teal-700" },
  { term: "Noisy AC", size: "text-lg", color: "text-red-500" },
  { term: "Pristine", size: "text-2xl", color: "text-teal-500" },
  { term: "Wait times", size: "text-base", color: "text-amber-500" },
  { term: "Attentive", size: "text-xl", color: "text-teal-600" },
  { term: "Room view", size: "text-xl", color: "text-teal-600" },
  { term: "Warm staff", size: "text-2xl", color: "text-teal-700" },
  { term: "Slow F&B", size: "text-sm", color: "text-red-400" },
  { term: "Elegant", size: "text-xl", color: "text-blue-600" }
];

export default async function SentimentTrendsPage() {
  let data: Awaited<ReturnType<typeof fetchSentiment>> | null = null;
  let error = "";
  try {
    data = await fetchSentiment();
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load sentiment data";
  }

  const score = data?.netScore ?? 82;
  const total = data?.totalFeedback ?? 1240;
  const completionRate = data?.surveyCompletionRate ?? 0.68;
  const breakdown = data?.breakdown ?? { positive: 850, neutral: 210, negative: 180 };
  const bySource = data?.bySource ?? [
    { source: "Post-Stay Survey", count: 400 },
    { source: "Google Reviews", count: 350 },
    { source: "TripAdvisor", count: 280 },
    { source: "Booking.com", count: 210 }
  ];
  const timeSeries = data?.timeSeries ?? [];
  const alert = data?.alert ?? { type: "warning", message: "Negative trend in F&B reviews" };

  const maxSource = Math.max(...bySource.map(s => s.count));

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Sentiment Trends</h1>
            <p className="page-subtitle">Monitor guest satisfaction and feedback across all properties</p>
          </div>
          <div className="flex items-center gap-2">
            <select className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 focus:outline-none">
              <option>The Riviera</option>
            </select>
            <select className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 focus:outline-none">
              <option>Last 30 Days</option>
              <option>Last Quarter</option>
            </select>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #0f766e" }}>
          <div className="kpi-label">Net Sentiment Score</div>
          <div className="kpi-value mt-1.5">{score} <span className="text-lg text-slate-400 font-normal">/ 100</span></div>
          <div className="kpi-delta up mt-1">↑ +4 pts vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Feedback Items</div>
          <div className="kpi-value mt-1.5">{total.toLocaleString()}</div>
          <div className="flex gap-2 mt-1.5 text-xs">
            <span className="text-emerald-600 font-medium">{breakdown.positive} POSITIVE</span>
            <span className="text-slate-400">{breakdown.neutral} NEUTRAL</span>
            <span className="text-red-500 font-medium">{breakdown.negative} NEGATIVE</span>
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Survey Completion</div>
          <div className="kpi-value mt-1.5">{Math.round(completionRate * 100)}%</div>
          <div className="text-xs text-slate-400 mt-1">450 surveys sent this month</div>
        </div>
        <div className="card" style={{ background: "#fffbeb", borderLeft: "3px solid #f59e0b" }}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Sentiment Shift Alert</div>
              <div className="text-sm font-semibold text-amber-800 mt-1">{alert.message}</div>
              <button className="text-xs font-medium text-amber-600 mt-1">View Details →</button>
            </div>
          </div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-1">
            <h3 className="card-title mb-0">Sentiment Over Time</h3>
            <div className="flex items-center gap-3 text-xs text-slate-500">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-teal-700 inline-block" />Current Period</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-slate-300 inline-block border-dashed" />Previous Period</span>
            </div>
          </div>
          <SentimentLineChart data={timeSeries.map((t, i) => ({ ...t, prev: Math.max(30, t.score - 15 + Math.floor(i * 0.3)) }))} />
        </div>

        <div className="card">
          <h3 className="card-title">Sentiment by Source</h3>
          <div className="space-y-3">
            {bySource.map((s) => (
              <div key={s.source}>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium text-slate-700">{s.source}</span>
                  <span className="text-sm text-slate-500">{s.count}</span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${(s.count / maxSource) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sentiment Drivers + Common Terms */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h3 className="card-title">Key Sentiment Drivers</h3>
          <div className="space-y-3">
            {(data?.drivers ?? [
              { term: "Welcoming", weight: 0.9, sentiment: "positive" },
              { term: "Pristine", weight: 0.7, sentiment: "positive" },
              { term: "Prompt Service", weight: 0.8, sentiment: "positive" },
              { term: "Noisy AC", weight: 0.4, sentiment: "negative" },
              { term: "Wait times", weight: 0.3, sentiment: "negative" }
            ]).map((d) => (
              <div key={d.term}>
                <div className="flex justify-between mb-1">
                  <span className={`text-sm font-medium ${d.sentiment === "positive" ? "text-slate-700" : "text-red-500"}`}>{d.term}</span>
                  <span className={`text-xs font-semibold ${d.sentiment === "positive" ? "text-emerald-600" : "text-red-500"}`}>
                    {d.sentiment === "positive" ? "+" : "−"}{Math.round(d.weight * 100)}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${d.weight * 100}%`, background: d.sentiment === "positive" ? "#0f766e" : "#ef4444" }} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">Common Feedback Terms</h3>
          <div className="flex flex-wrap gap-3 items-center py-2">
            {feedbackTerms.map((t) => (
              <span key={t.term} className={`${t.size} ${t.color} font-semibold leading-tight`}>{t.term}</span>
            ))}
          </div>

          <div className="mt-4 pt-4 border-t border-slate-100">
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <Radio className="w-3.5 h-3.5 text-teal-600" />
              <span>Live sentiment feed — updates every 15 minutes</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
