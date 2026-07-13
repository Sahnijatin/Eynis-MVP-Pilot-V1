"use client";

import { useState } from "react";
import { Plane } from "lucide-react";
import { ClientDetailPanel, type ClientDetailData } from "../../components/ui/client-detail-panel";
import { ImportExportButtons } from "../../components/ui/import-export-buttons";
import { Modal, TableEmpty } from "../../components/ds";
import { PreviewBanner } from "../../components/ui/preview-badge";

interface Booking {
  id: string;
  client: string;
  destination: string;
  value: string;
  departure: string;
  pax: number;
  stage: "confirmed" | "pending_visa" | "in_progress" | "urgent";
  paid: string;
}

const ACCENT = "#7c3aed";

const BOOKINGS_INIT: Booking[] = [
  { id: "BKG-1042", client: "Arora Family",          destination: "Maldives — 7N/8D",            value: "₹4,80,000",  departure: "10 Jun 2025", pax: 4,  stage: "confirmed",    paid: "100%" },
  { id: "BKG-1039", client: "Mehta Corp",            destination: "Singapore Business Trip",     value: "₹1,20,000",  departure: "3 Jun 2025",  pax: 2,  stage: "pending_visa", paid: "50%"  },
  { id: "BKG-1044", client: "Sharma Wedding Group",  destination: "Bali — 5N/6D × 20 Pax",       value: "₹18,00,000", departure: "22 Jun 2025", pax: 20, stage: "in_progress",  paid: "30%"  },
  { id: "BKG-1038", client: "Gupta Family",          destination: "Europe 12N Rail Tour",        value: "₹9,60,000",  departure: "1 Jul 2025",  pax: 3,  stage: "confirmed",    paid: "100%" },
  { id: "BKG-1046", client: "IT Company Offsite",    destination: "Coorg — 2N/3D",               value: "₹3,60,000",  departure: "7 Jun 2025",  pax: 15, stage: "urgent",       paid: "0%"   },
];

