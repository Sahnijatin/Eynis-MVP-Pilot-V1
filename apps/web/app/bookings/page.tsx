import { Plane, Users, DollarSign, AlertCircle } from "lucide-react";

export const dynamic = "force-dynamic";

const BOOKINGS = [
  { id: "BKG-1042", client: "Arora Family", destination: "Maldives — 7N/8D", value: "₹4,80,000", departure: "10 Jun 2025", pax: 4, stage: "confirmed", paid: "100%" },
  { id: "BKG-1039", client: "Mehta Corp", destination: "Singapore Business Trip", value: "₹1,20,000", departure: "3 Jun 2025", pax: 2, stage: "pending_visa", paid: "50%" },
  { id: "BKG-1044", client: "Sharma Wedding Group", destination: "Bali — 5N/6D × 20 Pax", value: "₹18,00,000", departure: "22 Jun 2025", pax: 20, stage: "in_progress", paid: "30%" },
  { id: "BKG-1038", client: "Gupta Family", destination: "Europe 12N Rail Tour", value: "₹9,60,000", departure: "1 Jul 2025", pax: 3, stage: "confirmed", paid: "100%" },
  { id: "BKG-1046", client: "IT Company Offsite", destination: "Coorg — 2N/3D", value: "₹3,60,000", departure: "7 Jun 2025", pax: 15, stage: "urgent", paid: "0%" }
];

function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    confirmed: { label: "Confirmed", color: "#059669", bg: "#d1fae5" },
    pending_visa: { label: "Visa Pending", color: "#d97706", bg: "#fef3c7" },
    in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#eff6ff" },
    urgent: { label: "Action Needed", color: "#dc2626", bg: "#fee2e2" }
  };
  const s = map[stage] ?? map.confirmed;
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

export default function BookingsPage() {
  const totalPipeline = "₹37.2L";
  const confirmed = BOOKINGS.filter(b => b.stage === "confirmed").length;
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Booking Pipeline</h1>
          <p className="text-sm text-slate-500 mt-0.5">Active bookings · visa tracking · payment status</p>
        </div>
        <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#7c3aed" }}>+ New Booking</button>
      </div>
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Pipeline Value</div>
          <div className="kpi-value mt-1.5">{totalPipeline}</div>
          <div className="kpi-delta up mt-1.5">↑ +18% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Active Bookings</div>
          <div className="kpi-value mt-1.5">{BOOKINGS.length}</div>
          <div className="kpi-delta neutral mt-1.5">{confirmed} confirmed</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Pax</div>
          <div className="kpi-value mt-1.5">{BOOKINGS.reduce((s, b) => s + b.pax, 0)}</div>
          <div className="kpi-delta neutral mt-1.5">Across all bookings</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f59e0b" }}>
          <div className="kpi-label">Needs Attention</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>{BOOKINGS.filter(b => ["urgent", "pending_visa"].includes(b.stage)).length}</div>
          <div className="kpi-delta down mt-1.5">Action required today</div>
        </div>
      </div>
      <div className="card">
        <h3 className="card-title mb-4">All Bookings</h3>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {["Booking ID", "Client", "Destination", "Value", "Departure", "Pax", "Paid", "Status"].map(h => (
                <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {BOOKINGS.map((b, i) => (
              <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 ${b.stage === "urgent" ? "bg-red-50" : ""}`}>
                <td className="py-2.5 px-2 font-mono text-xs text-purple-600 font-semibold">{b.id}</td>
                <td className="py-2.5 px-2 font-medium text-slate-800">{b.client}</td>
                <td className="py-2.5 px-2 text-slate-600 text-xs">{b.destination}</td>
                <td className="py-2.5 px-2 font-semibold">{b.value}</td>
                <td className="py-2.5 px-2 text-sm text-slate-500">{b.departure}</td>
                <td className="py-2.5 px-2 text-slate-600">{b.pax}</td>
                <td className="py-2.5 px-2">
                  <span className={`font-semibold ${b.paid === "100%" ? "text-emerald-600" : b.paid === "0%" ? "text-red-600" : "text-amber-600"}`}>{b.paid}</span>
                </td>
                <td className="py-2.5 px-2"><StageBadge stage={b.stage} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
