"use client";
import { useRef, useState } from "react";
import { Package, Upload, Download, X } from "lucide-react";
import { escapeCSV, parseCSVLine } from "../../lib/csv";

const CATEGORIES = ["Specialty", "Dairy", "Meat", "Beverages", "Dry Goods", "Produce", "Other"];
const TX_TYPES = ["received", "used", "waste"] as const;
type TxType = typeof TX_TYPES[number];

type InventoryItem = {
  item: string; category: string; stock: number; unit: string;
  reorder: number; cost: number; status: "ok" | "warning" | "critical";
};

const INITIAL_INVENTORY: InventoryItem[] = [
  { item: "Truffle Oil (250ml)", category: "Specialty", stock: 4, unit: "bottles", reorder: 6, cost: 1200, status: "critical" },
  { item: "Fresh Burrata", category: "Dairy", stock: 12, unit: "pcs", reorder: 8, cost: 280, status: "ok" },
  { item: "Lamb Rack (kg)", category: "Meat", stock: 3.2, unit: "kg", reorder: 5, cost: 1800, status: "warning" },
  { item: "Cocktail Spirits Mix", category: "Beverages", stock: 24, unit: "bottles", reorder: 12, cost: 850, status: "ok" },
  { item: "Fresh Cream (litre)", category: "Dairy", stock: 8, unit: "litres", reorder: 10, cost: 85, status: "warning" },
  { item: "Truffle Pasta (500g)", category: "Dry Goods", stock: 18, unit: "packs", reorder: 10, cost: 340, status: "ok" }
];

function deriveStatus(stock: number, reorder: number): InventoryItem["status"] {
  if (stock <= reorder * 0.5) return "critical";
  if (stock <= reorder) return "warning";
  return "ok";
}

type ImportStatus = { type: "success"; count: number } | { type: "error"; message: string } | null;

const EMPTY_FORM = { item: "", category: "Dairy", txType: "received" as TxType, qty: "", unit: "", reference: "" };

