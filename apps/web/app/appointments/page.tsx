"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { ImportExportButtons } from "../../components/ui/import-export-buttons";
import { Modal } from "../../components/ds";

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

const EMPTY_FORM = { time: "", patient: "", type: "Consultation", doctor: "", duration: "30 min" };

export default function AppointmentsPage() {
  const [slots, setSlots] = useState(TODAY_SLOTS);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const active = slots.filter(s => ["checked_in", "in_progress", "waiting"].includes(s.status)).length;
  const noShows = slots.filter(s => s.status === "no_show").length;

  function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!form.patient.trim() || !form.time.trim()) return;
    setSlots(prev => [...prev, { ...form, status: "confirmed" }]);
    setForm(EMPTY_FORM);
    setModalOpen(false);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Appointments</h1>
          <p className="text-sm text-slate-500 mt-0.5">Today's schedule · patient flow · no-show tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            rows={slots}
            columns={[
              { label: "Time",     value: "time" },
              { label: "Patient",  value: "patient" },
              { label: "Type",     value: "type" },
              { label: "Doctor",   value: "doctor" },
              { label: "Duration", value: "duration" },
              { label: "Status",   value: "status" },
            ]}
            fileBase="appointments"
            accentColor="#0891b2"
            onImport={(rows) => {
              const next = rows
                .map(r => ({
                  time: r["Time"] ?? "",
                  patient: r["Patient"] ?? "",
                  type: r["Type"] ?? "Consultation",
                  doctor: r["Doctor"] ?? "",
                  duration: r["Duration"] ?? "30 min",
                  status: r["Status"] || "confirmed",
                }))
                .filter(a => a.patient);
              if (next.length) setSlots(prev => [...prev, ...next]);
              return { count: next.length };
            }}
          />
          <button onClick={() => setModalOpen(true)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#0891b2" }}>+ Book Appointment</button>
        </div>
      </div>
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Today's Appointments</div>
          <div className="kpi-value mt-1.5">{slots.filter(s => s.status !== "blocked").length}</div>
          <div className="kpi-delta neutral mt-1.5">{active} active now</div>
        </div>
        <div className="card">
          <div className="kpi-label">Waiting Room</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>{slots.filter(s => s.status === "waiting").length}</div>
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
          {slots.map((slot, i) => (
            <div key={i} className={`flex items-center gap-4 p-3 rounded-lg border ${slot.status === "in_progress" ? "border-blue-200 bg-blue-50" : slot.status === "no_show" ? "border-red-100 bg-red-50" : slot.status === "blocked" ? "border-slate-100 bg-slate-50" : "border-slate-100 hover:bg-slate-50"} transition-colors`}>
              <span className="text-sm font-mono font-semibold text-slate-500 w-20 shrink-0">{slot.time}</span>
              <div className="flex-1">
                <div className="font-medium text-slate-800">{slot.patient}</div>
                <div className="text-xs text-slate-500">{slot.type} · {slot.doctor} · {slot.duration}</div>
              </div>
              <StatusBadge status={slot.status} />
            </div>
          ))}
        </div>
      </div>

      {modalOpen && (
        <Modal title="Book Appointment" onClose={() => setModalOpen(false)}>
          <form onSubmit={handleCreate} className="space-y-3">
            {([
              ["patient", "Patient name", "Rahul Sharma"],
              ["time", "Slot time", "10:30 AM"],
              ["type", "Visit type", "Consultation / Follow-up / ECG"],
              ["doctor", "Doctor", "Dr. Patel"],
              ["duration", "Duration", "30 min"],
            ] as const).map(([key, label, placeholder]) => (
              <div key={key}>
                <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">{label}</label>
                <input
                  value={form[key]}
                  onChange={e => setForm(prev => ({ ...prev, [key]: e.target.value }))}
                  placeholder={placeholder}
                  className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2"
                  style={{ "--tw-ring-color": "#0891b2" } as React.CSSProperties}
                />
              </div>
            ))}
            <button type="submit" className="w-full py-2.5 text-sm font-semibold text-white rounded-lg mt-2" style={{ background: "#0891b2" }}>Book Appointment</button>
          </form>
        </Modal>
      )}
    </div>
  );
}
