import { BarChart3 } from "lucide-react";
import { getUserWorkspace } from "../../lib/workspace";

export const dynamic = "force-dynamic";

export default async function AnalyticsPage() {
  const { terminology } = await getUserWorkspace().then(w => w.config).catch(() => ({ terminology: { requestPlural: "Transactions", entityPlural: "Clients" } }));

  const MONTHLY = [
    { month: "Dec", revenue: 18.4 }, { month: "Jan", revenue: 21.2 }, { month: "Feb", revenue: 19.8 },
    { month: "Mar", revenue: 24.6 }, { month: "Apr", revenue: 28.1 }, { month: "May", revenue: 31.4 }
  ];
  const max = Math.max(...MONTHLY.map(d => d.revenue));

  return (
    <div>
      <div className="mb-5">
        <h1 className="text-xl font-bold text-slate-800">Revenue Analytics</h1>
        <p className="text-sm text-slate-500 mt-0.5">Performance trends · {terminology.requestPlural.toLowerCase()} · {terminology.entityPlural.toLowerCase()} insights</p>
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
        <div className="flex items-center gap-2 mb-4">
          <BarChart3 className="w-4 h-4 text-blue-600" />
          <h3 className="card-title mb-0">Revenue Trend — Last 6 Months (₹ Lakhs)</h3>
        </div>
        <div className="flex items-end gap-4" style={{ height: 160 }}>
          {MONTHLY.map((d) => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-semibold text-slate-600">₹{d.revenue}L</span>
              <div className="w-full rounded-t-md transition-all" style={{ height: `${(d.revenue / max) * 120}px`, background: d.month === "May" ? "#1d4ed8" : "#bfdbfe", minHeight: 8 }} />
              <span className="text-xs text-slate-400">{d.month}</span>
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
                  <span className="font-semibold text-slate-700">{c.value} <span className="text-slate-400">({c.pct}%)</span></span>
                </div>
                <div className="progress-track">
                  <div className="progress-fill" style={{ width: `${c.pct}%` }} />
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
            <div className="h-3 rounded-full" style={{ width: "78%", background: "#1d4ed8" }} />
          </div>
          <div className="flex justify-between mt-2 text-xs text-slate-500">
            <span>₹0</span><span className="font-semibold text-slate-700">₹31.4L achieved</span><span>₹40L target</span>
          </div>
        </div>
      </div>
    </div>
  );
}
