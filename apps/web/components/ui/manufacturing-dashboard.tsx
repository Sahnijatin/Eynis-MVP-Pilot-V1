import Link from "next/link";
import { AlertCircle, AlertTriangle, ChevronRight, Brain, Zap, ClipboardList, Calculator } from "lucide-react";
import { SmartInsights } from "./smart-insights";
import { PreviewBanner } from "./preview-badge";

const PIPELINE = [
  { label: "New Orders", count: 12, color: "#6366f1" },
  { label: "In Production", count: 18, color: "#f59e0b" },
  { label: "QC Review", count: 8, color: "#8b5cf6" },
  { label: "Ready to Ship", count: 6, color: "#10b981" }
];

const TOP_ORDERS = [
  { id: "ORD-2839", client: "Kapoor Furnishings", value: "₹4.5L", due: "28 May", urgent: true },
  { id: "ORD-2847", client: "Sharma Interiors", value: "₹3.2L", due: "2 Jun", urgent: false },
  { id: "ORD-2844", client: "Mehta Residences", value: "₹2.1L", due: "30 May", urgent: true }
];

export function ManufacturingDashboard() {
  return (
    <div>
      <PreviewBanner />
      <SmartInsights industry="manufacturing" />
      {/* KPI row */}
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Revenue Today</div>
          <div className="kpi-value mt-1.5">₹4.2L</div>
          <div className="kpi-delta neutral mt-1.5">Target: ₹6L · 70% achieved</div>
          <div className="mt-2 w-full bg-slate-100 rounded-full h-1.5">
            <div className="h-1.5 rounded-full" style={{ width: "70%", background: "#1d4ed8" }} />
          </div>
        </div>
        <div className="card">
          <div className="kpi-label">Active Orders</div>
          <div className="kpi-value mt-1.5">44</div>
          <div className="kpi-delta neutral mt-1.5">Pipeline: ₹1.35 Cr</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f59e0b" }}>
          <div className="kpi-label">Materials at Risk</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>3</div>
          <div className="kpi-delta down mt-1.5">Reorder needed today</div>
        </div>
        <div className="card">
          <div className="kpi-label">Open Quotes</div>
          <div className="kpi-value mt-1.5">₹28.5L</div>
          <div className="kpi-delta up mt-1.5">↑ 6 active quotes</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Order pipeline mini-board */}
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <ClipboardList className="w-4 h-4 text-blue-600" />
              <h3 className="card-title mb-0">Order Pipeline</h3>
            </div>
            <Link href="/orders" className="text-xs text-blue-600 font-medium flex items-center gap-1 hover:underline">
              View all <ChevronRight className="w-3 h-3" />
            </Link>
          </div>
          <div className="grid grid-cols-4 gap-3 mb-4">
            {PIPELINE.map((s) => (
              <div key={s.label} className="text-center p-3 rounded-lg border border-slate-100">
                <div className="text-2xl font-black" style={{ color: s.color }}>{s.count}</div>
                <div className="text-xs text-slate-500 mt-1">{s.label}</div>
              </div>
            ))}
          </div>
          <div>
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Urgent Orders</div>
            {TOP_ORDERS.map((o) => (
              <div key={o.id} className={`flex items-center gap-3 py-2 border-b border-slate-50 last:border-0`}>
                <span className="font-mono text-xs text-blue-600 font-semibold w-20">{o.id}</span>
                <span className="flex-1 text-sm text-slate-700">{o.client}</span>
                <span className="text-sm font-semibold text-slate-700">{o.value}</span>
                <span className={`text-xs font-medium ${o.urgent ? "text-red-600" : "text-slate-500"}`}>Due {o.due}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Alerts */}
        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="card-title mb-0">Bottleneck Alerts</h3>
            </div>
            <div className="space-y-2">
              <div className="alert-card error">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-red-700">Teak Veneer — Out of Stock</div>
                  <div className="text-xs text-red-500">2 orders at risk · ETA: 4 Jun</div>
                </div>
              </div>
              <div className="alert-card warning">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div>
                  <div className="text-sm font-semibold text-amber-700">Wood Finishing Backlog</div>
                  <div className="text-xs text-amber-600">8 orders pending · 2-day delay</div>
                </div>
              </div>
            </div>
          </div>

          {/* Quick links */}
          <div className="card" style={{ background: "#1d4ed8" }}>
            <div className="text-xs text-blue-200 uppercase tracking-wider mb-2">Quick Actions</div>
            <div className="space-y-2">
              <Link href="/quotes" className="flex items-center gap-2 text-sm text-blue-100 hover:text-white transition-colors">
                <Calculator className="w-4 h-4" /> New Quote
              </Link>
              <Link href="/ai-brain" className="flex items-center gap-2 text-sm text-blue-100 hover:text-white transition-colors">
                <Brain className="w-4 h-4" /> Ask AI Brain
              </Link>
              <Link href="/automations" className="flex items-center gap-2 text-sm text-blue-100 hover:text-white transition-colors">
                <Zap className="w-4 h-4" /> Automations
              </Link>
            </div>
          </div>
        </div>
      </div>

      {/* Monthly revenue progress */}
      <div className="card">
        <h3 className="card-title mb-3">Monthly Revenue Progress — May 2026</h3>
        <div className="flex items-end gap-3" style={{ height: 80 }}>
          {[
            { week: "Wk 1", pct: 22, val: "₹22L" }, { week: "Wk 2", pct: 48, val: "₹26L" },
            { week: "Wk 3", pct: 68, val: "₹20L" }, { week: "Wk 4 (live)", pct: 78, val: "₹10L" }
          ].map((w) => (
            <div key={w.week} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-semibold text-slate-600">{w.val}</span>
              <div className="w-full rounded-t-sm" style={{ height: `${(w.pct / 100) * 55}px`, background: w.week.includes("live") ? "#1d4ed8" : "#bfdbfe", minHeight: 6 }} />
              <span className="text-xs text-slate-500">{w.week}</span>
            </div>
          ))}
        </div>
        <div className="mt-3 flex items-center gap-2">
          <div className="flex-1 bg-slate-100 rounded-full h-2">
            <div className="h-2 rounded-full" style={{ width: "78%", background: "#1d4ed8" }} />
          </div>
          <span className="text-sm font-semibold text-slate-700">₹78L / ₹1 Cr target <span className="text-slate-500">(78%)</span></span>
        </div>
      </div>
    </div>
  );
}
