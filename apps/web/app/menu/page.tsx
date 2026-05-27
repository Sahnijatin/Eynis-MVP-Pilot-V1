import { TrendingUp, TrendingDown, AlertCircle, Star, Lightbulb, Flame, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

const MENU_ITEMS = [
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

export default function MenuPage() {
  const avgMargin = Math.round(MENU_ITEMS.reduce((s, i) => s + i.margin, 0) / MENU_ITEMS.length);
  const topItem = [...MENU_ITEMS].sort((a, b) => b.orders30d - a.orders30d)[0];

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Menu & Pricing Intelligence</h1>
          <p className="text-sm text-slate-500 mt-0.5">Item performance · margin tracking · AI suggestions</p>
        </div>
        <button className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: "#ea580c" }}>
          + Add Item
        </button>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Avg. Margin</div>
          <div className="kpi-value mt-1.5">{avgMargin}%</div>
          <div className="kpi-delta up mt-1.5">↑ +3% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Menu Items</div>
          <div className="kpi-value mt-1.5">{MENU_ITEMS.length}</div>
          <div className="kpi-delta neutral mt-1.5">{MENU_ITEMS.filter(i => i.tag === "review").length} flagged for review</div>
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
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {["Item", "Category", "Price", "Margin", "Orders (30d)", "Rating", "Trend"].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MENU_ITEMS.map((item, i) => (
                <tr key={i} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="py-2.5 px-2">
                    <span className="font-medium text-slate-800">{item.name}</span>
                    {item.tag === "bestseller" && <span className="ml-2 badge" style={{ background: "#fef3c7", color: "#d97706" }}>⭐ Top</span>}
                    {item.tag === "slow" && <span className="ml-2 badge" style={{ background: "#fee2e2", color: "#dc2626" }}>Slow</span>}
                    {item.tag === "promoted" && <span className="ml-2 badge" style={{ background: "#eff6ff", color: "#1d4ed8" }}>Promoted</span>}
                    {item.tag === "review" && <span className="ml-2 badge" style={{ background: "#fef3c7", color: "#d97706" }}>Review</span>}
                  </td>
                  <td className="py-2.5 px-2 text-xs text-slate-500">{item.category}</td>
                  <td className="py-2.5 px-2 font-medium">₹{item.price}</td>
                  <td className="py-2.5 px-2">
                    <span className={`font-bold ${item.margin < 50 ? "text-red-600" : item.margin >= 75 ? "text-emerald-600" : "text-amber-600"}`}>{item.margin}%</span>
                  </td>
                  <td className="py-2.5 px-2 text-slate-600">{item.orders30d}</td>
                  <td className="py-2.5 px-2">
                    <span className="flex items-center gap-1 text-sm"><Star className="w-3.5 h-3.5 text-amber-400" />{item.rating}</span>
                  </td>
                  <td className="py-2.5 px-2">
                    {item.trend === "up" ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
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
    </div>
  );
}
