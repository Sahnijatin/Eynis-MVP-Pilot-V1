"use client";

import { AlertTriangle, Radio, CheckCircle } from "lucide-react";
import { SentimentLineChart } from "./charts";
import { DateRangeControl } from "./date-range-control";
import type { SentimentResponse } from "../../lib/data";

// Derives a simple weighted "word cloud" of feedback terms from the real drivers.
const termSize = (weight: number) =>
  weight >= 0.8 ? "text-3xl" : weight >= 0.6 ? "text-2xl" : weight >= 0.4 ? "text-xl" : "text-base";

export function SentimentTrendsClient({ data, from, to }: { data: SentimentResponse; from?: string; to?: string }) {
  const maxSource = Math.max(1, ...data.bySource.map((s) => s.count));
  const hasData = data.totalFeedback > 0;
  const rangeLabel = from && to ? `${from} → ${to}` : "last 30 days";

  return (
    <div>
      <div className="page-header">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">Sentiment Trends</h1>
            <p className="page-subtitle">Customer sentiment from voice calls and inbound messages — {rangeLabel}</p>
          </div>
          <DateRangeControl defaultPreset="30d" />
        </div>
      </div>

      {!hasData && (
        <div className="card mb-5" style={{ background: "#f8fafc" }}>
          <p className="text-sm text-fg-muted">No sentiment data captured yet. Figures populate as voice calls are scored and inbound messages are classified.</p>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #0f766e" }}>
          <div className="kpi-label">Net Sentiment Score</div>
          <div className="kpi-value mt-1.5">{data.netScore} <span className="text-lg text-fg-muted font-normal">/ 100</span></div>
          <div className="kpi-label mt-1">% positive minus % negative</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Feedback Items</div>
          <div className="kpi-value mt-1.5">{data.totalFeedback.toLocaleString()}</div>
          <div className="flex gap-2 mt-1.5 text-xs">
            <span className="text-ok font-medium">{data.breakdown.positive} POSITIVE</span>
            <span className="text-fg-muted">{data.breakdown.neutral} NEUTRAL</span>
            <span className="text-danger font-medium">{data.breakdown.negative} NEGATIVE</span>
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Survey Completion</div>
          <div className="kpi-value mt-1.5">{data.surveyCompletionRate === null ? "—" : `${Math.round(data.surveyCompletionRate * 100)}%`}</div>
          <div className="text-xs text-fg-muted mt-1">{data.surveyCompletionRate === null ? "Survey channel not connected" : "of surveys sent"}</div>
        </div>
        {data.alert ? (
          <div className="card" style={{ background: "#fffbeb", borderLeft: "3px solid #f59e0b" }}>
            <div className="flex items-start gap-2">
              <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-warn uppercase tracking-wider">Sentiment Shift Alert</div>
                <div className="text-sm font-semibold text-warn mt-1">{data.alert.message}</div>
              </div>
            </div>
          </div>
        ) : (
          <div className="card" style={{ background: "#f0fdf4", borderLeft: "3px solid #10b981" }}>
            <div className="flex items-start gap-2">
              <CheckCircle className="w-4 h-4 text-ok shrink-0 mt-0.5" />
              <div>
                <div className="text-xs font-semibold text-ok uppercase tracking-wider">No alerts</div>
                <div className="text-sm font-semibold text-ok mt-1">Positive sentiment is holding up</div>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <h3 className="card-title">Sentiment Over Time</h3>
          <SentimentLineChart data={data.timeSeries.map((p) => ({ day: p.day, score: p.score ?? 0 }))} />
        </div>

        <div className="card">
          <h3 className="card-title">Feedback by Source</h3>
          <div className="space-y-3">
            {data.bySource.map((s) => (
              <div key={s.source}>
                <div className="flex justify-between mb-1">
                  <span className="text-sm font-medium text-fg">{s.source}</span>
                  <span className="text-sm text-fg-muted">{s.count}</span>
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
          {data.drivers.length === 0 ? (
            <p className="text-sm text-fg-muted">Drivers appear once enough feedback is collected.</p>
          ) : (
            <div className="space-y-3">
              {data.drivers.map((driver) => (
                <div key={`${driver.sentiment}-${driver.term}`}>
                  <div className="flex justify-between mb-1">
                    <span className={`text-sm font-medium ${driver.sentiment === "positive" ? "text-fg" : "text-danger"}`}>{driver.term}</span>
                    <span className={`text-xs font-semibold ${driver.sentiment === "positive" ? "text-ok" : "text-danger"}`}>
                      {driver.sentiment === "positive" ? "+" : "−"}{Math.round(driver.weight * 100)}
                    </span>
                  </div>
                  <div className="w-full h-1.5 rounded-full bg-surface-inset overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${driver.weight * 100}%`, background: driver.sentiment === "positive" ? "var(--color-primary, #0f766e)" : "#ef4444" }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="card">
          <h3 className="card-title">Common Feedback Terms</h3>
          {data.drivers.length === 0 ? (
            <p className="text-sm text-fg-muted">No terms yet.</p>
          ) : (
            <div className="flex flex-wrap gap-3 items-center py-2">
              {data.drivers.map((t) => (
                <span key={`${t.sentiment}-${t.term}`} className={`${termSize(t.weight)} ${t.sentiment === "positive" ? "text-accent-text" : "text-danger"} font-semibold leading-tight`}>{t.term}</span>
              ))}
            </div>
          )}
          <div className="mt-4 pt-4 border-t border-line">
            <div className="flex items-center gap-2 text-xs text-fg-muted">
              <Radio className="w-3.5 h-3.5 text-accent-text" />
              <span>Computed from scored voice utterances and classified inbound messages</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
