import Link from "next/link";
import { CalendarDays, Users, TrendingUp, AlertCircle, ChevronRight } from "lucide-react";
import { SmartInsights } from "./smart-insights";
import { PreviewBanner } from "./preview-badge";

export function HealthcareDashboard() {
  return (
    <div>
      <PreviewBanner />
      <SmartInsights industry="healthcare" />
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Appointments Today</div>
          <div className="kpi-value mt-1.5">8</div>
          <div className="kpi-delta neutral mt-1.5">3 active now</div>
        </div>
        <div className="card">
          <div className="kpi-label">Waiting Room</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>1</div>
          <div className="kpi-delta neutral mt-1.5">Avg. wait: 12 min</div>
        </div>
        <div className="card">
          <div className="kpi-label">Today's Revenue</div>
          <div className="kpi-value mt-1.5">₹28,500</div>
          <div className="kpi-delta up mt-1.5">↑ +8% vs yesterday</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f43f5e" }}>
          <div className="kpi-label">Follow-up Overdue</div>
          <div className="kpi-value mt-1.5" style={{ color: "#dc2626" }}>2</div>
          <div className="kpi-delta down mt-1.5">Patients need callback</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><CalendarDays className="w-4 h-4 text-cyan-600" /><h3 className="card-title mb-0">Today's Schedule</h3></div>
            <Link href="/appointments" className="text-xs text-cyan-600 font-medium flex items-center gap-1 hover:underline">Full schedule <ChevronRight className="w-3 h-3" /></Link>
          </div>
          <div className="space-y-2">
            {[
              { time: "09:00", patient: "Rahul Sharma", type: "Hypertension Check", status: "checked_in", color: "#059669", bg: "#d1fae5" },
              { time: "09:30", patient: "Priya Mehta", type: "Thyroid Follow-up", status: "in_progress", color: "#1d4ed8", bg: "#eff6ff" },
              { time: "10:00", patient: "Arun Kumar", type: "ECG + Review", status: "waiting", color: "#d97706", bg: "#fef3c7" },
              { time: "10:30", patient: "Sunita Gupta", type: "Pregnancy 28wk", status: "upcoming", color: "#64748b", bg: "#f1f5f9" }
            ].map((s, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50">
                <span className="font-mono text-xs font-semibold text-slate-500 w-14">{s.time}</span>
                <div className="flex-1">
                  <div className="font-medium text-sm text-slate-800">{s.patient}</div>
                  <div className="text-xs text-slate-500">{s.type}</div>
                </div>
                <span className="badge text-xs" style={{ background: s.bg, color: s.color }}>{s.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><AlertCircle className="w-4 h-4 text-red-500" /><h3 className="card-title mb-0">Follow-up Alerts</h3></div>
          {[
            { name: "Arun Kumar", note: "Cardiac review overdue by 6 weeks", severity: "high" },
            { name: "Amit Kumar", note: "Diabetes follow-up — 75 days no visit", severity: "high" }
          ].map((a, i) => (
            <div key={i} className="p-2.5 mb-2 rounded-lg bg-red-50 border border-red-100">
              <div className="text-sm font-semibold text-red-800">{a.name}</div>
              <div className="text-xs text-red-600 mt-0.5">{a.note}</div>
              <button disabled title="Sample data — connect your patient records to send real reminders" className="mt-1.5 text-xs font-medium px-2 py-1 rounded bg-red-50 text-red-300 cursor-not-allowed">Send reminder via WhatsApp</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
