"use client";

import { useCallback, useState } from "react";
import { CalendarDays, Plus, Trash2 } from "lucide-react";
import { Modal, useToast } from "../ds";
import type { AppointmentRow } from "../../lib/data";

const ACCENT = "#0891b2";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: "Scheduled", color: "var(--text-muted)", bg: "#f1f5f9" },
  checked_in: { label: "Checked In", color: "var(--ok-text)", bg: "#d1fae5" },
  waiting: { label: "Waiting", color: "var(--warn-text)", bg: "#fef3c7" },
  in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#eff6ff" },
  completed: { label: "Completed", color: "var(--text-muted)", bg: "#f1f5f9" },
  no_show: { label: "No Show", color: "var(--danger-text)", bg: "#fee2e2" },
  cancelled: { label: "Cancelled", color: "var(--text-subtle)", bg: "#f8fafc" },
};
const STATUSES = Object.keys(STATUS_META);

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

type Form = { patientName: string; provider: string; type: string; scheduledAt: string; durationMin: string; notes: string };
const EMPTY: Form = { patientName: "", provider: "", type: "Consultation", scheduledAt: "", durationMin: "30", notes: "" };

export function AppointmentsClient({ initialItems, dateLabel }: { initialItems: AppointmentRow[]; dateLabel: string }) {
  const toast = useToast();
  const [items, setItems] = useState<AppointmentRow[]>(initialItems);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/appointments" + window.location.search, { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; items?: AppointmentRow[] };
      if (data.ok && data.items) setItems(data.items);
    } catch { toast.push("Couldn't refresh the schedule", "error"); }
  }, [toast]);

  const active = items.filter((a) => ["checked_in", "waiting", "in_progress"].includes(a.status)).length;
  const noShows = items.filter((a) => a.status === "no_show").length;
  const completed = items.filter((a) => a.status === "completed").length;

  async function changeStatus(a: AppointmentRow, status: string) {
    setBusyId(a.id);
    setItems((prev) => prev.map((i) => i.id === a.id ? { ...i, status } : i)); // optimistic
    try {
      const res = await fetch(`/api/appointments/${a.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status }) });
      if (!res.ok) throw new Error();
    } catch { setItems((prev) => prev.map((i) => i.id === a.id ? { ...i, status: a.status } : i)); toast.push("Couldn't update status", "error"); }
    finally { setBusyId(null); }
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.patientName.trim()) { toast.push("Patient name is required", "error"); return; }
    if (!form.scheduledAt) { toast.push("Pick a date & time", "error"); return; }
    setSaving(true);
    try {
      const payload = { patientName: form.patientName.trim(), provider: form.provider.trim(), type: form.type.trim(), scheduledAt: new Date(form.scheduledAt).toISOString(), durationMin: Number(form.durationMin) || 30, notes: form.notes.trim() };
      const res = await fetch("/api/appointments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) { toast.push(data.error ?? "Couldn't create the appointment", "error"); return; }
      toast.push("Appointment created", "success");
      setModalOpen(false); setForm(EMPTY);
      await load();
    } catch { toast.push("Couldn't create the appointment — please try again", "error"); }
    finally { setSaving(false); }
  }

  async function remove(a: AppointmentRow) {
    if (!window.confirm(`Delete the appointment for ${a.patientName}?`)) return;
    setItems((prev) => prev.filter((i) => i.id !== a.id));
    try {
      const res = await fetch(`/api/appointments/${a.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.push("Appointment deleted", "success");
    } catch { toast.push("Couldn't delete the appointment", "error"); await load(); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-fg">Appointments</h1>
          <p className="text-sm text-fg-muted mt-0.5">{dateLabel} · patient flow &amp; no-show tracking</p>
        </div>
        <button onClick={() => setModalOpen(true)} className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5" style={{ background: ACCENT }}><Plus className="w-4 h-4" /> New Appointment</button>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card"><div className="kpi-label">Scheduled</div><div className="kpi-value mt-1.5">{items.length}</div><div className="kpi-delta neutral mt-1.5">{dateLabel.toLowerCase()}</div></div>
        <div className="card"><div className="kpi-label">In Flow</div><div className="kpi-value mt-1.5">{active}</div><div className="kpi-delta neutral mt-1.5">checked-in / waiting</div></div>
        <div className="card"><div className="kpi-label">Completed</div><div className="kpi-value mt-1.5">{completed}</div></div>
        <div className="card" style={{ borderTop: noShows > 0 ? "3px solid #f43f5e" : undefined }}><div className="kpi-label">No-shows</div><div className="kpi-value mt-1.5">{noShows}</div></div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4"><CalendarDays className="w-4 h-4" style={{ color: ACCENT }} /><h3 className="card-title mb-0">Schedule</h3></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Time</th><th>Patient</th><th>Type</th><th>Provider</th><th>Duration</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map((a) => {
                const s = STATUS_META[a.status] ?? STATUS_META.scheduled;
                return (
                  <tr key={a.id}>
                    <td className="font-medium text-fg">{fmtTime(a.scheduledAt)}</td>
                    <td className="font-medium text-fg">{a.patientName}</td>
                    <td className="text-fg-muted text-xs">{a.type || "—"}</td>
                    <td className="text-fg-muted text-xs">{a.provider || "—"}</td>
                    <td className="text-fg-muted text-xs">{a.durationMin} min</td>
                    <td>
                      <select value={a.status} disabled={busyId === a.id} onChange={(e) => changeStatus(a, e.target.value)} className="text-xs rounded px-1.5 py-1 border" style={{ color: s.color, background: s.bg, borderColor: s.bg }}>
                        {STATUSES.map((st) => <option key={st} value={st}>{STATUS_META[st].label}</option>)}
                      </select>
                    </td>
                    <td><button onClick={() => remove(a)} className="text-fg-subtle hover:text-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button></td>
                  </tr>
                );
              })}
              {items.length === 0 && (<tr><td colSpan={7} className="text-center py-10 text-fg-subtle">No appointments for {dateLabel.toLowerCase()} — add one to get started.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <Modal title="New Appointment" onClose={() => { setModalOpen(false); setForm(EMPTY); }}>
          <form onSubmit={save} className="space-y-3">
            <div><label className="block text-xs font-semibold text-fg-muted mb-1">Patient *</label><input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="Rahul Sharma" value={form.patientName} onChange={(e) => setForm((f) => ({ ...f, patientName: e.target.value }))} required /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Date &amp; Time *</label><input type="datetime-local" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.scheduledAt} onChange={(e) => setForm((f) => ({ ...f, scheduledAt: e.target.value }))} required /></div>
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Duration (min)</label><input type="number" min="5" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.durationMin} onChange={(e) => setForm((f) => ({ ...f, durationMin: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Type</label><input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="Consultation" value={form.type} onChange={(e) => setForm((f) => ({ ...f, type: e.target.value }))} /></div>
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Provider</label><input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="Dr. Patel" value={form.provider} onChange={(e) => setForm((f) => ({ ...f, provider: e.target.value }))} /></div>
            </div>
            <div><label className="block text-xs font-semibold text-fg-muted mb-1">Notes</label><textarea rows={2} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus resize-none" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setModalOpen(false); setForm(EMPTY); }} className="px-4 py-2 rounded-lg text-sm font-medium border border-line text-fg-muted hover:bg-surface-inset">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>{saving ? "Saving…" : "Create Appointment"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
