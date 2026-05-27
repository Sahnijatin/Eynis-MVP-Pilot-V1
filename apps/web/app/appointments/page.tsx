import { CalendarDays, Clock, UserCheck, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const TODAY_SLOTS = [
  { time: "09:00 AM", patient: "Rahul Sharma", type: "Consultation", doctor: "Dr. Patel", status: "checked_in", duration: "30 min" },
  { time: "09:30 AM", patient: "Priya Mehta", type: "Follow-up", doctor: "Dr. Patel", status: "in_progress", duration: "20 min" },
  { time: "10:00 AM", patient: "Arun Kumar", type: "ECG + Review", doctor: "Dr. Singh", status: "waiting", duration: "45 min" },
  { time: "10:30 AM", patient: "Sunita Gupta", type: "Consultation", doctor: "Dr. Patel", status: "confirmed", duration: "30 min" },
  { time: "11:00 AM", patient: "BLOCKED", type: "—", doctor: "Dr. Patel", status: "blocked", duration: "30 min" },
  { time: "11:30 AM", patient: "Vikram Joshi", type: "Annual Check-up", doctor: "Dr. Singh", status: "confirmed", duration: "60 min" },
  { time: "02:00 PM", patient: "Anita Rao", type: "Diagnosis Review", doctor: "Dr. Patel", status: "confirmed", duration: "20 min" },
  { time: "03:00 PM", patient: "No Show — Amit K.", type: "Consultation", doctor: "Dr. Singh", status: "no_show", duration: "30 min" }
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    checked_in: { label: "Checked In", color: "#059669", bg: "#d1fae5" },
    in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#eff6ff" },
    waiting: { label: "Waiting", color: "#d97706", bg: "#fef3c7" },
    confirmed: { label: "Confirmed", color: "#64748b", bg: "#f1f5f9" },
    blocked: { label: "Blocked", color: "#94a3b8", bg: "#f8fafc" },
    no_show: { label: "No Show", color: "#dc2626", bg: "#fee2e2" }
  };
  const s = map[status] ?? map.confirmed;
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

export default function AppointmentsPage() {
  const active = TODAY_SLOTS.filter(s => ["checked_in", "in_progress", "waiting"].includes(s.status)).length;
  const noShows = TODAY_SLOTS.filter(s => s.status === "no_show").length;
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Appointments</h1>
          <p className="text-sm text-slate-500 mt-0.5">Today's schedule · patient flow · no-show tracking</p>
        </div>
        <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#0891b2" }}>+ Book Appointment</button>
      </div>
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Today's Appointments</div>
          <div className="kpi-value mt-1.5">{TODAY_SLOTS.filter(s => s.status !== "blocked").length}</div>
          <div className="kpi-delta neutral mt-1.5">{active} active now</div>
        </div>
        <div className="card">
          <div className="kpi-label">Waiting Room</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>{TODAY_SLOTS.filter(s => s.status === "waiting").length}</div>
          <div className="kpi-delta down mt-1.5">Avg. wait: 12 min</div>
        </div>
        <div className="card">
          <div className="kpi-label">Completed Today</div>
          <div className="kpi-value mt-1.5">4</div>
          <div className="kpi-delta up mt-1.5">On schedule</div>
        </div>
        <div className="card" style={{ borderTop: noShows > 0 ? "3px solid #f43f5e" : undefined }}>
          <div className="kpi-label">No-Shows</div>
          <div className="kpi-value mt-1.5" style={{ color: noShows > 0 ? "#dc2626" : "#059669" }}>{noShows}</div>
          <div className="kpi-delta down mt-1.5">Follow-up needed</div>
        </div>
      </div>
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <CalendarDays className="w-4 h-4 text-cyan-600" />
          <h3 className="card-title mb-0">Today's Schedule — {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" })}</h3>
        </div>
        <div className="space-y-2">
          {TODAY_SLOTS.map((slot, i) => (
            <div key={i} className={`flex items-center gap-4 p-3 rounded-lg border ${slot.status === "in_progress" ? "border-blue-200 bg-blue-50" : slot.status === "no_show" ? "border-red-100 bg-red-50" : slot.status === "blocked" ? "border-slate-100 bg-slate-50" : "border-slate-100 hover:bg-slate-50"} transition-colors`}>
              <span className="text-sm font-mono font-semibold text-slate-500 w-20 shrink-0">{slot.time}</span>
              <div className="flex-1">
                <div className="font-medium text-slate-800">{slot.patient}</div>
                <div className="text-xs text-slate-400">{slot.type} · {slot.doctor} · {slot.duration}</div>
              </div>
              <StatusBadge status={slot.status} />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
