"use client";

import { useCallback, useState } from "react";
import { Plane, Plus, Pencil, Trash2, Download } from "lucide-react";
import { Modal, useToast } from "../ds";
import type { BookingRow } from "../../lib/data";

const ACCENT = "#7c3aed";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#eff6ff" },
  confirmed: { label: "Confirmed", color: "#059669", bg: "#d1fae5" },
  pending_visa: { label: "Visa Pending", color: "#d97706", bg: "#fef3c7" },
  urgent: { label: "Action Needed", color: "#dc2626", bg: "#fee2e2" },
  completed: { label: "Completed", color: "#475569", bg: "#f1f5f9" },
  cancelled: { label: "Cancelled", color: "#64748b", bg: "#f1f5f9" },
};
const STATUSES = Object.keys(STATUS_META);

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN")}`;
const lakh = (paise: number) => { const inr = paise / 100; return inr >= 100000 ? `₹${(inr / 100000).toFixed(1)}L` : rupees(paise); };
const fmtDate = (iso: string | null) => iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" }) : "TBD";

type Form = { clientName: string; destination: string; departureDate: string; pax: string; valueInr: string; paidInr: string; status: string; notes: string };
const EMPTY: Form = { clientName: "", destination: "", departureDate: "", pax: "1", valueInr: "", paidInr: "", status: "in_progress", notes: "" };

