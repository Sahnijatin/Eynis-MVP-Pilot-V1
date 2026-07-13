"use client";
import { useState } from "react";
import { TrendingUp, TrendingDown, AlertCircle, Star, Lightbulb, Flame, AlertTriangle } from "lucide-react";
import { ImportExportButtons } from "../../components/ui/import-export-buttons";
import { Modal, TableEmpty } from "../../components/ds";
import { PreviewBanner } from "../../components/ui/preview-badge";

const CATEGORIES = ["Starters", "Mains", "Desserts", "Beverages", "Other"];

type MenuItem = {
  name: string; category: string; price: number; cost: number;
  margin: number; orders30d: number; rating: number; trend: string; tag: string;
};

const INITIAL_MENU: MenuItem[] = [
  { name: "Truffle Risotto", category: "Mains", price: 850, cost: 210, margin: 75, orders30d: 142, rating: 4.8, trend: "up", tag: "bestseller" },
  { name: "Burrata Salad", category: "Starters", price: 480, cost: 95, margin: 80, orders30d: 98, rating: 4.6, trend: "up", tag: "" },
  { name: "Lamb Rack", category: "Mains", price: 1450, cost: 680, margin: 53, orders30d: 34, rating: 4.4, trend: "down", tag: "slow" },
  { name: "Panna Cotta", category: "Desserts", price: 320, cost: 48, margin: 85, orders30d: 116, rating: 4.7, trend: "up", tag: "" },
  { name: "Cocktail of the Week", category: "Beverages", price: 550, cost: 95, margin: 83, orders30d: 204, rating: 4.5, trend: "up", tag: "promoted" },
  { name: "Seafood Platter", category: "Mains", price: 1800, cost: 920, margin: 49, orders30d: 18, rating: 3.9, trend: "down", tag: "review" }
];

const SUGGESTIONS = [
  { Icon: Lightbulb, text: "Lamb Rack orders dropped 40% this month. Consider seasonal promotion or recipe refresh.", type: "warning" },
  { Icon: Flame, text: "Cocktail of the Week drives highest repeat orders — expand to 3 rotating variants.", type: "opportunity" },
  { Icon: AlertTriangle, text: "Seafood Platter margin at 49% — below 50% floor. Review supplier pricing.", type: "alert" }
];

const EMPTY_FORM = { name: "", category: "Starters", price: "", cost: "", description: "" };

