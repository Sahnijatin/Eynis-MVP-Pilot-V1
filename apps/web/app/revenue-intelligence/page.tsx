"use client";

import { useState } from "react";
import { AlertTriangle, Calendar, X } from "lucide-react";
import { RevenueBarChart, DonutChart } from "../../components/ui/charts";

type Range = "30d" | "quarter" | "custom";

const RANGE_DATA = {
  "30d": {
    totalUpsell: 234500, acceptedOffers: 42, sentOffers: 118, lateCheckout: 48000, fnb: 112000, leftOnTable: 78200,
    barData: [
      { day: "Mon", upgrades: 800, lateCO: 300, fnb: 400 },
      { day: "Tue", upgrades: 1000, lateCO: 380, fnb: 520 },
      { day: "Wed", upgrades: 1200, lateCO: 460, fnb: 640 },
      { day: "Thu", upgrades: 1400, lateCO: 540, fnb: 760 },
      { day: "Fri", upgrades: 1600, lateCO: 620, fnb: 880 },
      { day: "Sat", upgrades: 1800, lateCO: 700, fnb: 1000 },
      { day: "Sun", upgrades: 2000, lateCO: 780, fnb: 1120 }
    ],
    funnel: { triggered: 12402, sent: 10540, opened: 6324, accepted: 2213, revenueInr: 420000 }
  },
  "quarter": {
    totalUpsell: 842000, acceptedOffers: 148, sentOffers: 420, lateCheckout: 162000, fnb: 398000, leftOnTable: 284000,
    barData: [
      { day: "Feb", upgrades: 28000, lateCO: 10000, fnb: 15000 },
      { day: "Mar", upgrades: 34000, lateCO: 12500, fnb: 19000 },
      { day: "Apr", upgrades: 41000, lateCO: 15000, fnb: 24000 },
      { day: "May", upgrades: 52000, lateCO: 19000, fnb: 31000 }
    ],
    funnel: { triggered: 44800, sent: 38200, opened: 22900, accepted: 8012, revenueInr: 1520000 }
  }
};

const staticTopOffers = [
  { label: "Luxury Suite Upgrade", cr: 42, good: true },
  { label: "Executive Airport Transfer", cr: 40, good: true },
  { label: "Candlelight Terrace Dinner", cr: 38, good: true },
  { label: "Signature Spa Therapy", cr: 36, good: true },
  { label: "4PM Late Checkout", cr: 22, good: false },
  { label: "Complimentary Mini-Bar", cr: 18, good: false },
  { label: "Anniversary Decoration", cr: 45, good: true },
  { label: "Private Yoga Session", cr: 12, good: false }
];

const segmentData = [
  { name: "Business (45%)", value: 45, color: "#0f766e" },
  { name: "Families (25%)", value: 25, color: "#14b8a6" },
  { name: "Couples (20%)", value: 20, color: "#f59e0b" },
  { name: "Solo (10%)", value: 10, color: "#e2e8f0" }
];

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

