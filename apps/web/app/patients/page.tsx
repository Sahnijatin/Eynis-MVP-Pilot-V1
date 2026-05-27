import { Users, AlertCircle, Clock } from "lucide-react";

export const dynamic = "force-dynamic";

const PATIENTS = [
  { name: "Rahul Sharma", age: 42, condition: "Hypertension", lastVisit: "26 May 2025", nextAppt: "9 Jun 2025", visits: 8, status: "active" },
  { name: "Priya Mehta", age: 34, condition: "Thyroid (Follow-up)", lastVisit: "26 May 2025", nextAppt: "23 Jun 2025", visits: 5, status: "active" },
  { name: "Arun Kumar", age: 58, condition: "Cardiac Monitoring", lastVisit: "14 Apr 2025", nextAppt: "26 May 2025", visits: 14, status: "overdue" },
  { name: "Sunita Gupta", age: 29, condition: "Pregnancy (28wk)", lastVisit: "22 May 2025", nextAppt: "5 Jun 2025", visits: 6, status: "active" },
  { name: "Vikram Joshi", age: 51, condition: "Annual Check-up", lastVisit: "2 Feb 2025", nextAppt: "26 May 2025", visits: 3, status: "due" },
  { name: "Amit Kumar", age: 38, condition: "Diabetes Management", lastVisit: "10 Mar 2025", nextAppt: "—", visits: 11, status: "lost_follow_up" }
];

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    active: { label: "Active", color: "#059669", bg: "#d1fae5" },
    overdue: { label: "Overdue", color: "#dc2626", bg: "#fee2e2" },
    due: { label: "Due Today", color: "#d97706", bg: "#fef3c7" },
    lost_follow_up: { label: "Lost Follow-up", color: "#7c3aed", bg: "#f5f3ff" }
  };
  const s = map[status] ?? map.active;
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

export default function PatientsPage() {
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Patient Records</h1>
          <p className="text-sm text-slate-500 mt-0.5">Patient history · follow-up tracking · condition management</p>
        </div>
        <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#0891b2" }}>+ Register Patient</button>
      </div>
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Total Patients</div>
          <div className="kpi-value mt-1.5">{PATIENTS.length}</div>
          <div className="kpi-delta neutral mt-1.5">+2 new this week</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f43f5e" }}>
          <div className="kpi-label">Overdue / Lost</div>
          <div className="kpi-value mt-1.5" style={{ color: "#dc2626" }}>{PATIENTS.filter(p => ["overdue", "lost_follow_up"].includes(p.status)).length}</div>
          <div className="kpi-delta down mt-1.5">Needs follow-up call</div>
        </div>
        <div className="card">
          <div className="kpi-label">Due Today</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>{PATIENTS.filter(p => p.status === "due").length}</div>
          <div className="kpi-delta neutral mt-1.5">Remind via WhatsApp</div>
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Visits / Patient</div>
          <div className="kpi-value mt-1.5">{Math.round(PATIENTS.reduce((s, p) => s + p.visits, 0) / PATIENTS.length)}</div>
          <div className="kpi-delta up mt-1.5">Strong retention</div>
        </div>
      </div>
      <div className="card">
        <h3 className="card-title mb-4">Patient Directory</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {["Patient", "Age", "Condition", "Last Visit", "Next Appointment", "Visits", "Status"].map(h => (
                <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {PATIENTS.map((p, i) => (
              <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${p.status === "lost_follow_up" ? "bg-purple-50" : p.status === "overdue" ? "bg-red-50" : ""}`}>
                <td className="py-2.5 px-2 font-semibold text-slate-800">{p.name}</td>
                <td className="py-2.5 px-2 text-slate-500">{p.age}</td>
                <td className="py-2.5 px-2 text-slate-600 text-xs">{p.condition}</td>
                <td className="py-2.5 px-2 text-xs text-slate-500">{p.lastVisit}</td>
                <td className="py-2.5 px-2 text-xs font-medium text-slate-700">{p.nextAppt}</td>
                <td className="py-2.5 px-2 text-slate-600">{p.visits}</td>
                <td className="py-2.5 px-2"><StatusBadge status={p.status} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
