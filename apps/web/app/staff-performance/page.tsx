"use client";

import { useState } from "react";
import { AlertTriangle, AlertCircle, Download, Calendar, X } from "lucide-react";
import { EfficiencyChart } from "../../components/ui/charts";

type Range = "24h" | "7d" | "custom";

const roleLabel: Record<string, string> = {
  owner: "Management",
  front_desk: "Concierge",
  housekeeping: "Housekeeping",
  fnb_manager: "F&B"
};

const deptColors: Record<string, string> = {
  housekeeping: "#0f766e",
  front_desk: "#3b82f6",
  fnb_manager: "#f59e0b",
  owner: "#8b5cf6"
};

const resolutionLog = [
  { time: "14:22 PM", staff: "Sarah Jenkins", room: "Suite 402",  type: "Champagne Service",  duration: "04m 15s", feedback: "Exceptionally prompt and professional." },
  { time: "14:10 PM", staff: "David Ling",    room: "Room 112",   type: "HVAC Repair",         duration: "22m 30s", feedback: "Fixed the issue quickly. Very polite." },
  { time: "13:55 PM", staff: "Elena Rodriguez", room: "Penthouse B", type: "Turndown Service", duration: "18m 05s", feedback: "Attention to detail was incredible." }
];

const workload = [
  { role: "housekeeping", openTasks: 15, resolvedTasks: 145 },
  { role: "fnb_manager",  openTasks: 6,  resolvedTasks: 28  },
  { role: "front_desk",   openTasks: 0,  resolvedTasks: 92  },
  { role: "owner",        openTasks: 4,  resolvedTasks: 47  }
];

