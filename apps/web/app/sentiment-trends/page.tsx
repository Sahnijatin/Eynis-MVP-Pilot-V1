"use client";

import { useState } from "react";
import { AlertTriangle, Radio, Calendar, X } from "lucide-react";
import { SentimentLineChart } from "../../components/ui/charts";

type Range = "24h" | "7d" | "custom";

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

const drivers = [
  { term: "Welcoming",      weight: 0.9, sentiment: "positive" as const },
  { term: "Pristine",       weight: 0.7, sentiment: "positive" as const },
  { term: "Prompt Service", weight: 0.8, sentiment: "positive" as const },
  { term: "Noisy AC",       weight: 0.4, sentiment: "negative" as const },
  { term: "Wait times",     weight: 0.3, sentiment: "negative" as const }
];

function makeSeries(base: number, amp: number, drift: number) {
  return Array.from({ length: 30 }, (_, i) => {
    const score = Math.min(98, Math.max(45, Math.round(base + Math.sin(i * 0.35) * amp + i * drift)));
    return { day: i + 1, score, prev: Math.max(30, score - 12 + Math.floor(i * 0.3)) };
  });
}

const RANGE_DATA = {
  "24h": {
    score: 78, total: 124, completionRate: 0.71,
    breakdown: { positive: 82, neutral: 22, negative: 20 },
    bySource: [
      { source: "Post-Stay Survey", count: 48 },
      { source: "Google Reviews",   count: 32 },
      { source: "TripAdvisor",      count: 28 },
      { source: "Booking.com",      count: 16 }
    ],
    timeSeries: makeSeries(72, 10, 0.1),
    alert: "F&B satisfaction dip vs yesterday"
  },
  "7d": {
    score: 82, total: 840, completionRate: 0.68,
    breakdown: { positive: 580, neutral: 160, negative: 100 },
    bySource: [
      { source: "Post-Stay Survey", count: 280 },
      { source: "Google Reviews",   count: 240 },
      { source: "TripAdvisor",      count: 196 },
      { source: "Booking.com",      count: 124 }
    ],
    timeSeries: makeSeries(76, 14, 0.2),
    alert: "Negative trend in F&B reviews"
  }
};

function RangeBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="px-4 py-2 text-sm font-medium rounded-lg transition-colors"
      style={active ? { background: "#0f766e", color: "#fff" } : { border: "1px solid #e2e8f0", color: "#475569" }}
    >
      {children}
    </button>
  );
}

export default function SentimentTrendsPage() {
  const [range, setRange] = useState<Range>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customApplied, setCustomApplied] = useState(false);

  const d = RANGE_DATA[range === "custom" ? "7d" : range];
  const maxSource = Math.max(...d.bySource.map(s => s.count));

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
            <RangeBtn active={range === "24h"} onClick={() => setRange("24h")}>Last 24h</RangeBtn>
            <RangeBtn active={range === "7d"}  onClick={() => setRange("7d")}>Last 7 Days</RangeBtn>
            <button
              onClick={() => setRange("custom")}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
              style={range === "custom" ? { background: "#0f766e", color: "#fff" } : { border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <Calendar className="w-3.5 h-3.5" /> Custom Range
            </button>
          </div>
        </div>

        {range === "custom" && (
          <div className="flex items-center gap-3 mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">From</label>
              <input type="date" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-teal-400"
                value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">To</label>
              <input type="date" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-teal-400"
                value={customTo} onChange={e => setCustomTo(e.target.value)} />
            </div>
            <button
              onClick={() => setCustomApplied(true)}
              disabled={!customFrom || !customTo}
              className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
              style={{ background: "#0f766e" }}
            >
              Apply
            </button>
            {customApplied && (
              <span className="text-xs text-teal-600 font-medium">Showing {customFrom} → {customTo}</span>
            )}
            <button onClick={() => { setRange("7d"); setCustomApplied(false); }} className="ml-auto text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #0f766e" }}>
          <div className="kpi-label">Net Sentiment Score</div>
          <div className="kpi-value mt-1.5">{d.score} <span className="text-lg text-slate-400 font-normal">/ 100</span></div>
          <div className="kpi-delta up mt-1">↑ +4 pts vs last period</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Feedback Items</div>
          <div className="kpi-value mt-1.5">{d.total.toLocaleString()}</div>
          <div className="flex gap-2 mt-1.5 text-xs">
            <span className="text-emerald-600 font-medium">{d.breakdown.positive} POSITIVE</span>
            <span className="text-slate-400">{d.breakdown.neutral} NEUTRAL</span>
            <span className="text-red-500 font-medium">{d.breakdown.negative} NEGATIVE</span>
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Survey Completion</div>
          <div className="kpi-value mt-1.5">{Math.round(d.completionRate * 100)}%</div>
          <div className="text-xs text-slate-400 mt-1">450 surveys sent this month</div>
        </div>
        <div className="card" style={{ background: "#fffbeb", borderLeft: "3px solid #f59e0b" }}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
            <div>
              <div className="text-xs font-semibold text-amber-700 uppercase tracking-wider">Sentiment Shift Alert</div>
              <div className="text-sm font-semibold text-amber-800 mt-1">{d.alert}</div>
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
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-0.5 bg-slate-300 inline-block" />Previous Period</span>
            </div>
          </div>
          <SentimentLineChart data={d.timeSeries} />
        </div>

        <div className="card">
          <h3 className="card-title">Sentiment by Source</h3>
          <div className="space-y-3">
            {d.bySource.map((s) => (
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

      {/* Drivers + Terms */}
      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h3 className="card-title">Key Sentiment Drivers</h3>
          <div className="space-y-3">
            {drivers.map((driver) => (
              <div key={driver.term}>
                <div className="flex justify-between mb-1">
                  <span className={`text-sm font-medium ${driver.sentiment === "positive" ? "text-slate-700" : "text-red-500"}`}>{driver.term}</span>
                  <span className={`text-xs font-semibold ${driver.sentiment === "positive" ? "text-emerald-600" : "text-red-500"}`}>
                    {driver.sentiment === "positive" ? "+" : "−"}{Math.round(driver.weight * 100)}
                  </span>
                </div>
                <div className="w-full h-1.5 rounded-full bg-slate-100 overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${driver.weight * 100}%`, background: driver.sentiment === "positive" ? "#0f766e" : "#ef4444" }} />
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