function StageBadge({ stage }: { stage: Booking["stage"] }) {
  const map: Record<Booking["stage"], { label: string; color: string; bg: string }> = {
    confirmed:    { label: "Confirmed",    color: "#059669", bg: "#d1fae5" },
    pending_visa: { label: "Visa Pending", color: "#d97706", bg: "#fef3c7" },
    in_progress:  { label: "In Progress",  color: "#1d4ed8", bg: "#eff6ff" },
    urgent:       { label: "Action Needed",color: "#dc2626", bg: "#fee2e2" },
  };
  const s = map[stage];
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function buildDetail(b: Booking): ClientDetailData {
  const paymentRows = [
    { id: "PAY-1", title: "Booking advance", subtitle: "Razorpay · UPI", amount: b.paid === "100%" ? b.value : "30%", date: "1 May 2025", status: "Paid", statusColor: "#059669", statusBg: "#d1fae5" },
  ];
  if (b.paid !== "100%") {
    paymentRows.push({ id: "PAY-2", title: "Balance due", subtitle: "Auto-reminder 7d before departure", amount: "—", date: b.departure, status: "Pending", statusColor: "#d97706", statusBg: "#fef3c7" });
  }
  return {
    historyLabel: "Itinerary & Payments",
    contact: {
      person: b.client,
      role: "Lead traveller",
      extras: [
        { label: "Booking ID", value: b.id },
        { label: "Destination", value: b.destination },
        { label: "Pax", value: String(b.pax) },
        { label: "Departure", value: b.departure },
        { label: "Total Value", value: b.value },
        { label: "Paid", value: b.paid },
      ],
    },
    history: [
      { id: b.id, title: b.destination, subtitle: `${b.pax} pax · departs ${b.departure}`, amount: b.value, date: b.departure, status: b.stage === "confirmed" ? "Confirmed" : b.stage === "urgent" ? "Action Needed" : b.stage === "pending_visa" ? "Visa Pending" : "In Progress", statusColor: b.stage === "confirmed" ? "#059669" : b.stage === "urgent" ? "#dc2626" : b.stage === "pending_visa" ? "#d97706" : "#1d4ed8", statusBg: b.stage === "confirmed" ? "#d1fae5" : b.stage === "urgent" ? "#fee2e2" : b.stage === "pending_visa" ? "#fef3c7" : "#eff6ff" },
      ...paymentRows,
    ],
    notes: b.stage === "urgent"
      ? "Departing soon and 0% paid — call the client today."
      : b.stage === "pending_visa"
      ? "Visa under processing. Track at the embassy portal and confirm 5d before departure."
      : "Booking on track. Send pre-departure checklist 3d before travel.",
  };
}

let nextId = 1047;

export default function BookingsPage() {
  const [bookings, setBookings] = useState<Booking[]>(BOOKINGS_INIT);
  const [selected, setSelected] = useState<Booking | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState({ client: "", destination: "", value: "", departure: "", pax: "1" });

  const totalPipelineInr = bookings.reduce((s, b) => s + Number(b.value.replace(/[^0-9]/g, "")), 0);
  const totalPipeline = totalPipelineInr >= 100_000 ? `₹${(totalPipelineInr / 100_000).toFixed(1)}L` : `₹${totalPipelineInr.toLocaleString("en-IN")}`;
  const confirmed = bookings.filter(b => b.stage === "confirmed").length;
  const attention = bookings.filter(b => ["urgent", "pending_visa"].includes(b.stage)).length;

  function handleCreate() {
    if (!form.client.trim() || !form.destination.trim()) return;
    const id = `BKG-${nextId++}`;
    const newBooking: Booking = {
      id,
      client: form.client.trim(),
      destination: form.destination.trim(),
      value: form.value.trim() || "₹0",
      departure: form.departure.trim() || "TBD",
      pax: Number(form.pax) || 1,
      stage: "in_progress",
      paid: "0%",
    };
    setBookings(prev => [newBooking, ...prev]);
    setModalOpen(false);
    setForm({ client: "", destination: "", value: "", departure: "", pax: "1" });
  }

  return (
    <div>
      <PreviewBanner />
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Booking Pipeline</h1>
          <p className="text-sm text-slate-500 mt-0.5">Active bookings · visa tracking · payment status — click a row for full detail</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            rows={bookings}
            columns={[
              { label: "Booking ID", value: "id" },
              { label: "Client",     value: "client" },
              { label: "Destination",value: "destination" },
              { label: "Value",      value: "value" },
              { label: "Departure",  value: "departure" },
              { label: "Pax",        value: "pax" },
              { label: "Stage",      value: "stage" },
              { label: "Paid",       value: "paid" },
            ]}
            fileBase="bookings"
            accentColor={ACCENT}
            onImport={(rows) => {
              const next: Booking[] = rows.map(r => ({
                id: r["Booking ID"] || `BKG-${nextId++}`,
                client: r["Client"] ?? "",
                destination: r["Destination"] ?? "",
                value: r["Value"] ?? "₹0",
                departure: r["Departure"] ?? "TBD",
                pax: Number(r["Pax"] ?? 1) || 1,
                stage: (["confirmed", "pending_visa", "in_progress", "urgent"].includes(r["Stage"]) ? r["Stage"] : "in_progress") as Booking["stage"],
                paid: r["Paid"] ?? "0%",
              })).filter(b => b.client);
              if (next.length) setBookings(prev => [...next, ...prev]);
              return { count: next.length };
            }}
          />
          <button onClick={() => setModalOpen(true)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: ACCENT }}>+ New Booking</button>
        </div>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Pipeline Value</div>
          <div className="kpi-value mt-1.5">{totalPipeline}</div>
          <div className="kpi-delta up mt-1.5">↑ +18% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Active Bookings</div>
          <div className="kpi-value mt-1.5">{bookings.length}</div>
          <div className="kpi-delta neutral mt-1.5">{confirmed} confirmed</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Pax</div>
          <div className="kpi-value mt-1.5">{bookings.reduce((s, b) => s + b.pax, 0)}</div>
          <div className="kpi-delta neutral mt-1.5">Across all bookings</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f59e0b" }}>
          <div className="kpi-label">Needs Attention</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>{attention}</div>
          <div className="kpi-delta down mt-1.5">Action required today</div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Plane className="w-4 h-4" style={{ color: ACCENT }} />
          <h3 className="card-title mb-0">All Bookings</h3>
          <span className="text-xs text-slate-500 font-normal ml-1">— click a booking for itinerary, payments and notes</span>
        </div>
        <div className="table-wrap">
          <table className="data-table no-row-hover">
            <thead>
              <tr>
                {["Booking ID", "Client", "Destination", "Value", "Departure", "Pax", "Paid", "Status"].map(h => (
                  <th key={h}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bookings.map(b => (
                <tr
                  key={b.id}
                  onClick={() => setSelected(b)}
                  className={`hover:bg-purple-50 transition-colors cursor-pointer ${b.stage === "urgent" ? "bg-red-50" : ""}`}
                >
                  <td className="font-mono text-xs text-purple-600 font-semibold">{b.id}</td>
                  <td className="font-medium text-slate-800">{b.client}</td>
                  <td className="text-slate-600 text-xs">{b.destination}</td>
                  <td className="font-semibold">{b.value}</td>
                  <td className="text-sm text-slate-500">{b.departure}</td>
                  <td className="text-slate-600">{b.pax}</td>
                  <td>
                    <span className={`font-semibold ${b.paid === "100%" ? "text-emerald-600" : b.paid === "0%" ? "text-red-600" : "text-amber-600"}`}>{b.paid}</span>
                  </td>
                  <td><StageBadge stage={b.stage} /></td>
                </tr>
              ))}
              {bookings.length === 0 && (
                <TableEmpty colSpan={8} icon="🧳" title="No bookings yet" description="New bookings will appear here once created or imported." />
              )}
            </tbody>
          </table>
        </div>
      </div>

      {selected && (
        <ClientDetailPanel
          open={!!selected}
          onClose={() => setSelected(null)}
          name={selected.client}
          subtitle={`${selected.destination} · ${selected.pax} pax`}
          kpis={[
            { label: "Booking Value", value: selected.value },
            { label: "Departure",     value: selected.departure },
            { label: "Paid",          value: selected.paid },
            { label: "Pax",           value: String(selected.pax) },
          ]}
          detail={buildDetail(selected)}
          accentColor={ACCENT}
        />
      )}

      {modalOpen && (
        <Modal
          title="New Booking"
          onClose={() => { setModalOpen(false); setForm({ client: "", destination: "", value: "", departure: "", pax: "1" }); }}
          footer={
            <button
              onClick={handleCreate}
              className="px-4 py-2 text-sm font-semibold text-white rounded-lg"
              style={{ background: ACCENT }}
            >
              Create Booking
            </button>
          }
        >
          <div className="space-y-3">
            {([
              ["client", "Client / Lead traveller", "Arora Family"],
              ["destination", "Destination", "Maldives — 5N/6D"],
              ["value", "Booking value", "₹4,80,000"],
              ["departure", "Departure date", "10 Jun 2025"],
              ["pax", "Pax", "4"],
            ] as const).map(([key, label, placeholder]) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
                <input
                  value={form[key]}
                  onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2"
                  style={{ "--tw-ring-color": ACCENT } as React.CSSProperties}
                />
              </div>
            ))}
          </div>
        </Modal>
      )}
    </div>
  );
}
