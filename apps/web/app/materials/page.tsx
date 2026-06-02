"use client";

import { useState, useRef } from "react";
import { AlertTriangle, Package, X, CheckCircle, Download, Upload, AlertCircle } from "lucide-react";
import { escapeCSV, parseCSVLine } from "../../lib/csv";

interface Material {
  name: string; unit: string; stockIn: number; used: number; offcut: number; onHand: number; reorderLevel: number; cost: number; status: string;
}

interface Transaction {
  time: string; material: string; type: string; qty: string; order: string; by: string;
}

const MATERIALS_INIT: Material[] = [
  { name: "Burma Teak Planks", unit: "sq ft", stockIn: 2400, used: 1850, offcut: 320, onHand: 230, reorderLevel: 500, cost: 180, status: "critical" },
  { name: "European Oak Veneer", unit: "sq ft", stockIn: 1800, used: 1200, offcut: 180, onHand: 420, reorderLevel: 300, cost: 95, status: "ok" },
  { name: "Marine Ply (19mm)", unit: "sheets", stockIn: 340, used: 290, offcut: 8, onHand: 42, reorderLevel: 50, cost: 1200, status: "warning" },
  { name: "Upholstery Foam (4\")", unit: "m²", stockIn: 680, used: 510, offcut: 30, onHand: 140, reorderLevel: 100, cost: 320, status: "ok" },
  { name: "SS Handles & Hardware", unit: "pcs", stockIn: 2800, used: 2100, offcut: 0, onHand: 700, reorderLevel: 400, cost: 45, status: "ok" },
  { name: "Fabric — Grey Linen", unit: "metres", stockIn: 420, used: 380, offcut: 12, onHand: 28, reorderLevel: 80, cost: 650, status: "critical" }
];

const TRANSACTIONS_INIT: Transaction[] = [
  { time: "09:14 AM", material: "Marine Ply (19mm)", type: "used", qty: "12 sheets", order: "ORD-2847", by: "Unit 3" },
  { time: "08:52 AM", material: "Burma Teak Planks", type: "used", qty: "140 sq ft", order: "ORD-2844", by: "Unit 1" },
  { time: "08:30 AM", material: "European Oak Veneer", type: "received", qty: "200 sq ft", order: "PO-441", by: "Receiving" },
  { time: "Yesterday", material: "Upholstery Foam", type: "offcut", qty: "8 m²", order: "ORD-2839", by: "Unit 2" },
  { time: "Yesterday", material: "SS Handles", type: "used", qty: "240 pcs", order: "ORD-2851", by: "Unit 4" }
];

const BOM_VARIANCES = [
  { order: "ORD-2847", item: "Burma Teak", expected: "280 sq ft", actual: "340 sq ft", variance: "+21%", impact: "₹10,800 over budget" },
  { order: "ORD-2844", item: "Marine Ply", expected: "18 sheets", actual: "23 sheets", variance: "+28%", impact: "₹6,000 over budget" }
];

type ImportStatus = { type: "success"; count: number } | { type: "error"; message: string } | null;

function StatusDot({ status }: { status: string }) {
  if (status === "critical") return <span className="inline-flex items-center gap-1 text-xs text-red-600 font-medium"><span className="w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse" />Critical</span>;
  if (status === "warning") return <span className="inline-flex items-center gap-1 text-xs text-amber-600 font-medium"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />Low Stock</span>;
  return <span className="inline-flex items-center gap-1 text-xs text-emerald-600 font-medium"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />OK</span>;
}