function csvExport(items: BookingRow[]) {
  const esc = (v: string) => { const s = /^[=+\-@]/.test(v) ? `'${v}` : v; return `"${s.replace(/"/g, '""')}"`; };
  const header = ["Booking", "Client", "Destination", "Departure", "Pax", "Value", "Paid %", "Status"];
  const lines = items.map((b) => [b.number, b.clientName, b.destination, fmtDate(b.departureDate), String(b.pax), String(b.valueInr), String(b.paidPct), b.status].map(esc).join(","));
  const blob = new Blob([[header.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "bookings.csv"; a.click(); URL.revokeObjectURL(url);
}

export function BookingsClient({ initialItems }: { initialItems: BookingRow[] }) {
  const toast = useToast();
  const [items, setItems] = useState<BookingRow[]>(initialItems);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/bookings", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; items?: BookingRow[] };
      if (data.ok && data.items) setItems(data.items);
    } catch { toast.push("Couldn't refresh bookings", "error"); }
  }, [toast]);

  const live = items.filter((b) => b.status !== "cancelled" && b.status !== "completed");
  const pipeline = live.reduce((s, b) => s + b.valuePaise, 0);
  const totalPax = live.reduce((s, b) => s + b.pax, 0);
  const soon = Date.now() + 14 * 24 * 60 * 60 * 1000;
  const attention = live.filter((b) => b.status === "urgent" || b.status === "pending_visa" || (b.paidPct < 100 && b.departureDate && new Date(b.departureDate).getTime() <= soon)).length;

  function openAdd() { setEditingId(null); setForm(EMPTY); setModalOpen(true); }
  function openEdit(b: BookingRow) {
    setEditingId(b.id);
    setForm({ clientName: b.clientName, destination: b.destination, departureDate: b.departureDate ? b.departureDate.slice(0, 10) : "", pax: String(b.pax), valueInr: String(b.valueInr), paidInr: String(b.paidInr), status: b.status, notes: b.notes ?? "" });
    setModalOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.clientName.trim()) { toast.push("Client name is required", "error"); return; }
    setSaving(true);
    try {
      const payload = {
        clientName: form.clientName.trim(), destination: form.destination.trim(),
        departureDate: form.departureDate || null, pax: Number(form.pax) || 1,
        valueInr: Number(form.valueInr) || 0, paidInr: Number(form.paidInr) || 0,
        status: form.status, notes: form.notes.trim(),
      };
      const res = await fetch(editingId ? `/api/bookings/${editingId}` : "/api/bookings", {
        method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) { toast.push(data.error ?? "Couldn't save the booking", "error"); return; }
      toast.push(editingId ? "Booking updated" : "Booking created", "success");
      setModalOpen(false); setForm(EMPTY); setEditingId(null);
      await load();
    } catch { toast.push("Couldn't save the booking — please try again", "error"); }
    finally { setSaving(false); }
  }

  async function remove(b: BookingRow) {
    if (!window.confirm(`Delete booking ${b.number} (${b.clientName})?`)) return;
    setItems((prev) => prev.filter((i) => i.id !== b.id));
    try {
      const res = await fetch(`/api/bookings/${b.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.push("Booking deleted", "success");
    } catch { toast.push("Couldn't delete the booking", "error"); await load(); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-fg">Booking Pipeline</h1>
          <p className="text-sm text-fg-muted mt-0.5">Active bookings · departures · payment status.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => csvExport(items)} disabled={items.length === 0} className="px-3 py-2 text-sm font-medium rounded-lg border border-line text-fg-muted hover:bg-surface-inset flex items-center gap-1.5 disabled:opacity-40">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={openAdd} className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5" style={{ background: ACCENT }}>
            <Plus className="w-4 h-4" /> New Booking
          </button>
        </div>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card"><div className="kpi-label">Pipeline Value</div><div className="kpi-value mt-1.5">{lakh(pipeline)}</div><div className="kpi-delta neutral mt-1.5">{live.length} active bookings</div></div>
        <div className="card"><div className="kpi-label">Active Bookings</div><div className="kpi-value mt-1.5">{live.length}</div><div className="kpi-delta neutral mt-1.5">{live.filter((b) => b.status === "confirmed").length} confirmed</div></div>
        <div className="card"><div className="kpi-label">Total Pax</div><div className="kpi-value mt-1.5">{totalPax}</div><div className="kpi-delta neutral mt-1.5">across active bookings</div></div>
        <div className="card" style={{ borderTop: attention > 0 ? "3px solid #f59e0b" : undefined }}><div className="kpi-label">Needs Attention</div><div className="kpi-value mt-1.5">{attention}</div><div className="kpi-delta neutral mt-1.5">visa pending / unpaid / urgent</div></div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4"><Plane className="w-4 h-4" style={{ color: ACCENT }} /><h3 className="card-title mb-0">All Bookings</h3></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Booking</th><th>Client</th><th>Destination</th><th>Departure</th><th>Pax</th><th>Value</th><th>Paid</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map((b) => {
                const s = STATUS_META[b.status] ?? STATUS_META.in_progress;
                return (
                  <tr key={b.id}>
                    <td className="font-mono text-xs text-accent-text font-semibold">{b.number}</td>
                    <td className="font-medium text-fg">{b.clientName}</td>
                    <td className="text-fg-muted text-xs">{b.destination || "—"}</td>
                    <td className="text-sm text-fg-muted">{fmtDate(b.departureDate)}</td>
                    <td className="text-fg-muted">{b.pax}</td>
                    <td className="font-semibold">{lakh(b.valuePaise)}</td>
                    <td><span className={`font-semibold ${b.paidPct >= 100 ? "text-ok" : b.paidPct === 0 ? "text-danger" : "text-warn"}`}>{b.paidPct}%</span></td>
                    <td><span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(b)} className="text-fg-subtle hover:text-fg-muted" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => remove(b)} className="text-fg-subtle hover:text-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (
                <tr><td colSpan={9} className="text-center py-10 text-fg-subtle">No bookings yet — create your first booking.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <Modal title={editingId ? "Edit Booking" : "New Booking"} onClose={() => { setModalOpen(false); setForm(EMPTY); setEditingId(null); }}>
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1">Client / Lead traveller *</label>
              <input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="Arora Family" value={form.clientName} onChange={(e) => setForm((f) => ({ ...f, clientName: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1">Destination</label>
              <input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="Maldives — 5N/6D" value={form.destination} onChange={(e) => setForm((f) => ({ ...f, destination: e.target.value }))} />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">Departure</label>
                <input type="date" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.departureDate} onChange={(e) => setForm((f) => ({ ...f, departureDate: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">Pax</label>
                <input type="number" min="1" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.pax} onChange={(e) => setForm((f) => ({ ...f, pax: e.target.value }))} />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">Booking Value (₹)</label>
                <input type="number" min="0" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="0" value={form.valueInr} onChange={(e) => setForm((f) => ({ ...f, valueInr: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-fg-muted mb-1">Paid so far (₹)</label>
                <input type="number" min="0" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="0" value={form.paidInr} onChange={(e) => setForm((f) => ({ ...f, paidInr: e.target.value }))} />
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1">Status</label>
              <select className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1">Notes</label>
              <textarea rows={2} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus resize-none" placeholder="Itinerary notes, visa status, reminders…" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setModalOpen(false); setForm(EMPTY); setEditingId(null); }} className="px-4 py-2 rounded-lg text-sm font-medium border border-line text-fg-muted hover:bg-surface-inset">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>{saving ? "Saving…" : editingId ? "Save changes" : "Create Booking"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
