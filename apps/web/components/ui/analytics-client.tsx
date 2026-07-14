"use client";
import { useState } from "react";
import { BarChart3 } from "lucide-react";
import { PreviewBanner } from "./preview-badge";

type Range = "24h" | "7d" | "custom";

const RANGE_DATA: Record<"24h" | "7d", { label: string; value: number }[]> = {
  "24h": [
    { label: "6 AM", value: 2.1 },
    { label: "9 AM", value: 4.8 },
    { label: "12 PM", value: 7.2 },
    { label: "3 PM", value: 5.4 },
    { label: "6 PM", value: 9.1 },
    { label: "9 PM", value: 6.3 },
  ],
  "7d": [
    { label: "Mon", value: 4.2 },
    { label: "Tue", value: 5.8 },
    { label: "Wed", value: 4.9 },
    { label: "Thu", value: 6.7 },
    { label: "Fri", value: 8.4 },
    { label: "Sat", value: 9.2 },
    { label: "Sun", value: 7.1 },
  ],
};

const MONTHLY = [
  { label: "Dec", value: 18.4 }, { label: "Jan", value: 21.2 }, { label: "Feb", value: 19.8 },
  { label: "Mar", value: 24.6 }, { label: "Apr", value: 28.1 }, { label: "May", value: 31.4 }
];

const RANGE_LABELS: Record<Range, string> = {
  "24h": "Last 24 Hours (₹ Lakhs)",
  "7d": "Last 7 Days (₹ Lakhs)",
  "custom": "Custom Range (₹ Lakhs)",
};

interface Props {
  terminology: { requestPlural: string; entityPlural: string };
}

export default function AnalyticsClient({ terminology }: Props) {
  const [range, setRange] = useState<Range>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");

  const chartData = range === "custom" ? MONTHLY : RANGE_DATA[range];
  const max = Math.max(...chartData.map(d => d.value));
  const activeColor = "#ea580c";
  const inactiveColor = "#fed7aa";
  const lastIdx = chartData.length - 1;

  return (
    <div>
      <PreviewBanner />
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">Revenue Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Performance trends · {terminology.requestPlural.toLowerCase()} · {terminology.entityPlural.toLowerCase()} insights
        </p>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Revenue This Month</div>
          <div className="kpi-value mt-1.5">₹31.4L</div>
          <div className="kpi-delta up mt-1.5">↑ +11.7% vs Apr</div>
        </div>
        <div className="card">
          <div className="kpi-label">MoM Growth</div>
          <div className="kpi-value mt-1.5">+11.7%</div>
          <div className="kpi-delta up mt-1.5">5th consecutive growth month</div>
        </div>
        <div className="card">
          <div className="kpi-label">{terminology.requestPlural} This Month</div>
          <div className="kpi-value mt-1.5">284</div>
          <div className="kpi-delta up mt-1.5">↑ +22 vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Avg. {terminology.requestPlural.replace(/s$/, "")} Value</div>
          <div className="kpi-value mt-1.5">₹11,056</div>
          <div className="kpi-delta up mt-1.5">↑ +4.2%</div>
        </div>
      </div>

      <div className="card mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <BarChart3 className="w-4 h-4 text-orange-600" />
            <h3 className="card-title mb-0">Revenue Trend — {RANGE_LABELS[range]}</h3>
          </div>
          <div className="flex items-center gap-1.5">
            {(["24h", "7d", "custom"] as Range[]).map(r => (
              <button
                key={r}
                onClick={() => setRange(r)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors ${range === r
                  ? "text-white border-orange-500"
                  : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                style={range === r ? { background: "#ea580c" } : {}}
              >
                {r === "24h" ? "Last 24h" : r === "7d" ? "Last 7 Days" : "Custom Range"}
              </button>
            ))}
          </div>
        </div>

        {range === "custom" && (
          <div className="flex items-center gap-3 mb-4 p-3 bg-orange-50 rounded-lg border border-orange-100">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">From</label>
              <input
                type="date"
                value={customFrom}
                onChange={e => setCustomFrom(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">To</label>
              <input
                type="date"
                value={customTo}
                onChange={e => setCustomTo(e.target.value)}
                className="border border-slate-200 rounded-lg px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400"
              />
            </div>
            <span className="text-xs text-slate-500 italic">Showing 6-month sample data</span>
          </div>
        )}

        <div className="flex items-end gap-4" style={{ height: 160 }}>
          {chartData.map((d, i) => (
            <div key={d.label} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-semibold text-slate-600">₹{d.value}L</span>
              <div
                className="w-full rounded-t-md transition-all duration-300"
                style={{
                  height: `${(d.value / max) * 120}px`,
                  background: i === lastIdx ? activeColor : inactiveColor,
                  minHeight: 8
                }}
              />
              <span className="text-xs text-slate-500">{d.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4">
        <div className="card">
          <h3 className="card-title mb-3">Top Revenue Channels</h3>
          <div className="space-y-3">
            {[
              { label: "Direct / WhatsApp", pct: 48, value: "₹15.1L" },
              { label: "Referrals", pct: 28, value: "₹8.8L" },
              { label: "Online Portal", pct: 15, value: "₹4.7L" },
              { label: "Walk-in", pct: 9, value: "₹2.8L" }
            ].map(c => (
              <div key={c.label}>
                <div className="flex justify-between mb-1 text-sm">
                  <span className="text-slate-600">{c.label}</span>
                  <span className="font-semibold text-slate-700">{c.value} <span className="text-slate-500">({c.pct}%)</span></span>
                </div>
                <div className="progress-track">
                  <div className="h-full rounded-full" style={{ width: `${c.pct}%`, background: "#ea580c" }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="card-title mb-3">Monthly Target Tracker</h3>
          <div className="text-center py-4">
            <div className="text-4xl font-black text-slate-800">78%</div>
            <div className="text-sm text-slate-500 mt-1">of ₹40L monthly target</div>
          </div>
          <div className="w-full bg-slate-100 rounded-full h-3">
            <div className="h-3 rounded-full" style={{ width: "78%", background: "#ea580c" }} />
          </div>
          <div className="flex justify-between mt-2 text-xs text-slate-500">
            <span>₹0</span><span className="font-semibold text-slate-700">₹31.4L achieved</span><span>₹40L target</span>
          </div>
        </div>
      </div>
    </div>
  );
}
