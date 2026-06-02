"use client";

import { useState } from "react";
import { Filter, Download, MoreHorizontal, Pencil } from "lucide-react";
import { CampaignBarChart } from "../../components/ui/charts";

type Period = "today" | "week" | "month";

const PERIOD_DATA: Record<Period, { title: string; data: Array<{ day: string; executions: number; conversions: number }> }> = {
  today: {
    title: "Today's Campaign Activity",
    data: [
      { day: "8 AM",  executions: 24, conversions: 8  },
      { day: "10 AM", executions: 38, conversions: 14 },
      { day: "12 PM", executions: 52, conversions: 21 },
      { day: "2 PM",  executions: 45, conversions: 18 },
      { day: "4 PM",  executions: 61, conversions: 26 },
      { day: "6 PM",  executions: 47, conversions: 20 },
      { day: "8 PM",  executions: 33, conversions: 12 },
      { day: "10 PM", executions: 18, conversions: 6  }
    ]
  },
  week: {
    title: "Weekly Campaign Activity",
    data: [
      { day: "Mon", executions: 142, conversions: 48 },
      { day: "Tue", executions: 168, conversions: 57 },
      { day: "Wed", executions: 195, conversions: 68 },
      { day: "Thu", executions: 178, conversions: 62 },
      { day: "Fri", executions: 224, conversions: 81 },
      { day: "Sat", executions: 256, conversions: 94 },
      { day: "Sun", executions: 211, conversions: 76 }
    ]
  },
  month: {
    title: "Monthly Campaign Activity",
    data: [
      { day: "Wk 1", executions: 824,  conversions: 292 },
      { day: "Wk 2", executions: 968,  conversions: 342 },
      { day: "Wk 3", executions: 1124, conversions: 408 },
      { day: "Wk 4", executions: 1042, conversions: 374 }
    ]
  }
};

const CAMPAIGNS = [
  { id: "c1", name: "Pre-Arrival Upgrade Offer",  trigger: "48h before check-in",    status: "Active", recipients: 1240, conversionRate: 34.2, revenueInr: 82400 },
  { id: "c2", name: "Late Checkout Upsell",        trigger: "Morning of check-out",    status: "Active", recipients: 890,  conversionRate: 28.6, revenueInr: 44500 },
  { id: "c3", name: "F&B In-Room Dining Push",     trigger: "Post check-in (2h)",      status: "Active", recipients: 2100, conversionRate: 22.1, revenueInr: 63000 },
  { id: "c4", name: "Spa Package Bundle",           trigger: "3-night stay trigger",    status: "Paused", recipients: 540,  conversionRate: 18.4, revenueInr: 29200 },
  { id: "c5", name: "Airport Transfer Add-on",      trigger: "Check-in confirmation",   status: "Active", recipients: 1680, conversionRate: 31.0, revenueInr: 50400 }
];

function PeriodBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
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

export default function UpsellCampaignsPage() {
  const [period, setPeriod] = useState<Period>("week");
  const { title, data } = PERIOD_DATA[period];

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Upsell Campaigns</h1>
            <p className="page-subtitle">Design and monitor campaign performance across all channels.</p>
          </div>
          <div className="flex items-center gap-2">
            <PeriodBtn active={period === "today"} onClick={() => setPeriod("today")}>Today</PeriodBtn>
            <PeriodBtn active={period === "week"}  onClick={() => setPeriod("week")}>Week</PeriodBtn>
            <PeriodBtn active={period === "month"} onClick={() => setPeriod("month")}>Month</PeriodBtn>
          </div>
        </div>
      </div>

      {/* Bar chart */}
      <div className="card mb-4">
        <h3 className="card-title">{title}</h3>
        <div className="flex items-center gap-4 text-xs text-slate-500 mb-3">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block" />Executions</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" />Conversions</span>
        </div>
        <CampaignBarChart data={data} />
      </div>

      {/* Campaign Performance Log */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="card-title mb-0">Campaign Performance Log</h3>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Filter className="w-3.5 h-3.5" /> Filter campaigns...
            </button>
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export PDF
            </button>
          </div>
        </div>

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Campaign Name</th>
                <th>Status</th>
                <th>Recipients</th>
                <th>Conversion</th>
                <th>Revenue</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {CAMPAIGNS.map((item) => (
                <tr key={item.id}>
                  <td>
                    <div className="text-sm font-semibold text-slate-800">{item.name}</div>
                    <div className="text-xs text-slate-400">Trigger: {item.trigger}</div>
                  </td>
                  <td>
                    <span className={`badge ${item.status === "Active" ? "badge-green" : "badge-amber"} flex items-center gap-1 w-fit`}>
                      <span className={`w-1.5 h-1.5 rounded-full inline-block ${item.status === "Active" ? "bg-emerald-500" : "bg-amber-500"}`} />
                      {item.status}
                    </span>
                  </td>
                  <td className="font-semibold text-slate-700">{item.recipients.toLocaleString()}</td>
                  <td>
                    <span className={`font-semibold text-sm ${item.conversionRate >= 30 ? "text-emerald-600" : "text-slate-500"}`}>
                      {item.conversionRate.toFixed(1)}%
                    </span>
                  </td>
                  <td className="font-semibold text-slate-700">₹{item.revenueInr.toLocaleString("en-IN")}</td>
                  <td>
                    <div className="flex gap-2">
                      <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
                        <MoreHorizontal className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
          <span className="text-sm text-slate-500">SHOWING {CAMPAIGNS.length} OF {CAMPAIGNS.length} CAMPAIGNS</span>
          <div className="flex items-center gap-1">
            {[1, 2, 3].map(p => (
              <button key={p} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === 1 ? "text-white" : "text-slate-600 hover:bg-slate-100"}`}
                style={p === 1 ? { background: "#0f766e" } : {}}>{p}</button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
