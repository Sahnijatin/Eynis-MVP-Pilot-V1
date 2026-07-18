"use client";

import { useRef, useState } from "react";
import { Package, Upload, Download, Trash2 } from "lucide-react";
import { Modal, Button, Field, Input, Select } from "../ds";
import { escapeCSV, parseCSVLine } from "../../lib/csv";
import type { InventoryItem } from "../../lib/data";

const CATEGORIES = ["Specialty", "Dairy", "Meat", "Beverages", "Dry Goods", "Produce", "Other"];
const TX_TYPES = ["received", "used", "waste"] as const;
type TxType = typeof TX_TYPES[number];

type ImportStatus = { type: "success"; count: number } | { type: "error"; message: string } | null;
const EMPTY_FORM = { name: "", category: "Dairy", txType: "received" as TxType, qty: "", unit: "" };

export function InventoryClient({ initialItems, heading }: { initialItems: InventoryItem[]; heading?: { title: string; subtitle: string } }) {
  const [items, setItems] = useState<InventoryItem[]>(initialItems);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importStatus, setImportStatus] = useState<ImportStatus>(null);
  const [busy, setBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const atRisk = items.filter((i) => i.status !== "ok").length;
  const stockValue = items.reduce((s, i) => s + i.stock * i.unitCostInr, 0);

  // Merge an item returned by the API into local state (insert or replace).
  const mergeItem = (item: InventoryItem) =>
    setItems((prev) => {
      const idx = prev.findIndex((i) => i.id === item.id);
      if (idx >= 0) { const next = [...prev]; next[idx] = item; return next; }
      return [...prev, item].sort((a, b) => a.name.localeCompare(b.name));
    });

  async function postMovement(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch("/api/inventory/items", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; item?: InventoryItem; error?: string };
    if (!res.ok || !data.ok || !data.item) return false;
    mergeItem(data.item);
    return true;
  }

  // Absolute update of an existing item (PUT). The API records a stock change as
  // an "adjustment" ledger event, so import corrections stay auditable without
  // fabricating a goods receipt.
  async function putItem(id: string, payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/inventory/items/${id}`, {
      method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(payload),
    });
    const data = (await res.json()) as { ok: boolean; item?: InventoryItem; error?: string };
    if (!res.ok || !data.ok || !data.item) return false;
    mergeItem(data.item);
    return true;
  }

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name || !form.qty || busy) return;
    setBusy(true);
    try {
      const ok = await postMovement({ name: form.name, category: form.category, txType: form.txType, qty: Number(form.qty), unit: form.unit || undefined });
      if (ok) { setForm(EMPTY_FORM); setShowModal(false); }
      else setImportStatus({ type: "error", message: "Could not save the movement." });
    } catch {
      setImportStatus({ type: "error", message: "Could not save the movement." });
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(item: InventoryItem) {
    if (busy || !confirm(`Delete "${item.name}"?`)) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/inventory/items/${item.id}`, { method: "DELETE" });
      if (res.ok) setItems((prev) => prev.filter((i) => i.id !== item.id));
      else setImportStatus({ type: "error", message: `Could not delete "${item.name}".` });
    } catch {
      setImportStatus({ type: "error", message: `Could not delete "${item.name}".` });
    } finally {
      setBusy(false);
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) { setImportStatus({ type: "error", message: "Only CSV files are supported." }); e.target.value = ""; return; }
    const text = await file.text();
    e.target.value = "";
    const lines = text.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) { setImportStatus({ type: "error", message: "CSV is empty or has no data rows." }); return; }
    const headers = parseCSVLine(lines[0]).map((h) => h.toLowerCase());
    const nameIdx = headers.indexOf("item") >= 0 ? headers.indexOf("item") : headers.indexOf("name");
    if (nameIdx < 0) { setImportStatus({ type: "error", message: 'CSV must have an "Item" (or "Name") column.' }); return; }
    const catIdx = headers.indexOf("category");
    const stockIdx = headers.indexOf("stock");
    const unitIdx = headers.indexOf("unit");
    const reorderIdx = headers.indexOf("reorder level");
    const costIdx = headers.indexOf("cost");

    // CSV stock values are ABSOLUTE levels (that's what export writes), so an
    // existing item gets an absolute update (ledger: "adjustment"), never an
    // additive "received" movement — otherwise an export→import round-trip
    // doubles every item's stock. Only genuinely new items are created via a
    // receipt, which starts them at the imported level.
    const byName = new Map(items.map((i) => [i.name, i]));
    let count = 0;
    setBusy(true);
    try {
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const name = cols[nameIdx]?.trim();
        if (!name) continue;
        const common = {
          category: catIdx >= 0 ? cols[catIdx] || undefined : undefined,
          unit: unitIdx >= 0 ? cols[unitIdx] || undefined : undefined,
          reorderLevel: reorderIdx >= 0 ? Number(cols[reorderIdx]) || undefined : undefined,
          unitCostInr: costIdx >= 0 ? Number(cols[costIdx]) || undefined : undefined,
        };
        const existing = byName.get(name);
        const ok = existing
          ? await putItem(existing.id, {
              ...common,
              ...(stockIdx >= 0 ? { stock: Number(cols[stockIdx]) || 0 } : {}),
            })
          : await postMovement({
              name, txType: "received",
              qty: stockIdx >= 0 ? Number(cols[stockIdx]) || 0 : 0,
              ...common,
            });
        if (ok) count++;
      }
    } finally {
      setBusy(false);
    }
    setImportStatus(count > 0 ? { type: "success", count } : { type: "error", message: "No valid rows imported." });
    setTimeout(() => setImportStatus(null), 4000);
  }

  function exportCSV() {
    const headers = ["Item", "Category", "Stock", "Unit", "Reorder Level", "Cost", "Status"];
    const rows = items.map((i) => [i.name, i.category, i.stock, i.unit, i.reorderLevel, i.unitCostInr, i.status]);
    const csv = [headers, ...rows].map((r) => r.map(escapeCSV).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url; a.download = "inventory-export.csv"; a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-fg">{heading?.title ?? "Inventory Management"}</h1>
          <p className="text-sm text-fg-muted mt-0.5">{heading?.subtitle ?? "Real-time stock levels · reorder alerts · waste tracking"}</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <Button variant="secondary" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            <Upload className="w-4 h-4" /> Import CSV
          </Button>
          <Button variant="secondary" onClick={exportCSV}>
            <Download className="w-4 h-4" /> Export CSV
          </Button>
          <Button variant="primary" onClick={() => setShowModal(true)}>+ Log Stock</Button>
        </div>
      </div>

      {importStatus && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium ${importStatus.type === "success" ? "bg-ok-bg text-ok border border-ok-border" : "bg-danger-bg text-danger border border-danger-border"}`}>
          {importStatus.type === "success" ? `✓ Imported ${importStatus.count} item(s).` : `✗ ${importStatus.message}`}
        </div>
      )}

      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderTop: atRisk > 0 ? "3px solid #f43f5e" : undefined }}>
          <div className="kpi-label">Items at Risk</div>
          <div className="kpi-value mt-1.5" style={{ color: atRisk > 0 ? "#dc2626" : "#059669" }}>{atRisk}</div>
          <div className="kpi-delta down mt-1.5">At or below reorder level</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total SKUs Tracked</div>
          <div className="kpi-value mt-1.5">{items.length}</div>
          <div className="kpi-delta neutral mt-1.5">Across all categories</div>
        </div>
        <div className="card">
          <div className="kpi-label">Stock Value</div>
          <div className="kpi-value mt-1.5">₹{stockValue.toLocaleString("en-IN")}</div>
          <div className="kpi-delta neutral mt-1.5">Stock × unit cost</div>
        </div>
        <div className="card">
          <div className="kpi-label">Healthy SKUs</div>
          <div className="kpi-value mt-1.5">{items.length - atRisk}</div>
          <div className="kpi-delta up mt-1.5">Above reorder level</div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-4 h-4 text-accent-text" />
          <h3 className="card-title mb-0">Stock Levels</h3>
        </div>
        {items.length === 0 ? (
          <div className="py-10 text-center">
            <div className="text-2xl mb-2">📦</div>
            <div className="font-semibold text-fg">No items yet</div>
            <p className="text-sm text-fg-muted mt-1 mb-4">Use “Log Stock” or “Import CSV” to add inventory.</p>
            <Button variant="primary" onClick={() => setShowModal(true)}>Log Stock</Button>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line">
                {["Item", "Category", "In Stock", "Reorder At", "Unit Cost", "Status", ""].map((h) => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-fg-muted uppercase">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id} className={`border-b border-line ${item.status === "critical" ? "bg-danger-bg" : item.status === "warning" ? "bg-warn-bg" : "hover:bg-surface-inset"}`}>
                  <td className="py-2.5 px-2 font-medium text-fg">{item.name}</td>
                  <td className="py-2.5 px-2 text-xs text-fg-muted">{item.category}</td>
                  <td className="py-2.5 px-2"><span className={`font-bold ${item.stock <= item.reorderLevel ? "text-danger" : "text-fg"}`}>{item.stock} {item.unit}</span></td>
                  <td className="py-2.5 px-2 text-fg-muted">{item.reorderLevel} {item.unit}</td>
                  <td className="py-2.5 px-2 text-fg-muted">₹{item.unitCostInr.toLocaleString("en-IN")}</td>
                  <td className="py-2.5 px-2">
                    {item.status === "critical" && <span className="badge" style={{ background: "#fee2e2", color: "#dc2626" }}>Critical</span>}
                    {item.status === "warning" && <span className="badge" style={{ background: "#fef3c7", color: "#d97706" }}>Low Stock</span>}
                    {item.status === "ok" && <span className="badge" style={{ background: "#d1fae5", color: "#059669" }}>OK</span>}
                  </td>
                  <td className="py-2.5 px-2">
                    <button onClick={() => handleDelete(item)} disabled={busy} className="w-7 h-7 rounded-lg flex items-center justify-center text-fg-muted hover:bg-danger-bg hover:text-danger disabled:opacity-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showModal && (
        <Modal
          title="Log Stock Movement"
          onClose={() => { setShowModal(false); setForm(EMPTY_FORM); }}
          footer={
            <>
              <Button variant="ghost" type="button" onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }}>Cancel</Button>
              <Button variant="primary" type="submit" form="inventory-form" disabled={busy}>{busy ? "Saving…" : "Log Movement"}</Button>
            </>
          }
        >
          <p className="text-xs text-fg-muted mb-3">Update an existing item or add a new one.</p>
          <form id="inventory-form" onSubmit={handleSubmit} className="space-y-3">
            <Field label="Item name">
              <Input placeholder="e.g. Truffle Oil (250ml)" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} required />
            </Field>
            <Field label="Category">
              <Select value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}>
                {CATEGORIES.map((c) => <option key={c}>{c}</option>)}
              </Select>
            </Field>
            <Field label="Transaction type">
              <div className="flex gap-2">
                {TX_TYPES.map((t) => (
                  <button key={t} type="button" onClick={() => setForm((f) => ({ ...f, txType: t }))}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border capitalize transition-colors ${form.txType === t ? (t === "received" ? "bg-ok-solid text-white border-ok-border" : t === "used" ? "bg-info-solid text-white border-info-border" : "bg-danger-solid text-white border-danger-border") : "border-line text-fg-muted hover:bg-surface-inset"}`}>
                    {t}
                  </button>
                ))}
              </div>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Quantity">
                <Input type="number" min="0" step="0.1" placeholder="0" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} required />
              </Field>
              <Field label="Unit">
                <Input placeholder="bottles, kg, pcs…" value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
              </Field>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
