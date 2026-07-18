import Link from "next/link";
import { AlertTriangle, ChevronRight, ShoppingCart, Calculator } from "lucide-react";
import { SmartInsights } from "./smart-insights";
import { fetchOrders, fetchQuotes, fetchInventory, fetchInventoryYield } from "../../lib/data";

// F&B Command Centre (Wave 5) — real data on the same quote → order → inventory
// spine Manufacturing uses: catering/bulk orders from accepted quotes, catering
// quotes awaiting a decision, and ingredient stock/waste from live inventory.
// (Table-service/POS metrics need a POS/Menu source — see /menu.)

const STAGE_META: Array<{ id: string; label: string; color: string }> = [
  { id: "new", label: "New Orders", color: "#6366f1" },
  { id: "production", label: "In Kitchen", color: "#f59e0b" },
  { id: "qc", label: "Plating / QC", color: "#8b5cf6" },
  { id: "dispatch", label: "Ready to Serve", color: "var(--ok-text)" },
];

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN")}`;
const lakh = (paise: number) => {
  const inr = paise / 100;
  return inr >= 100000 ? `₹${(inr / 100000).toFixed(1)}L` : rupees(paise);
};

export async function FnbDashboard() {
  const [orders, quotes, inventory, yieldData] = await Promise.all([
    fetchOrders(), fetchQuotes(), fetchInventory(), fetchInventoryYield(),
  ]);

  const stageOf = (id: string) => orders.summary.find((s) => s.stage === id);
  const inKitchenValue = stageOf("production")?.valuePaise ?? 0;
  const openOrders = orders.items.filter((o) => o.stage !== "delivered");
  const openValue = openOrders.reduce((s, o) => s + o.valuePaise, 0);
  const sentQuotes = quotes.items.filter((q) => q.status === "sent");
  const sentValue = sentQuotes.reduce((s, q) => s + (Number(q.totalPaise) || 0), 0);
  const reorderAlerts = inventory.items.filter((i) => i.status !== "ok");
  const consumed = yieldData.items.reduce((s, r) => s + r.usedQty + r.wasteQty, 0);
  const wasted = yieldData.items.reduce((s, r) => s + r.wasteQty, 0);
  const wastePct = consumed > 0 ? Math.round((wasted / consumed) * 1000) / 10 : 0;
  const topOrders = [...openOrders].sort((a, b) => b.valuePaise - a.valuePaise).slice(0, 5);

  return (
    <div>
      <SmartInsights industry="fnb" />

      {/* KPI row — live aggregates */}
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Open Order Book</div>
          <div className="kpi-value mt-1.5">{lakh(openValue)}</div>
          <div className="kpi-delta neutral mt-1.5">{openOrders.length} orders in flight</div>
        </div>
        <div className="card">
          <div className="kpi-label">In Kitchen</div>
          <div className="kpi-value mt-1.5">{lakh(inKitchenValue)}</div>
          <div className="kpi-delta neutral mt-1.5">{stageOf("production")?.count ?? 0} orders being prepared</div>
        </div>
        <div className="card">
          <div className="kpi-label">Quotes Awaiting Decision</div>
          <div className="kpi-value mt-1.5">{sentQuotes.length}</div>
          <div className="kpi-delta neutral mt-1.5">{lakh(sentValue)} potential</div>
        </div>
        <div className="card" style={{ borderTop: reorderAlerts.length > 0 ? "3px solid #f59e0b" : undefined }}>
          <div className="kpi-label">Ingredient Alerts</div>
          <div className="kpi-value mt-1.5">{reorderAlerts.length}</div>
          <div className="kpi-delta neutral mt-1.5">{wastePct > 0 ? `${wastePct}% waste ratio (90d)` : "No waste logged yet"}</div>
        </div>
      </div>

      {/* Pipeline by stage */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <h3 className="card-title">Order Pipeline</h3>
          <div className="grid grid-cols-4 gap-3 mt-2">
            {STAGE_META.map((s) => {
              const row = stageOf(s.id);
              return (
                <div key={s.id} className="rounded-lg p-3" style={{ background: s.color + "10", borderTop: `3px solid ${s.color}` }}>
                  <div className="text-2xl font-bold text-fg">{row?.count ?? 0}</div>
                  <div className="text-xs text-fg-muted mt-0.5">{s.label}</div>
                  <div className="text-xs font-medium mt-1" style={{ color: s.color }}>{lakh(row?.valuePaise ?? 0)}</div>
                </div>
              );
            })}
          </div>
          <Link href="/orders" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg">
            <ShoppingCart className="w-4 h-4" /> Open the order board <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>

        <div className="card">
          <h3 className="card-title">Top Open Orders</h3>
          {topOrders.length === 0 ? (
            <div className="py-6 text-center text-sm text-fg-subtle">No open orders — accepted quotes land here.</div>
          ) : (
            <div className="space-y-2">
              {topOrders.map((o) => (
                <div key={o.id} className="flex items-center justify-between text-sm border-b border-line pb-2 last:border-0">
                  <div>
                    <div className="font-medium text-fg">{o.companyName ?? o.contactName ?? o.title}</div>
                    <div className="text-xs text-fg-subtle font-mono">{o.number}</div>
                  </div>
                  <div className="text-right">
                    <div className="font-semibold">{lakh(o.valuePaise)}</div>
                    <div className="text-xs text-fg-subtle">{o.stage}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Ingredient alerts */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-warn" />
          <h3 className="card-title mb-0">Ingredient Reorder Alerts</h3>
        </div>
        {reorderAlerts.length === 0 ? (
          <div className="py-4 text-sm text-fg-subtle">All ingredients above reorder level.</div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {reorderAlerts.slice(0, 6).map((i) => (
              <div key={i.id} className="rounded-lg border border-warn-border bg-warn-bg px-3 py-2 text-sm">
                <div className="font-medium text-warn">{i.name}</div>
                <div className="text-xs text-warn">{i.stock} {i.unit} on hand · reorder at {i.reorderLevel}</div>
              </div>
            ))}
          </div>
        )}
        <Link href="/quotes" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg">
          <Calculator className="w-4 h-4" /> Build a catering quote <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