export default function MenuPage() {
  const [items, setItems] = useState<MenuItem[]>(INITIAL_MENU);
  const [showModal, setShowModal] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const avgMargin = Math.round(items.reduce((s, i) => s + i.margin, 0) / items.length);
  const topItem = [...items].sort((a, b) => b.orders30d - a.orders30d)[0];
  const computedMargin = form.price && form.cost
    ? Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100)
    : null;

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!form.name || !form.price || !form.cost) return;
    const margin = Math.round(((Number(form.price) - Number(form.cost)) / Number(form.price)) * 100);
    setItems(prev => [...prev, {
      name: form.name, category: form.category, price: Number(form.price),
      cost: Number(form.cost), margin, orders30d: 0, rating: 0, trend: "up", tag: ""
    }]);
    setForm(EMPTY_FORM);
    setShowModal(false);
  }

  return (
    <div>
      <PreviewBanner />
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Menu & Pricing Intelligence</h1>
          <p className="text-sm text-slate-500 mt-0.5">Item performance · margin tracking · AI suggestions</p>
        </div>
        <div className="flex items-center gap-2">
          <ImportExportButtons
            rows={items}
            columns={[
              { label: "Name",     value: "name" },
              { label: "Category", value: "category" },
              { label: "Price",    value: "price" },
              { label: "Cost",     value: "cost" },
              { label: "Margin",   value: "margin" },
              { label: "Orders 30d", value: "orders30d" },
              { label: "Rating",   value: "rating" },
            ]}
            fileBase="menu"
            accentColor="#ea580c"
            onImport={(rows) => {
              const next: MenuItem[] = rows.map(r => {
                const price = Number(r["Price"] ?? 0) || 0;
                const cost = Number(r["Cost"] ?? 0) || 0;
                const margin = price > 0 ? Math.round(((price - cost) / price) * 100) : 0;
                return {
                  name: r["Name"] ?? "",
                  category: CATEGORIES.includes(r["Category"]) ? r["Category"] : "Other",
                  price, cost, margin,
                  orders30d: Number(r["Orders 30d"] ?? 0) || 0,
                  rating: Number(r["Rating"] ?? 0) || 0,
                  trend: "up", tag: "",
                };
              }).filter(m => m.name);
              if (next.length) setItems(prev => [...next, ...prev]);
              return { count: next.length };
            }}
          />
          <button
            onClick={() => setShowModal(true)}
            className="px-4 py-2 rounded-lg text-sm font-semibold text-white"
            style={{ background: "#ea580c" }}
          >
            + Add Item
          </button>
        </div>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Avg. Margin</div>
          <div className="kpi-value mt-1.5">{avgMargin}%</div>
          <div className="kpi-delta up mt-1.5">↑ +3% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Menu Items</div>
          <div className="kpi-value mt-1.5">{items.length}</div>
          <div className="kpi-delta neutral mt-1.5">{items.filter(i => i.tag === "review").length} flagged for review</div>
        </div>
        <div className="card">
          <div className="kpi-label">Best Seller</div>
          <div className="kpi-value mt-1.5 text-base">{topItem.name}</div>
          <div className="kpi-delta up mt-1.5">{topItem.orders30d} orders / 30 days</div>
        </div>
        <div className="card">
          <div className="kpi-label">AI Suggestions</div>
          <div className="kpi-value mt-1.5">{SUGGESTIONS.length}</div>
          <div className="kpi-delta down mt-1.5">Action required</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <h3 className="card-title mb-4">Menu Performance</h3>
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  {["Item", "Category", "Price", "Margin", "Orders (30d)", "Rating", "Trend"].map(h => (
                    <th key={h}>{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {items.map((item, i) => (
                  <tr key={i}>
                    <td>
                      <span className="font-medium text-slate-800">{item.name}</span>
                      {item.tag === "bestseller" && <span className="ml-2 badge" style={{ background: "#fef3c7", color: "#d97706" }}>⭐ Top</span>}
                      {item.tag === "slow" && <span className="ml-2 badge" style={{ background: "#fee2e2", color: "#dc2626" }}>Slow</span>}
                      {item.tag === "promoted" && <span className="ml-2 badge" style={{ background: "#eff6ff", color: "#1d4ed8" }}>Promoted</span>}
                      {item.tag === "review" && <span className="ml-2 badge" style={{ background: "#fef3c7", color: "#d97706" }}>Review</span>}
                    </td>
                    <td className="text-xs text-slate-500">{item.category}</td>
                    <td className="font-medium">₹{item.price}</td>
                    <td>
                      <span className={`font-bold ${item.margin < 50 ? "text-red-600" : item.margin >= 75 ? "text-emerald-600" : "text-amber-600"}`}>{item.margin}%</span>
                    </td>
                    <td className="text-slate-600">{item.orders30d}</td>
                    <td>
                      {item.rating > 0
                        ? <span className="flex items-center gap-1 text-sm"><Star className="w-3.5 h-3.5 text-amber-400" />{item.rating}</span>
                        : <span className="text-xs text-slate-500">—</span>}
                    </td>
                    <td>
                      {item.trend === "up" ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                    </td>
                  </tr>
                ))}
                {items.length === 0 && (
                  <TableEmpty colSpan={7} icon="🍽️" title="No menu items yet" description="Add an item or import a menu to see performance." />
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <AlertCircle className="w-4 h-4 text-orange-500" />
            <h3 className="card-title mb-0">AI Suggestions</h3>
          </div>
          <div className="space-y-3">
            {SUGGESTIONS.map((s, i) => (
              <div key={i} className={`p-3 rounded-lg text-sm flex items-start gap-2 ${s.type === "alert" ? "bg-red-50 border border-red-100" : s.type === "warning" ? "bg-amber-50 border border-amber-100" : "bg-blue-50 border border-blue-100"}`}>
                <s.Icon className={`w-4 h-4 shrink-0 mt-0.5 ${s.type === "alert" ? "text-red-500" : s.type === "warning" ? "text-amber-500" : "text-blue-500"}`} />
                <span className={s.type === "alert" ? "text-red-700" : s.type === "warning" ? "text-amber-700" : "text-blue-700"}>{s.text}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {showModal && (
        <Modal title="Add Menu Item" onClose={() => { setShowModal(false); setForm(EMPTY_FORM); }}>
          <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Item Name *</label>
                <input
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                  placeholder="e.g. Grilled Salmon"
                  value={form.name}
                  onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
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
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Selling Price (₹) *</label>
                  <input
                    type="number" min="0"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="0"
                    value={form.price}
                    onChange={e => setForm(f => ({ ...f, price: e.target.value }))}
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Cost Price (₹) *</label>
                  <input
                    type="number" min="0"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                    placeholder="0"
                    value={form.cost}
                    onChange={e => setForm(f => ({ ...f, cost: e.target.value }))}
                    required
                  />
                </div>
              </div>
              {computedMargin !== null && (
                <div className={`text-sm px-3 py-2 rounded-lg font-semibold ${computedMargin < 50 ? "bg-red-50 text-red-700" : computedMargin >= 75 ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}>
                  Gross Margin: {computedMargin}%
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Description</label>
                <textarea
                  rows={2}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 resize-none"
                  placeholder="Optional description or notes"
                  value={form.description}
                  onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
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
                  Add to Menu
                </button>
              </div>
            </form>
        </Modal>
      )}
    </div>
  );
}