export default function InventoryPage() {
  const [inventory, setInventory] = useState<InventoryItem[]>(INITIAL_INVENTORY);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [importStatus, setImportStatus] = useState<ImportStatus>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const atRisk = inventory.filter(i => i.status !== "ok").length;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.item || !form.qty) return;
    const qty = Number(form.qty);
    setInventory(prev => {
      const idx = prev.findIndex(i => i.item.toLowerCase() === form.item.toLowerCase());
      if (idx >= 0) {
        const updated = [...prev];
        const current = { ...updated[idx] };
        if (form.txType === "received") current.stock = current.stock + qty;
        else current.stock = Math.max(0, current.stock - qty);
        current.status = deriveStatus(current.stock, current.reorder);
        updated[idx] = current;
        return updated;
      }
      const newStock = form.txType === "received" ? qty : 0;
      return [...prev, {
        item: form.item, category: form.category, stock: newStock,
        unit: form.unit || "units", reorder: 5, cost: 0,
        status: deriveStatus(newStock, 5)
      }];
    });
    setForm(EMPTY_FORM);
    setShowModal(false);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setImportStatus({ type: "error", message: "Only CSV files are supported." });
      e.target.value = "";
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const lines = text.split(/\r?\n/).filter(Boolean);
      if (lines.length < 2) {
        setImportStatus({ type: "error", message: "CSV is empty or has no data rows." });
        return;
      }
      const headers = parseCSVLine(lines[0]).map(h => h.toLowerCase());
      const itemIdx = headers.indexOf("item");
      if (itemIdx < 0) {
        setImportStatus({ type: "error", message: 'CSV must have an "Item" column.' });
        return;
      }
      const catIdx = headers.indexOf("category");
      const stockIdx = headers.indexOf("stock");
      const unitIdx = headers.indexOf("unit");
      const reorderIdx = headers.indexOf("reorder level");
      const costIdx = headers.indexOf("cost");

      const parsed: InventoryItem[] = [];
      for (let i = 1; i < lines.length; i++) {
        const cols = parseCSVLine(lines[i]);
        const item = cols[itemIdx];
        if (!item) continue;
        const stock = stockIdx >= 0 ? Number(cols[stockIdx]) || 0 : 0;
        const reorder = reorderIdx >= 0 ? Number(cols[reorderIdx]) || 5 : 5;
        parsed.push({
          item,
          category: catIdx >= 0 ? cols[catIdx] || "Other" : "Other",
          stock,
          unit: unitIdx >= 0 ? cols[unitIdx] || "units" : "units",
          reorder,
          cost: costIdx >= 0 ? Number(cols[costIdx]) || 0 : 0,
          status: deriveStatus(stock, reorder)
        });
      }
      if (parsed.length === 0) {
        setImportStatus({ type: "error", message: "No valid rows found in CSV." });
        return;
      }
      setInventory(prev => {
        const updated = [...prev];
        parsed.forEach(row => {
          const idx = updated.findIndex(i => i.item.toLowerCase() === row.item.toLowerCase());
          if (idx >= 0) updated[idx] = row;
          else updated.push(row);
        });
        return updated;
      });
      setImportStatus({ type: "success", count: parsed.length });
      setTimeout(() => setImportStatus(null), 4000);
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  function exportCSV() {
    const headers = ["Item", "Category", "Stock", "Unit", "Reorder Level", "Cost", "Status"];
    const rows = inventory.map(i => [i.item, i.category, i.stock, i.unit, i.reorder, i.cost, i.status]);
    const csv = [headers, ...rows].map(r => r.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "inventory-export.csv";
    a.click(); URL.revokeObjectURL(url);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Inventory Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time stock levels · reorder alerts · waste tracking</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <Upload className="w-4 h-4" /> Import CSV
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> Export CSV
          </button>
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: "#ea580c" }}
          >
            + Log Stock
          </button>
        </div>
      </div>

      {importStatus && (
        <div className={`mb-4 px-4 py-3 rounded-lg text-sm font-medium flex items-center gap-2 ${importStatus.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {importStatus.type === "success" ? `✓ Imported ${importStatus.count} item(s) successfully.` : `✗ ${importStatus.message}`}
        </div>
      )}

      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderTop: atRisk > 0 ? "3px solid #f43f5e" : undefined }}>
          <div className="kpi-label">Items at Risk</div>
          <div className="kpi-value mt-1.5" style={{ color: atRisk > 0 ? "#dc2626" : "#059669" }}>{atRisk}</div>
          <div className="kpi-delta down mt-1.5">Need reorder today</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total SKUs Tracked</div>
          <div className="kpi-value mt-1.5">{inventory.length}</div>
          <div className="kpi-delta neutral mt-1.5">Across multiple categories</div>
        </div>
        <div className="card">
          <div className="kpi-label">Monthly Waste</div>
          <div className="kpi-value mt-1.5">4.2%</div>
          <div className="kpi-delta up mt-1.5">↓ -1.1% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Procurement Pending</div>
          <div className="kpi-value mt-1.5">₹18,400</div>
          <div className="kpi-delta neutral mt-1.5">3 items to reorder</div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <Package className="w-4 h-4 text-orange-500" />
          <h3 className="card-title mb-0">Stock Levels</h3>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100">
              {["Item", "Category", "In Stock", "Reorder At", "Unit Cost", "Status"].map(h => (
                <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {inventory.map((item, i) => (
              <tr key={i} className={`border-b border-slate-50 ${item.status === "critical" ? "bg-red-50" : item.status === "warning" ? "bg-amber-50" : "hover:bg-slate-50"}`}>
                <td className="py-2.5 px-2 font-medium text-slate-800">{item.item}</td>
                <td className="py-2.5 px-2 text-xs text-slate-500">{item.category}</td>
                <td className="py-2.5 px-2">
                  <span className={`font-bold ${item.stock <= item.reorder ? "text-red-600" : "text-slate-700"}`}>{item.stock} {item.unit}</span>
                </td>
                <td className="py-2.5 px-2 text-slate-500">{item.reorder} {item.unit}</td>
                <td className="py-2.5 px-2 text-slate-600">₹{item.cost}</td>
                <td className="py-2.5 px-2">
                  {item.status === "critical" && <span className="badge" style={{ background: "#fee2e2", color: "#dc2626" }}>Critical</span>}
                  {item.status === "warning" && <span className="badge" style={{ background: "#fef3c7", color: "#d97706" }}>Low Stock</span>}
                  {item.status === "ok" && <span className="badge" style={{ background: "#d1fae5", color: "#059669" }}>OK</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
            <div className="flex items-center justify-between mb-5">
              <div>
                <h2 className="text-lg font-bold text-slate-800">Log Stock Movement</h2>
                <p className="text-xs text-slate-400 mt-0.5">Update an existing item or add a new one</p>
              </div>
              <button onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Item Name *</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="e.g. Truffle Oil (250ml)"
                  value={form.item}
                  onChange={e => setForm(f => ({ ...f, item: e.target.value }))}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Category</label>
                <select
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  value={form.category}
                  onChange={e => setForm(f => ({ ...f, category: e.target.value }))}
                >
                  {CATEGORIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Transaction Type</label>
                <div className="flex gap-2">
                  {TX_TYPES.map(t => (
                    <button
                      key={t} type="button"
                      onClick={() => setForm(f => ({ ...f, txType: t }))}
                      className={`flex-1 py-1.5 rounded-lg text-xs font-semibold border capitalize transition-colors ${form.txType === t
                        ? t === "received" ? "bg-emerald-500 text-white border-emerald-500"
                          : t === "used" ? "bg-blue-500 text-white border-blue-500"
                          : "bg-red-400 text-white border-red-400"
                        : "border-slate-200 text-slate-500 hover:bg-slate-50"}`}
                    >
                      {t}
                    </button>
                  ))}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Quantity *</label>
                  <input
                    type="number" min="0" step="0.1"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="0"
                    value={form.qty}
                    onChange={e => setForm(f => ({ ...f, qty: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Unit</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="bottles, kg, pcs…"
                    value={form.unit}
                    onChange={e => setForm(f => ({ ...f, unit: e.target.value }))}
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Reference / Note</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="Invoice #, supplier name, etc."
                  value={form.reference}
                  onChange={e => setForm(f => ({ ...f, reference: e.target.value }))}
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => { setShowModal(false); setForm(EMPTY_FORM); }}
                  className="px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
                  style={{ background: "#ea580c" }}
                >
                  Log Movement
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
