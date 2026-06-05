import Link from "next/link";
import { Plane, Users, TrendingUp, ChevronRight } from "lucide-react";
import { SmartInsights } from "./smart-insights";

export function TravelDashboard() {
  return (
    <div>
      <SmartInsights industry="travel" />
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Revenue This Month</div>
          <div className="kpi-value mt-1.5">₹37.2L</div>
          <div className="kpi-delta up mt-1.5">↑ +18% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Active Bookings</div>
          <div className="kpi-value mt-1.5">5</div>
          <div className="kpi-delta neutral mt-1.5">₹37.2L in pipeline</div>
        </div>
        <div className="card">
          <div className="kpi-label">Departures This Week</div>
          <div className="kpi-value mt-1.5">2</div>
          <div className="kpi-delta neutral mt-1.5">44 total pax</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f43f5e" }}>
          <div className="kpi-label">Action Needed</div>
          <div className="kpi-value mt-1.5" style={{ color: "#dc2626" }}>2</div>
          <div className="kpi-delta down mt-1.5">Visa pending + unpaid</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><Plane className="w-4 h-4 text-purple-600" /><h3 className="card-title mb-0">Upcoming Departures</h3></div>
            <Link href="/bookings" className="text-xs text-purple-600 font-medium flex items-center gap-1 hover:underline">View all <ChevronRight className="w-3 h-3" /></Link>
          </div>
          <div className="space-y-2">
            {[
              { client: "IT Company Offsite", dest: "Coorg — 2N/3D × 15 Pax", date: "7 Jun", status: "Action Needed", color: "#dc2626", bg: "#fee2e2" },
              { client: "Mehta Corp", dest: "Singapore × 2 Pax", date: "3 Jun", status: "Visa Pending", color: "#d97706", bg: "#fef3c7" },
              { client: "Arora Family", dest: "Maldives × 4 Pax", date: "10 Jun", status: "Confirmed", color: "#059669", bg: "#d1fae5" }
            ].map((b, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg border border-slate-100">
                <Plane className="w-4 h-4 text-purple-400 shrink-0" />
                <div className="flex-1">
                  <div className="font-medium text-sm text-slate-800">{b.client}</div>
                  <div className="text-xs text-slate-400">{b.dest}</div>
                </div>
                <span className="text-xs font-medium text-slate-500">{b.date}</span>
                <span className="badge text-xs" style={{ background: b.bg, color: b.color }}>{b.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-purple-500" /><h3 className="card-title mb-0">Revenue by Type</h3></div>
          {[{ label: "Leisure", pct: 62, val: "₹23.1L" }, { label: "Corporate", pct: 28, val: "₹10.4L" }, { label: "Group", pct: 10, val: "₹3.7L" }].map(r => (
            <div key={r.label} className="mb-3">
              <div className="flex justify-between text-sm mb-1"><span className="text-slate-600">{r.label}</span><span className="font-semibold">{r.val}</span></div>
              <div className="progress-track"><div className="progress-fill" style={{ width: `${r.pct}%`, background: "#7c3aed" }} /></div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