export default function RevenueIntelligencePage() {
  const [range, setRange] = useState<Range>("30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customApplied, setCustomApplied] = useState(false);

  const d = RANGE_DATA[range === "custom" ? (customApplied ? "30d" : "30d") : range];
  const convRate = ((d.acceptedOffers / d.sentOffers) * 100).toFixed(1);

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Revenue Intelligence</h1>
            <p className="page-subtitle">Track every rupee captured by Eynis automations</p>
          </div>
          <div className="flex items-center gap-2">
            <RangeBtn active={range === "30d"} onClick={() => setRange("30d")}>Last 30 Days</RangeBtn>
            <RangeBtn active={range === "quarter"} onClick={() => setRange("quarter")}>Last Quarter</RangeBtn>
            <button
              onClick={() => setRange("custom")}
              className="px-4 py-2 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
              style={range === "custom" ? { background: "#0f766e", color: "#fff" } : { border: "1px solid #e2e8f0", color: "#475569" }}
            >
              <Calendar className="w-3.5 h-3.5" /> Custom Range
            </button>
          </div>
        </div>

        {/* Custom date picker */}
        {range === "custom" && (
          <div className="flex items-center gap-3 mt-3 p-3 bg-slate-50 rounded-xl border border-slate-200">
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">From</label>
              <input type="date" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-teal-400" value={customFrom} onChange={e => setCustomFrom(e.target.value)} />
            </div>
            <div className="flex items-center gap-2">
              <label className="text-xs font-semibold text-slate-500">To</label>
              <input type="date" className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm text-slate-700 outline-none focus:border-teal-400" value={customTo} onChange={e => setCustomTo(e.target.value)} />
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
            <button onClick={() => { setRange("30d"); setCustomApplied(false); }} className="ml-auto text-slate-400 hover:text-slate-600">
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>

      {/* KPI row */}
      <div className="kpi-grid-5 mb-5">
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">Total Upsell</div>
            <span className="badge badge-green text-[10px]">+12.4%</span>
          </div>
          <div className="kpi-value mt-1.5">₹{d.totalUpsell.toLocaleString("en-IN")}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">Upgrade Conv.</div>
            <span className="badge badge-teal text-[10px]">{convRate}% CR</span>
          </div>
          <div className="kpi-value mt-1.5">{d.acceptedOffers}/{d.sentOffers}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">Late Checkout</div>
            <span className="badge badge-amber text-[10px]">+₹4,200</span>
          </div>
          <div className="kpi-value mt-1.5">₹{d.lateCheckout.toLocaleString("en-IN")}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">F&B Offers</div>
            <span className="badge badge-green text-[10px]">Active</span>
          </div>
          <div className="kpi-value mt-1.5">₹{d.fnb.toLocaleString("en-IN")}</div>
        </div>
        <div className="card" style={{ borderLeft: "3px solid #ef4444" }}>
          <div className="flex items-start justify-between">
            <div className="kpi-label text-red-500">Left on Table</div>
            <AlertTriangle className="w-4 h-4 text-red-400" />
          </div>
          <div className="kpi-value mt-1.5 text-red-600">₹{d.leftOnTable.toLocaleString("en-IN")}</div>
        </div>
      </div>

      {/* Charts */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <h3 className="card-title">Revenue by Automation Type</h3>
          <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block" />Upgrades</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-400 inline-block" />Late Checkouts</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />F&B Offers</span>
          </div>
          <RevenueBarChart data={d.barData} />
        </div>
        <div className="card">
          <h3 className="card-title">Top Converting Offers</h3>
          <div className="space-y-3">
            {staticTopOffers.slice(0, 8).map((o, i) => (
              <div key={i} className="flex items-center justify-between">
                <span className="text-sm text-slate-700">{o.label}</span>
                <span className={`text-sm font-semibold ${o.good ? "text-emerald-600" : "text-slate-400"}`}>{o.cr}% CR</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Funnel + Segment */}
      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <h3 className="card-title">Conversion Funnel</h3>
          <div className="grid grid-cols-5 gap-2 mb-6">
            {[
              { label: "TRIGGERS", value: d.funnel.triggered.toLocaleString() },
              { label: "SENT", value: d.funnel.sent.toLocaleString() },
              { label: "OPENED", value: d.funnel.opened.toLocaleString() },
              { label: "ACCEPTED", value: d.funnel.accepted.toLocaleString() },
              { label: "REVENUE", value: `₹${(d.funnel.revenueInr / 100000).toFixed(1)}L` }
            ].map((f) => (
              <div key={f.label} className="text-center p-4 rounded-lg bg-teal-50 border border-teal-100">
                <div className="text-[10px] font-semibold text-teal-600 uppercase tracking-wider mb-1">{f.label}</div>
                <div className="text-xl font-bold text-slate-800">{f.value}</div>
              </div>
            ))}
          </div>
          <h3 className="card-title">Best Performing Time Slots</h3>
          <div className="space-y-2">
            {["8 AM", "12 PM", "4 PM", "8 PM"].map((t, i) => (
              <div key={t} className="flex items-center gap-3">
                <span className="text-xs text-slate-500 w-12">{t}</span>
                <div className="flex-1 progress-track">
                  <div className="progress-fill" style={{ width: `${[40, 70, 90, 60][i]}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h3 className="card-title">Revenue by Guest Segment</h3>
          <DonutChart data={segmentData} total={`₹${(d.totalUpsell / 100000).toFixed(1)}L`} label="TOTAL" />
          <div className="space-y-2 mt-2">
            {segmentData.map((s) => (
              <div key={s.name} className="flex items-center gap-1.5 text-sm">
                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: s.color }} />
                {s.name}
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