const RANGE_DATA = {
  "24h": {
    summary: { avgResolutionMinutes: 14.3, completionRate: 0.94, avgGuestRating: 4.82, utilizationRate: 0.78 },
    efficiencyData: [
      { day: "8 AM",  minutes: 18 }, { day: "10 AM", minutes: 15 }, { day: "12 PM", minutes: 22 },
      { day: "2 PM",  minutes: 14 }, { day: "4 PM",  minutes: 16 }, { day: "6 PM",  minutes: 20 },
      { day: "8 PM",  minutes: 17 }, { day: "10 PM", minutes: 13 }
    ],
    efficiencyLabel: "Resolution time (minutes) last 24h",
    leaderboard: [
      { name: "Sarah Jenkins", dept: "Concierge",   tasks: 14, avgRes: "06m 40s", rating: 4.98, bonus: 140 },
      { name: "David Ling",    dept: "F&B",          tasks: 12, avgRes: "10m 20s", rating: 4.92, bonus: 110 },
      { name: "Elena Rodriguez", dept: "Housekeeping", tasks: 18, avgRes: "13m 10s", rating: 4.88, bonus: 85 },
      { name: "Thomas Wright", dept: "Front Desk",   tasks: 11, avgRes: "05m 30s", rating: 4.85, bonus: 50 }
    ]
  },
  "7d": {
    summary: { avgResolutionMinutes: 16.8, completionRate: 0.91, avgGuestRating: 4.75, utilizationRate: 0.82 },
    efficiencyData: [
      { day: "Mon", minutes: 22 }, { day: "Tue", minutes: 19 }, { day: "Wed", minutes: 17 },
      { day: "Thu", minutes: 20 }, { day: "Fri", minutes: 15 }, { day: "Sat", minutes: 14 }, { day: "Sun", minutes: 16 }
    ],
    efficiencyLabel: "Resolution time (minutes) last 7 days",
    leaderboard: [
      { name: "Sarah Jenkins",   dept: "Concierge",    tasks: 48, avgRes: "08m 12s", rating: 4.98, bonus: 450 },
      { name: "David Ling",      dept: "F&B",           tasks: 42, avgRes: "12m 45s", rating: 4.92, bonus: 320 },
      { name: "Elena Rodriguez", dept: "Housekeeping",  tasks: 64, avgRes: "15m 30s", rating: 4.88, bonus: 280 },
      { name: "Thomas Wright",   dept: "Front Desk",    tasks: 38, avgRes: "06m 50s", rating: 4.85, bonus: 150 }
    ]
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

export default function StaffPerformancePage() {
  const [range, setRange] = useState<Range>("7d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const [customApplied, setCustomApplied] = useState(false);

  const d = RANGE_DATA[range === "custom" ? "7d" : range];
  const { summary, efficiencyData, efficiencyLabel, leaderboard } = d;

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Staff Performance</h1>
            <p className="page-subtitle">Track team efficiency and guest satisfaction metrics in real-time.</p>
          </div>
          <div className="flex items-center gap-2">
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
          <div className="kpi-label">Avg. Resolution Time</div>
          <div className="kpi-value mt-1.5">{Math.floor(summary.avgResolutionMinutes)}m {Math.round((summary.avgResolutionMinutes % 1) * 60)}s</div>
          <div className="kpi-delta up mt-1">↓ 2m vs prev period</div>
        </div>
        <div className="card">
          <div className="kpi-label">Task Completion Rate</div>
          <div className="kpi-value mt-1.5">{(summary.completionRate * 100).toFixed(1)}%</div>
          <div className="mt-2 progress-track"><div className="progress-fill" style={{ width: `${summary.completionRate * 100}%` }} /></div>
          <div className="text-xs text-slate-400 mt-1">312 / 331 tasks completed</div>
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Guest Rating</div>
          <div className="kpi-value mt-1.5">{summary.avgGuestRating.toFixed(1)}/5</div>
          <div className="flex gap-0.5 mt-2">
            {Array.from({ length: 5 }, (_, i) => (
              <span key={i} className={i < Math.round(summary.avgGuestRating) ? "text-amber-400 text-base" : "text-slate-200 text-base"}>★</span>
            ))}
          </div>
          <div className="text-xs text-slate-400 mt-1">88 reviews</div>
        </div>
        <div className="card">
          <div className="kpi-label">Staff Utilization</div>
          <div className="kpi-value mt-1.5">{Math.round(summary.utilizationRate * 100)}%</div>
          <div className="text-xs text-emerald-500 mt-1 font-medium flex items-center gap-1">● LIVE SYNCING</div>
          <div className="text-xs text-slate-400">Active vs available staff</div>
        </div>
      </div>

      {/* Leaderboard + Efficiency */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title mb-0">Performance Leaderboard</h3>
            <button className="text-sm font-medium flex items-center gap-1" style={{ color: "var(--color-teal)" }}>View Full Report →</button>
          </div>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Staff Name</th>
                  <th>Department</th>
                  <th>Tasks</th>
                  <th>Avg. Res.</th>
                  <th>Rating</th>
                  <th>Bonus</th>
                </tr>
              </thead>
              <tbody>
                {leaderboard.map((s, i) => (
                  <tr key={s.name}>
                    <td><span className="w-6 h-6 rounded-full bg-amber-100 text-amber-700 text-xs font-bold flex items-center justify-center">{i + 1}</span></td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-teal-700 flex items-center justify-center text-white text-[10px] font-semibold">
                          {s.name.split(" ").map(w => w[0]).join("")}
                        </span>
                        <span className="font-medium text-slate-800 text-sm">{s.name}</span>
                      </span>
                    </td>
                    <td className="text-slate-500 text-sm">{s.dept}</td>
                    <td className="font-semibold text-slate-800">{s.tasks}</td>
                    <td className="font-mono text-sm text-slate-600">{s.avgRes}</td>
                    <td>
                      <span className="flex items-center gap-1">
                        <span className="text-amber-400">★</span>
                        <span className="text-sm font-semibold text-slate-700">{s.rating.toFixed(2)}</span>
                      </span>
                    </td>
                    <td className="text-emerald-600 font-semibold text-sm">+₹{s.bonus}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <h3 className="card-title">Efficiency Trends</h3>
            <p className="text-xs text-slate-400 -mt-2 mb-2">{efficiencyLabel}</p>
            <EfficiencyChart data={efficiencyData} />
          </div>

          <div className="card">
            <h3 className="card-title">Top Rated Team</h3>
            <div className="space-y-3">
              {[
                { name: "Isabella Chen", dept: "Front Desk", rating: 5.0 },
                { name: "Julian S.",     dept: "Concierge",  rating: 4.9 }
              ].map((p) => (
                <div key={p.name} className="flex items-center gap-2">
                  <span className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-semibold">
                    {p.name.split(" ").map(w => w[0]).join("")}
                  </span>
                  <div className="flex-1">
                    <div className="text-sm font-medium text-slate-800">{p.name}</div>
                    <div className="text-xs text-slate-400">{p.dept} • {p.rating.toFixed(1)} Rating</div>
                  </div>
                  <div className="flex gap-0.5">
                    {[1, 2, 3].map(j => <span key={j} className="text-amber-400 text-xs">★</span>)}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Staffing Alerts</h3>
            <div className="space-y-2">
              <div className="alert-card warning">
                <AlertTriangle className="w-4 h-4 text-amber-500 shrink-0 mt-0.5" />
                <div><div className="text-sm font-semibold text-amber-700">Housekeeping Overload</div><div className="text-xs text-amber-600">High volume in North Wing. Consider reassigning staff.</div></div>
              </div>
              <div className="alert-card error">
                <AlertCircle className="w-4 h-4 text-red-500 shrink-0 mt-0.5" />
                <div><div className="text-sm font-semibold text-red-700">Maintenance Critical</div><div className="text-xs text-red-500">Only 2 staff available for 12 pending emergency requests.</div></div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Workload */}
      <div className="card mb-4">
        <h3 className="card-title">Workload by Department</h3>
        <div className="space-y-3">
          {workload.map((w) => {
            const total = w.openTasks + w.resolvedTasks;
            const resolvedPct = total > 0 ? (w.resolvedTasks / total) * 100 : 0;
            const openPct    = total > 0 ? (w.openTasks    / total) * 100 : 0;
            const label = roleLabel[w.role] ?? w.role;
            return (
              <div key={w.role}>
                <div className="flex justify-between mb-1.5">
                  <span className="text-sm font-medium text-slate-700">{label}</span>
                  <span className="text-xs text-slate-500">{w.resolvedTasks} / {total} Tasks</span>
                </div>
                <div className="w-full h-2.5 rounded-full bg-slate-100 overflow-hidden flex">
                  <div className="h-full rounded-full" style={{ width: `${resolvedPct}%`, background: deptColors[w.role] ?? "#0f766e" }} />
                  <div className="h-full" style={{ width: `${openPct}%`, background: "#e2e8f0" }} />
                </div>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 mt-3 text-xs text-slate-500">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-teal-700 inline-block" />Completed Tasks</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-slate-200 inline-block" />Open / Pending</span>
        </div>
      </div>

      {/* Resolution Log */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="card-title mb-0">Detailed Resolution Log</h3>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </button>
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Filter</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Timestamp</th>
                <th>Staff Member</th>
                <th>Room</th>
                <th>Task Type</th>
                <th>Duration</th>
                <th>Guest Feedback</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {resolutionLog.map((r, i) => (
                <tr key={i}>
                  <td className="text-slate-500 text-sm">{r.time}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <span className="w-6 h-6 rounded-full bg-teal-700 flex items-center justify-center text-white text-[10px] font-semibold">
                        {r.staff.split(" ").map(w => w[0]).join("")}
                      </span>
                      <span className="text-sm font-medium">{r.staff}</span>
                    </span>
                  </td>
                  <td className="font-medium text-slate-700">{r.room}</td>
                  <td><span className="badge badge-slate">{r.type}</span></td>
                  <td className="font-mono text-sm text-slate-600">{r.duration}</td>
                  <td className="text-slate-500 text-sm italic max-w-xs truncate">&quot;{r.feedback}&quot;</td>
                  <td><button className="text-sm font-medium" style={{ color: "var(--color-teal)" }}>View Details</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