export default function MaterialsPage() {
  const [materials, setMaterials] = useState<Material[]>(MATERIALS_INIT);
  const [transactions, setTransactions] = useState<Transaction[]>(TRANSACTIONS_INIT);
  const [modalOpen, setModalOpen] = useState(false);
  const [txForm, setTxForm] = useState({ material: MATERIALS_INIT[0].name, type: "used" as "used" | "received" | "offcut", qty: "", order: "", by: "" });
  const [txError, setTxError] = useState("");
  const [txSuccess, setTxSuccess] = useState(false);
  const [importStatus, setImportStatus] = useState<ImportStatus>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const atRisk = materials.filter(m => m.status !== "ok").length;
  const totalWaste = materials.reduce((s, m) => s + m.offcut, 0);
  const wasteValue = materials.reduce((s, m) => s + m.offcut * m.cost, 0);
  const selectedMaterial = materials.find(m => m.name === txForm.material) ?? materials[0];

  function exportCSV() {
    const headers = ["Material", "Unit", "Stock In", "Used", "Offcut", "On Hand", "Reorder Level", "Cost (₹)", "Status"];
    const rows = materials.map(m => [m.name, m.unit, String(m.stockIn), String(m.used), String(m.offcut), String(m.onHand), String(m.reorderLevel), String(m.cost), m.status]);
    const csv = [headers, ...rows].map(r => r.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "materials-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (fileInputRef.current) fileInputRef.current.value = "";
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setImportStatus({ type: "error", message: "Only .csv files are supported" });
      setTimeout(() => setImportStatus(null), 4000);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = (ev.target?.result as string) ?? "";
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) { setImportStatus({ type: "error", message: "CSV has no data rows" }); setTimeout(() => setImportStatus(null), 4000); return; }
        const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, "").toLowerCase().trim());
        const nameIdx    = headers.findIndex(h => h === "material" || h === "name");
        const unitIdx    = headers.findIndex(h => h === "unit");
        const stockIdx   = headers.findIndex(h => h.includes("stock"));
        const usedIdx    = headers.findIndex(h => h === "used");
        const offcutIdx  = headers.findIndex(h => h === "offcut");
        const onHandIdx  = headers.findIndex(h => h.includes("on hand") || h === "onhand");
        const reorderIdx = headers.findIndex(h => h.includes("reorder"));
        const costIdx    = headers.findIndex(h => h.includes("cost"));
        if (nameIdx === -1) { setImportStatus({ type: "error", message: 'CSV must have a "Material" column' }); setTimeout(() => setImportStatus(null), 4000); return; }
        const imported: Material[] = lines.slice(1).map(line => {
          const cols = parseCSVLine(line).map(c => c.replace(/^"|"$/g, ""));
          const onHand = onHandIdx >= 0 ? (parseInt(cols[onHandIdx], 10) || 0) : 0;
          const reorder = reorderIdx >= 0 ? (parseInt(cols[reorderIdx], 10) || 50) : 50;
          const status = onHand <= 0 ? "critical" : onHand <= reorder * 0.5 ? "critical" : onHand <= reorder ? "warning" : "ok";
          return {
            name:         cols[nameIdx]   ?? "Unknown Material",
            unit:         unitIdx >= 0    ? cols[unitIdx] ?? "units" : "units",
            stockIn:      stockIdx >= 0   ? (parseInt(cols[stockIdx], 10) || 0) : 0,
            used:         usedIdx >= 0    ? (parseInt(cols[usedIdx], 10) || 0) : 0,
            offcut:       offcutIdx >= 0  ? (parseInt(cols[offcutIdx], 10) || 0) : 0,
            onHand,
            reorderLevel: reorder,
            cost:         costIdx >= 0    ? (parseInt(cols[costIdx].replace(/[^\d]/g, ""), 10) || 0) : 0,
            status,
          };
        });
        setMaterials(prev => [...imported, ...prev]);
        setImportStatus({ type: "success", count: imported.length });
        setTimeout(() => setImportStatus(null), 4000);
      } catch {
        setImportStatus({ type: "error", message: "Failed to parse CSV" });
        setTimeout(() => setImportStatus(null), 4000);
      }
    };
    reader.readAsText(file);
  }

  function closeModal() {
    setModalOpen(false);
    setTxForm({ material: MATERIALS_INIT[0].name, type: "used", qty: "", order: "", by: "" });
    setTxError("");
    setTxSuccess(false);
  }

  function submitTransaction() {
    const qty = Number(txForm.qty);
    if (!txForm.qty || isNaN(qty) || qty <= 0) { setTxError("Enter a valid quantity greater than zero."); return; }
    const qtyStr = `${txForm.qty} ${selectedMaterial.unit}`;
    const orderStr = txForm.order || (txForm.type === "received" ? "PO-????" : "ORD-????");
    const now = new Date().toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
    setMaterials(prev => prev.map(m => {
      if (m.name !== txForm.material) return m;
      const onHand = txForm.type === "received" ? m.onHand + qty : Math.max(0, m.onHand - qty);
      const status = onHand <= 0 ? "critical" : onHand <= m.reorderLevel * 0.5 ? "critical" : onHand <= m.reorderLevel ? "warning" : "ok";
      return { ...m, onHand, status, stockIn: txForm.type === "received" ? m.stockIn + qty : m.stockIn, used: txForm.type === "used" ? m.used + qty : m.used, offcut: txForm.type === "offcut" ? m.offcut + qty : m.offcut };
    }));
    setTransactions(prev => [{ time: now, material: txForm.material, type: txForm.type, qty: qtyStr, order: orderStr, by: txForm.by || "—" }, ...prev]);
    setTxSuccess(true);
    setTimeout(closeModal, 1500);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Material Yield Tracker</h1>
          <p className="text-sm text-slate-500 mt-0.5">BOM compliance · offcut management · procurement alerts</p>
        </div>
        <div className="flex items-center gap-2">
          <input ref={fileInputRef} type="file" accept=".csv" className="hidden" onChange={handleImport} />
          <button
            onClick={() => fileInputRef.current?.click()}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Upload className="w-3.5 h-3.5" /> Import
          </button>
          <button
            onClick={exportCSV}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors"
          >
            <Download className="w-3.5 h-3.5" /> Export
          </button>
          <button onClick={() => setModalOpen(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "#1d4ed8" }}>
            + Log Transaction
          </button>
        </div>
      </div>

      {importStatus && (
        <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${importStatus.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {importStatus.type === "success"
            ? <><CheckCircle className="w-4 h-4 shrink-0" /> {importStatus.count} material{importStatus.count !== 1 ? "s" : ""} imported successfully</>
            : <><AlertCircle className="w-4 h-4 shrink-0" /> {importStatus.message}</>}
        </div>
      )}

      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderTop: atRisk > 0 ? "3px solid #f43f5e" : undefined }}>
          <div className="kpi-label">Materials at Risk</div>
          <div className="kpi-value mt-1.5" style={{ color: atRisk > 0 ? "#dc2626" : "#059669" }}>{atRisk}</div>
          <div className="kpi-delta down mt-1.5">{atRisk} items need reorder</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Offcut This Month</div>
          <div className="kpi-value mt-1.5">{totalWaste.toLocaleString()} units</div>
          <div className="kpi-delta neutral mt-1.5">Waste value: ₹{(wasteValue / 1000).toFixed(1)}k</div>
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Material Yield</div>
          <div className="kpi-value mt-1.5">82.4%</div>
          <div className="kpi-delta up mt-1.5">↑ +2.1% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">BOM Variances</div>
          <div className="kpi-value mt-1.5" style={{ color: BOM_VARIANCES.length > 0 ? "#d97706" : "#059669" }}>{BOM_VARIANCES.length}</div>
          <div className="kpi-delta down mt-1.5">Orders over-consuming materials</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <h3 className="card-title mb-4">Inventory & Yield</h3>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-100">
                  {["Material", "Unit", "Stock In", "Used", "Offcut", "On Hand", "Status"].map(h => (
                    <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {materials.map((m, i) => (
                  <tr key={i} className={`border-b border-slate-50 ${m.status === "critical" ? "bg-red-50" : m.status === "warning" ? "bg-amber-50" : "hover:bg-slate-50"} transition-colors`}>
                    <td className="py-2.5 px-2 font-medium text-slate-800">{m.name}</td>
                    <td className="py-2.5 px-2 text-xs text-slate-500">{m.unit}</td>
                    <td className="py-2.5 px-2 text-slate-600">{m.stockIn.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-slate-600">{m.used.toLocaleString()}</td>
                    <td className="py-2.5 px-2 text-amber-600 font-medium">{m.offcut.toLocaleString()}</td>
                    <td className="py-2.5 px-2">
                      <span className={`font-bold ${m.onHand <= m.reorderLevel ? "text-red-600" : "text-slate-700"}`}>{m.onHand.toLocaleString()}</span>
                      <span className="text-xs text-slate-400 ml-1">(min {m.reorderLevel})</span>
                    </td>
                    <td className="py-2.5 px-2"><StatusDot status={m.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="flex flex-col gap-4">
          {BOM_VARIANCES.length > 0 && (
            <div className="card" style={{ borderColor: "#fde68a", borderWidth: 1 }}>
              <div className="flex items-center gap-2 mb-3">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                <h3 className="card-title mb-0">BOM Variances</h3>
              </div>
              {BOM_VARIANCES.map((v, i) => (
                <div key={i} className="p-2.5 mb-2 rounded-lg bg-amber-50 border border-amber-100">
                  <div className="text-xs font-semibold text-amber-800">{v.order} — {v.item}</div>
                  <div className="text-xs text-amber-600 mt-0.5">Expected {v.expected} · Actual {v.actual}</div>
                  <div className="flex justify-between mt-1">
                    <span className="text-xs font-bold text-red-600">{v.variance}</span>
                    <span className="text-xs text-red-500">{v.impact}</span>
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="card flex-1">
            <div className="flex items-center gap-2 mb-3">
              <Package className="w-4 h-4 text-blue-500" />
              <h3 className="card-title mb-0">Recent Transactions</h3>
            </div>
            <div className="space-y-2.5">
              {transactions.slice(0, 8).map((t, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <div className={`w-2 h-2 rounded-full mt-1.5 shrink-0 ${t.type === "received" ? "bg-emerald-500" : t.type === "offcut" ? "bg-amber-400" : "bg-blue-500"}`} />
                  <div className="flex-1 min-w-0">
                    <div className="text-xs font-medium text-slate-700">{t.material}</div>
                    <div className="text-xs text-slate-400">{t.qty} · {t.order} · {t.by}</div>
                  </div>
                  <span className="text-xs text-slate-400 shrink-0">{t.time}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Log Transaction Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-800 text-base">Log Transaction</h2>
                <p className="text-xs text-slate-400 mt-0.5">Record material movement in or out of inventory</p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600"><X className="w-5 h-5" /></button>
            </div>

            {txSuccess ? (
              <div className="px-6 py-12 text-center">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="font-semibold text-emerald-700 text-sm">Transaction logged successfully</div>
                <div className="text-xs text-slate-400 mt-1">Inventory updated</div>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Material</label>
                  <select className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 bg-white" value={txForm.material} onChange={e => setTxForm(f => ({ ...f, material: e.target.value }))}>
                    {materials.map(m => <option key={m.name} value={m.name}>{m.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Transaction Type</label>
                  <div className="grid grid-cols-3 gap-2">
                    {(["used", "received", "offcut"] as const).map(t => (
                      <button key={t} onClick={() => setTxForm(f => ({ ...f, type: t }))} className={`py-2.5 rounded-lg border-2 text-sm font-semibold capitalize transition-all ${txForm.type === t ? t === "used" ? "border-blue-500 bg-blue-50 text-blue-700" : t === "received" ? "border-emerald-500 bg-emerald-50 text-emerald-700" : "border-amber-500 bg-amber-50 text-amber-700" : "border-slate-200 text-slate-500 hover:border-slate-300"}`}>{t}</button>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Quantity <span className="font-normal text-slate-400">({selectedMaterial.unit})</span></label>
                  <input type="number" min="0" className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100" placeholder={`Enter quantity in ${selectedMaterial.unit}`} value={txForm.qty} onChange={e => setTxForm(f => ({ ...f, qty: e.target.value }))} />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">{txForm.type === "received" ? "PO Reference" : "Order Reference"}</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400" placeholder={txForm.type === "received" ? "PO-XXX" : "ORD-XXXX"} value={txForm.order} onChange={e => setTxForm(f => ({ ...f, order: e.target.value }))} />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Production Unit</label>
                    <input className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400" placeholder="e.g. Unit 1, Receiving" value={txForm.by} onChange={e => setTxForm(f => ({ ...f, by: e.target.value }))} />
                  </div>
                </div>
                <div className="p-3 rounded-lg bg-slate-50 border border-slate-100">
                  <div className="flex justify-between text-xs">
                    <span className="text-slate-500">Current on-hand:</span>
                    <span className={`font-semibold ${selectedMaterial.onHand <= selectedMaterial.reorderLevel ? "text-red-600" : "text-slate-700"}`}>{selectedMaterial.onHand.toLocaleString()} {selectedMaterial.unit}</span>
                  </div>
                  <div className="flex justify-between text-xs mt-1">
                    <span className="text-slate-500">Reorder level:</span>
                    <span className="text-slate-600">{selectedMaterial.reorderLevel.toLocaleString()} {selectedMaterial.unit}</span>
                  </div>
                </div>
                {txError && <p className="text-xs text-red-600 font-medium">{txError}</p>}
                <div className="flex gap-3 pt-1">
                  <button onClick={closeModal} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">Cancel</button>
                  <button onClick={submitTransaction} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "#1d4ed8" }}>Log Transaction</button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
