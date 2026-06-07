import Link from "next/link";
import { ShoppingCart, TrendingUp, ChevronRight, AlertCircle } from "lucide-react";
import { SmartInsights } from "./smart-insights";

export function FnbDashboard() {
  return (
    <div>
      <SmartInsights industry="fnb" />
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Revenue Today</div>
          <div className="kpi-value mt-1.5">₹38,200</div>
          <div className="kpi-delta up mt-1.5">↑ +12% vs yesterday</div>
        </div>
        <div className="card">
          <div className="kpi-label">Live Orders</div>
          <div className="kpi-value mt-1.5">14</div>
          <div className="kpi-delta neutral mt-1.5">Avg. prep: 18 min</div>
        </div>
        <div className="card">
          <div className="kpi-label">Tables Occupied</div>
          <div className="kpi-value mt-1.5">18 / 24</div>
          <div className="kpi-delta up mt-1.5">75% occupancy</div>
        </div>
        <div className="card" style={{ borderTop: "3px solid #f59e0b" }}>
          <div className="kpi-label">Inventory Alerts</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>3</div>
          <div className="kpi-delta down mt-1.5">Low stock items</div>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><ShoppingCart className="w-4 h-4 text-orange-600" /><h3 className="card-title mb-0">Live Orders</h3></div>
            <Link href="/orders" className="text-xs text-orange-600 font-medium flex items-center gap-1 hover:underline">View all <ChevronRight className="w-3 h-3" /></Link>
          </div>
          <div className="space-y-2">
            {[
              { table: "T-4", items: "Truffle Risotto × 2, Burrata × 1", time: "8 min ago", status: "preparing" },
              { table: "T-9", items: "Lamb Rack × 1, Cocktail × 2", time: "3 min ago", status: "new" },
              { table: "T-12", items: "Panna Cotta × 3", time: "12 min ago", status: "ready" }
            ].map((o, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 rounded-lg bg-slate-50">
                <span className="font-bold text-orange-600 w-10">{o.table}</span>
                <span className="flex-1 text-sm text-slate-700">{o.items}</span>
                <span className="text-xs text-slate-500">{o.time}</span>
                <span className={`badge text-xs ${o.status === "ready" ? "bg-green-100 text-green-700" : o.status === "new" ? "bg-blue-100 text-blue-700" : "bg-amber-100 text-amber-700"}`}>{o.status}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <div className="flex items-center gap-2 mb-3"><TrendingUp className="w-4 h-4 text-orange-500" /><h3 className="card-title mb-0">Top Sellers Today</h3></div>
          {[{ name: "Cocktail of the Week", qty: 24 }, { name: "Truffle Risotto", qty: 18 }, { name: "Burrata Salad", qty: 15 }].map((i, idx) => (
            <div key={idx} className="flex justify-between py-2 border-b border-slate-50 last:border-0 text-sm">
              <span className="text-slate-700">{i.name}</span><span className="font-semibold text-slate-800">{i.qty} orders</span>
            </div>
          ))}
          <div className="mt-3 pt-2 border-t">
            <div className="alert-card warning">
              <AlertCircle className="w-4 h-4 text-amber-500 shrink-0" />
              <div className="text-xs text-amber-700">Truffle Oil running low — reorder needed</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
