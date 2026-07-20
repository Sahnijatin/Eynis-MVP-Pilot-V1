"use client";

import { useCallback, useState } from "react";
import { Users, Plus, Pencil, Trash2, Download } from "lucide-react";
import { Modal, useToast } from "../ds";
import type { PatientRow } from "../../lib/data";

const ACCENT = "#0891b2";

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  active: { label: "Active", color: "var(--ok-text)", bg: "var(--ok-bg)" },
  due: { label: "Due", color: "var(--warn-text)", bg: "var(--warn-bg)" },
  overdue: { label: "Overdue", color: "var(--danger-text)", bg: "var(--danger-bg)" },
  lost_follow_up: { label: "Lost Follow-up", color: "var(--text-muted)", bg: "var(--surface-inset)" },
};
const STATUSES = Object.keys(STATUS_META);

type Form = { name: string; phone: string; email: string; dateOfBirth: string; condition: string; bloodGroup: string; insurance: string; status: string; notes: string };
const EMPTY: Form = { name: "", phone: "", email: "", dateOfBirth: "", condition: "", bloodGroup: "", insurance: "", status: "active", notes: "" };

function csvExport(items: PatientRow[]) {
  const esc = (v: string) => { const s = /^[=+\-@]/.test(v) ? `'${v}` : v; return `"${s.replace(/"/g, '""')}"`; };
  const header = ["Name", "Age", "Condition", "Phone", "Email", "Blood Group", "Status"];
  const lines = items.map((p) => [p.name, p.age != null ? String(p.age) : "", p.condition ?? "", p.phone ?? "", p.email ?? "", p.bloodGroup ?? "", p.status].map(esc).join(","));
  const blob = new Blob([[header.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "patients.csv"; a.click(); URL.revokeObjectURL(url);
}

export function PatientsClient({ initialItems }: { initialItems: PatientRow[] }) {
  const toast = useToast();
  const [items, setItems] = useState<PatientRow[]>(initialItems);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/patients", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; items?: PatientRow[] };
      if (data.ok && data.items) setItems(data.items);
    } catch { toast.push("Couldn't refresh patients", "error"); }
  }, [toast]);

  const overdue = items.filter((p) => p.status === "overdue" || p.status === "lost_follow_up").length;

  function openAdd() { setEditingId(null); setForm(EMPTY); setModalOpen(true); }
  function openEdit(p: PatientRow) {
    setEditingId(p.id);
    setForm({ name: p.name, phone: p.phone ?? "", email: p.email ?? "", dateOfBirth: p.dateOfBirth ? p.dateOfBirth.slice(0, 10) : "", condition: p.condition ?? "", bloodGroup: p.bloodGroup ?? "", insurance: p.insurance ?? "", status: p.status, notes: p.notes ?? "" });
    setModalOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.push("Patient name is required", "error"); return; }
    setSaving(true);
    try {
      const payload = { name: form.name.trim(), phone: form.phone.trim(), email: form.email.trim(), dateOfBirth: form.dateOfBirth || null, condition: form.condition.trim(), bloodGroup: form.bloodGroup.trim(), insurance: form.insurance.trim(), status: form.status, notes: form.notes.trim() };
      const res = await fetch(editingId ? `/api/patients/${editingId}` : "/api/patients", { method: editingId ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload) });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) { toast.push(data.error ?? "Couldn't save the patient", "error"); return; }
      toast.push(editingId ? "Patient updated" : "Patient added", "success");
      setModalOpen(false); setForm(EMPTY); setEditingId(null);
      await load();
    } catch { toast.push("Couldn't save the patient — please try again", "error"); }
    finally { setSaving(false); }
  }

  async function remove(p: PatientRow) {
    if (!window.confirm(`Delete patient "${p.name}"?`)) return;
    setItems((prev) => prev.filter((i) => i.id !== p.id));
    try {
      const res = await fetch(`/api/patients/${p.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.push("Patient deleted", "success");
    } catch { toast.push("Couldn't delete the patient", "error"); await load(); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-fg">Patient Records</h1>
          <p className="text-sm text-fg-muted mt-0.5">Your patient directory and follow-up status.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => csvExport(items)} disabled={items.length === 0} className="px-3 py-2 text-sm font-medium rounded-lg border border-line text-fg-muted hover:bg-surface-inset flex items-center gap-1.5 disabled:opacity-40"><Download className="w-3.5 h-3.5" /> Export CSV</button>
          <button onClick={openAdd} className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5" style={{ background: ACCENT }}><Plus className="w-4 h-4" /> Add Patient</button>
        </div>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card"><div className="kpi-label">Total Patients</div><div className="kpi-value mt-1.5">{items.length}</div></div>
        <div className="card"><div className="kpi-label">Active</div><div className="kpi-value mt-1.5">{items.filter((p) => p.status === "active").length}</div></div>
        <div className="card" style={{ borderTop: overdue > 0 ? "3px solid #f59e0b" : undefined }}><div className="kpi-label">Follow-up Overdue</div><div className="kpi-value mt-1.5">{overdue}</div><div className="kpi-delta neutral mt-1.5">need outreach</div></div>
        <div className="card"><div className="kpi-label">Due Soon</div><div className="kpi-value mt-1.5">{items.filter((p) => p.status === "due").length}</div></div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4"><Users className="w-4 h-4" style={{ color: ACCENT }} /><h3 className="card-title mb-0">All Patients</h3></div>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Name</th><th>Age</th><th>Condition</th><th>Phone</th><th>Blood</th><th>Status</th><th></th></tr></thead>
            <tbody>
              {items.map((p) => {
                const s = STATUS_META[p.status] ?? STATUS_META.active;
                return (
                  <tr key={p.id}>
                    <td className="font-medium text-fg">{p.name}</td>
                    <td className="text-fg-muted">{p.age != null ? p.age : "—"}</td>
                    <td className="text-fg-muted text-xs">{p.condition || "—"}</td>
                    <td className="text-fg-muted text-xs">{p.phone || "—"}</td>
                    <td className="text-fg-muted text-xs">{p.bloodGroup || "—"}</td>
                    <td><span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span></td>
                    <td>
                      <div className="flex items-center gap-2">
                        <button onClick={() => openEdit(p)} className="text-fg-subtle hover:text-fg-muted" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                        <button onClick={() => remove(p)} className="text-fg-subtle hover:text-danger" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {items.length === 0 && (<tr><td colSpan={7} className="text-center py-10 text-fg-subtle">No patients yet — add your first patient.</td></tr>)}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <Modal title={editingId ? "Edit Patient" : "Add Patient"} onClose={() => { setModalOpen(false); setForm(EMPTY); setEditingId(null); }}>
          <form onSubmit={save} className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-fg-muted mb-1">Full Name *</label>
              <input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="Rahul Sharma" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Phone</label><input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} /></div>
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Email</label><input type="email" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.email} onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} /></div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Date of Birth</label><input type="date" className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.dateOfBirth} onChange={(e) => setForm((f) => ({ ...f, dateOfBirth: e.target.value }))} /></div>
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Blood Group</label><input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="B+" value={form.bloodGroup} onChange={(e) => setForm((f) => ({ ...f, bloodGroup: e.target.value }))} /></div>
            </div>
            <div><label className="block text-xs font-semibold text-fg-muted mb-1">Primary Condition</label><input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" placeholder="Hypertension" value={form.condition} onChange={(e) => setForm((f) => ({ ...f, condition: e.target.value }))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Insurance</label><input className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.insurance} onChange={(e) => setForm((f) => ({ ...f, insurance: e.target.value }))} /></div>
              <div><label className="block text-xs font-semibold text-fg-muted mb-1">Status</label><select className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus" value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>{STATUSES.map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}</select></div>
            </div>
            <div><label className="block text-xs font-semibold text-fg-muted mb-1">Notes</label><textarea rows={2} className="w-full border border-line rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-accent-focus resize-none" value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} /></div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setModalOpen(false); setForm(EMPTY); setEditingId(null); }} className="px-4 py-2 rounded-lg text-sm font-medium border border-line text-fg-muted hover:bg-surface-inset">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>{saving ? "Saving…" : editingId ? "Save changes" : "Add Patient"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
