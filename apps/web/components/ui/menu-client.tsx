"use client";

import { useCallback, useState } from "react";
import { Plus, Pencil, Trash2, Download } from "lucide-react";
import { Modal, useToast } from "../ds";
import type { MenuItemRow } from "../../lib/data";

const CATEGORIES = ["Starters", "Mains", "Desserts", "Beverages", "Other"];
const ACCENT = "#ea580c";

type Form = { name: string; category: string; priceInr: string; costInr: string; description: string; isAvailable: boolean };
const EMPTY: Form = { name: "", category: "Starters", priceInr: "", costInr: "", description: "", isAvailable: true };

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN")}`;

function csvExport(items: MenuItemRow[]) {
  const esc = (v: string) => { const s = /^[=+\-@]/.test(v) ? `'${v}` : v; return `"${s.replace(/"/g, '""')}"`; };
  const header = ["Name", "Category", "Price", "Cost", "Margin %", "Available"];
  const lines = items.map((i) => [i.name, i.category, String(i.priceInr), String(i.costInr), String(i.marginPct), i.isAvailable ? "Yes" : "No"].map(esc).join(","));
  const blob = new Blob([[header.map(esc).join(","), ...lines].join("\n")], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a"); a.href = url; a.download = "menu.csv"; a.click(); URL.revokeObjectURL(url);
}

export function MenuClient({ initialItems }: { initialItems: MenuItemRow[] }) {
  const toast = useToast();
  const [items, setItems] = useState<MenuItemRow[]>(initialItems);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(EMPTY);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/menu/items", { cache: "no-store" });
      const data = (await res.json()) as { ok: boolean; items?: MenuItemRow[] };
      if (data.ok && data.items) setItems(data.items);
    } catch { toast.push("Couldn't refresh the menu", "error"); }
  }, [toast]);

  const avgMargin = items.length ? Math.round(items.reduce((s, i) => s + i.marginPct, 0) / items.length) : 0;
  const availableCount = items.filter((i) => i.isAvailable).length;
  const topMargin = items.length ? [...items].sort((a, b) => b.marginPct - a.marginPct)[0] : null;
  const computedMargin = form.priceInr && form.costInr && Number(form.priceInr) > 0
    ? Math.round(((Number(form.priceInr) - Number(form.costInr)) / Number(form.priceInr)) * 100) : null;

  function openAdd() { setEditingId(null); setForm(EMPTY); setModalOpen(true); }
  function openEdit(m: MenuItemRow) {
    setEditingId(m.id);
    setForm({ name: m.name, category: m.category, priceInr: String(m.priceInr), costInr: String(m.costInr), description: m.description ?? "", isAvailable: m.isAvailable });
    setModalOpen(true);
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.name.trim()) { toast.push("Item name is required", "error"); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name.trim(), category: form.category, description: form.description.trim(),
        priceInr: Number(form.priceInr) || 0, costInr: Number(form.costInr) || 0, isAvailable: form.isAvailable,
      };
      const res = await fetch(editingId ? `/api/menu/items/${editingId}` : "/api/menu/items", {
        method: editingId ? "PATCH" : "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) { toast.push(data.error ?? "Couldn't save the item", "error"); return; }
      toast.push(editingId ? "Item updated" : "Item added", "success");
      setModalOpen(false); setForm(EMPTY); setEditingId(null);
      await load();
    } catch { toast.push("Couldn't save the item — please try again", "error"); }
    finally { setSaving(false); }
  }

  async function remove(m: MenuItemRow) {
    if (!window.confirm(`Delete "${m.name}" from the menu?`)) return;
    setItems((prev) => prev.filter((i) => i.id !== m.id)); // optimistic
    try {
      const res = await fetch(`/api/menu/items/${m.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error();
      toast.push("Item deleted", "success");
    } catch { toast.push("Couldn't delete the item", "error"); await load(); }
  }

  async function toggleAvailable(m: MenuItemRow) {
    const next = !m.isAvailable;
    setItems((prev) => prev.map((i) => i.id === m.id ? { ...i, isAvailable: next } : i)); // optimistic
    try {
      const res = await fetch(`/api/menu/items/${m.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isAvailable: next }),
      });
      if (!res.ok) throw new Error();
    } catch { setItems((prev) => prev.map((i) => i.id === m.id ? { ...i, isAvailable: m.isAvailable } : i)); toast.push("Couldn't update availability", "error"); }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Menu &amp; Pricing</h1>
          <p className="text-sm text-slate-500 mt-0.5">Your live menu — items, pricing and margins.</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => csvExport(items)} disabled={items.length === 0} className="px-3 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-40">
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
          <button onClick={openAdd} className="px-4 py-2 rounded-lg text-sm font-semibold text-white flex items-center gap-1.5" style={{ background: ACCENT }}>
            <Plus className="w-4 h-4" /> Add Item
          </button>
        </div>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card"><div className="kpi-label">Menu Items</div><div className="kpi-value mt-1.5">{items.length}</div><div className="kpi-delta neutral mt-1.5">{availableCount} available</div></div>
        <div className="card"><div className="kpi-label">Avg. Margin</div><div className="kpi-value mt-1.5">{items.length ? `${avgMargin}%` : "—"}</div></div>
        <div className="card"><div className="kpi-label">Highest Margin</div><div className="kpi-value mt-1.5 text-base">{topMargin ? topMargin.name : "—"}</div>{topMargin && <div className="kpi-delta up mt-1.5">{topMargin.marginPct}% margin</div>}</div>
        <div className="card"><div className="kpi-label">Unavailable</div><div className="kpi-value mt-1.5">{items.length - availableCount}</div><div className="kpi-delta neutral mt-1.5">86'd items</div></div>
      </div>

      <div className="card">
        <h3 className="card-title mb-4">Menu</h3>
        <div className="table-wrap">
          <table className="data-table">
            <thead><tr><th>Item</th><th>Category</th><th>Price</th><th>Cost</th><th>Margin</th><th>Available</th><th></th></tr></thead>
            <tbody>
              {items.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="font-medium text-slate-800">{m.name}</div>
                    {m.description && <div className="text-xs text-slate-400 mt-0.5">{m.description}</div>}
                  </td>
                  <td className="text-xs text-slate-500">{m.category}</td>
                  <td className="font-medium">{rupees(m.pricePaise)}</td>
                  <td className="text-slate-600">{rupees(m.costPaise)}</td>
                  <td><span className={`font-bold ${m.marginPct < 50 ? "text-red-600" : m.marginPct >= 75 ? "text-emerald-600" : "text-amber-600"}`}>{m.marginPct}%</span></td>
                  <td>
                    <button onClick={() => toggleAvailable(m)} className={`w-10 h-5 rounded-full transition-colors flex items-center ${m.isAvailable ? "justify-end" : "justify-start"}`} style={{ background: m.isAvailable ? ACCENT : "#e2e8f0", padding: "2px" }} aria-pressed={m.isAvailable} aria-label={`${m.name} available`}>
                      <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
                    </button>
                  </td>
                  <td>
                    <div className="flex items-center gap-2">
                      <button onClick={() => openEdit(m)} className="text-slate-400 hover:text-slate-600" title="Edit"><Pencil className="w-3.5 h-3.5" /></button>
                      <button onClick={() => remove(m)} className="text-slate-400 hover:text-red-600" title="Delete"><Trash2 className="w-3.5 h-3.5" /></button>
                    </div>
                  </td>
                </tr>
              ))}
              {items.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-slate-400">No menu items yet — add your first item.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {modalOpen && (
        <Modal title={editingId ? "Edit Menu Item" : "Add Menu Item"} onClose={() => { setModalOpen(false); setForm(EMPTY); setEditingId(null); }}>
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Item Name *</label>
              <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="e.g. Grilled Salmon" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
              <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Selling Price (₹)</label>
                <input type="number" min="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="0" value={form.priceInr} onChange={(e) => setForm((f) => ({ ...f, priceInr: e.target.value }))} />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Cost Price (₹)</label>
                <input type="number" min="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" placeholder="0" value={form.costInr} onChange={(e) => setForm((f) => ({ ...f, costInr: e.target.value }))} />
              </div>
            </div>
            {computedMargin !== null && (
              <div className={`text-sm px-3 py-2 rounded-lg font-semibold ${computedMargin < 50 ? "bg-red-50 text-red-700" : computedMargin >= 75 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>Gross Margin: {computedMargin}%</div>
            )}
            <div>
              <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
              <textarea rows={2} className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none" placeholder="Optional description or notes" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
            </div>
            <label className="flex items-center gap-2 text-sm text-slate-700">
              <input type="checkbox" checked={form.isAvailable} onChange={(e) => setForm((f) => ({ ...f, isAvailable: e.target.checked }))} />
              Available on the menu
            </label>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" onClick={() => { setModalOpen(false); setForm(EMPTY); setEditingId(null); }} className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button type="submit" disabled={saving} className="px-4 py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50" style={{ background: ACCENT }}>{saving ? "Saving…" : editingId ? "Save changes" : "Add to Menu"}</button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
