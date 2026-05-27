import { AlertTriangle, Package } from "lucide-react";

export const dynamic = "force-dynamic";

const INVENTORY = [
  { item: "Truffle Oil (250ml)", category: "Specialty", stock: 4, unit: "bottles", reorder: 6, cost: 1200, status: "critical" },
  { item: "Fresh Burrata", category: "Dairy", stock: 12, unit: "pcs", reorder: 8, cost: 280, status: "ok" },
  { item: "Lamb Rack (kg)", category: "Meat", stock: 3.2, unit: "kg", reorder: 5, cost: 1800, status: "warning" },
  { item: "Cocktail Spirits Mix", category: "Beverages", stock: 24, unit: "bottles", reorder: 12, cost: 850, status: "ok" },
  { item: "Fresh Cream (litre)", category: "Dairy", stock: 8, unit: "litres", reorder: 10, cost: 85, status: "warning" },
  { item: "Truffle Pasta (500g)", category: "Dry Goods", stock: 18, unit: "packs", reorder: 10, cost: 340, status: "ok" }
];

export default function InventoryPage() {
  const atRisk = INVENTORY.filter(i => i.status !== "ok").length;
  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Inventory Management</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time stock levels · reorder alerts · waste tracking</p>
        </div>
        <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#ea580c" }}>+ Log Stock</button>
      </div>
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderTop: atRisk > 0 ? "3px solid #f43f5e" : undefined }}>
          <div className="kpi-label">Items at Risk</div>
          <div className="kpi-value mt-1.5" style={{ color: atRisk > 0 ? "#dc2626" : "#059669" }}>{atRisk}</div>
          <div className="kpi-delta down mt-1.5">Need reorder today</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total SKUs Tracked</div>
          <div className="kpi-value mt-1.5">{INVENTORY.length}</div>
          <div className="kpi-delta neutral mt-1.5">Across 4 categories</div>
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
            {INVENTORY.map((item, i) => (
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
    </div>
  );
}
