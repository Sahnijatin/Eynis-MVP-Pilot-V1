import Link from "next/link";
import { AlertTriangle, ChevronRight, ClipboardList, Calculator, Wrench } from "lucide-react";
import { SmartInsights } from "./smart-insights";
import { fetchOrders, fetchQuotes, fetchInventory, fetchInventoryYield, fetchDashboardData } from "../../lib/data";

// Maintenance/downtime taxonomy (manufacturing pack, #165), in the order shown.
const MAINT_CATEGORIES: Array<{ key: string; label: string; color: string }> = [
  { key: "downtime", label: "Downtime", color: "#dc2626" },
  { key: "maintenance", label: "Maintenance", color: "#f59e0b" },
  { key: "quality", label: "Quality", color: "#8b5cf6" },
  { key: "safety", label: "Safety", color: "#0ea5e9" },
];

// Manufacturing Command Centre (Phase 7) — every number traces to a DB row:
// orders from the fulfillment pipeline, quotes awaiting decision, material
// alerts from live inventory, waste ratio from the stock ledger.

const STAGE_META: Array<{ id: string; label: string; color: string }> = [
  { id: "new", label: "New Orders", color: "#6366f1" },
  { id: "production", label: "In Production", color: "#f59e0b" },
  { id: "qc", label: "QC Review", color: "#8b5cf6" },
  { id: "dispatch", label: "Ready to Dispatch", color: "#10b981" },
];

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN", { minimumFractionDigits: Math.round(paise) % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
const lakh = (paise: number) => {
  const inr = paise / 100;
  return inr >= 100000 ? `₹${(inr / 100000).toFixed(1)}L` : rupees(paise);
};

export async function ManufacturingDashboard() {
  const [orders, quotes, inventory, yieldData, dash] = await Promise.all([
    fetchOrders(), fetchQuotes(), fetchInventory(), fetchInventoryYield(), fetchDashboardData(),
  ]);

  // Maintenance/downtime signal (#165) — real ServiceRequests from the webhook/CSV
  // intake doors, surfaced through the generic dashboard endpoints.
  const m = dash.overview?.metrics;
  const byCategory = dash.queueSummary?.byCategory ?? {};
  const downtimeOpen = byCategory.downtime ?? 0;
  const maintTotalOpen = MAINT_CATEGORIES.reduce((s, c) => s + (byCategory[c.key] ?? 0), 0);
  const maxCat = Math.max(1, ...MAINT_CATEGORIES.map((c) => byCategory[c.key] ?? 0));

  const stageOf = (id: string) => orders.summary.find((s) => s.stage === id);
  const inProductionValue = stageOf("production")?.valuePaise ?? 0;
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
      <SmartInsights industry="manufacturing" />

      {/* Maintenance & Downtime — real signal from webhook/CSV intake (#165) */}
      <div className="flex items-center gap-2 mb-3">
        <Wrench className="w-4 h-4 text-fg-muted" />
        <h3 className="card-title mb-0">Maintenance &amp; Downtime</h3>
      </div>
      <div className="kpi-grid mb-4">
        <div className="card" style={{ borderTop: downtimeOpen > 0 ? "3px solid #dc2626" : undefined }}>
          <div className="kpi-label">Downtime Events</div>
          <div className="kpi-value mt-1.5">{downtimeOpen}</div>
          <div className="kpi-delta neutral mt-1.5">lines currently affected</div>
        </div>
        <div className="card">
          <div className="kpi-label">Open Work Orders</div>
          <div className="kpi-value mt-1.5">{m?.openCount ?? maintTotalOpen}</div>
          <div className="kpi-delta neutral mt-1.5">{m?.resolvedTodayCount ?? 0} resolved today</div>
        </div>
        <div className="card" style={{ borderTop: (m?.slaBreachedOpenCount ?? 0) > 0 ? "3px solid #dc2626" : undefined }}>
          <div className="kpi-label">SLA Breached</div>
          <div className="kpi-value mt-1.5">{m?.slaBreachedOpenCount ?? 0}</div>
          <div className="kpi-delta neutral mt-1.5">past response deadline</div>
        </div>
        <div className="card" style={{ borderTop: (m?.escalatedOpenCount ?? 0) > 0 ? "3px solid #f59e0b" : undefined }}>
          <div className="kpi-label">Escalations</div>
          <div className="kpi-value mt-1.5">{m?.escalatedOpenCount ?? 0}</div>
          <div className="kpi-delta neutral mt-1.5">needs a supervisor</div>
        </div>
      </div>

      <div className="card mb-5">
        <div className="flex items-center justify-between mb-3">
          <h3 className="card-title mb-0">Open by Category</h3>
          <Link href="/queue" className="inline-flex items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg">
            <ClipboardList className="w-4 h-4" /> Maintenance queue <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
        {maintTotalOpen === 0 ? (
          <div className="py-4 text-sm text-fg-subtle">No open maintenance or downtime events — signal arrives via the webhook/CSV/email intake doors.</div>
        ) : (
          <div className="space-y-2">
            {MAINT_CATEGORIES.map((c) => {
              const n = byCategory[c.key] ?? 0;
              return (
                <div key={c.key} className="flex items-center gap-3">
                  <div className="w-24 text-sm text-fg-muted">{c.label}</div>
                  <div className="flex-1 h-2.5 rounded-full bg-surface-inset overflow-hidden">
                    <div className="h-full rounded-full" style={{ width: `${(n / maxCat) * 100}%`, background: c.color }} />
                  </div>
                  <div className="w-8 text-right text-sm font-semibold text-fg">{n}</div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* KPI row — live aggregates */}
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Open Order Book</div>
          <div className="kpi-value mt-1.5">{lakh(openValue)}</div>
          <div className="kpi-delta neutral mt-1.5">{openOrders.length} orders in flight</div>
        </div>
        <div className="card">
          <div className="kpi-label">In Production</div>
          <div className="kpi-value mt-1.5">{lakh(inProductionValue)}</div>
          <div className="kpi-delta neutral mt-1.5">{stageOf("production")?.count ?? 0} orders on the floor</div>
        </div>
        <div className="card">
          <div className="kpi-label">Quotes Awaiting Decision</div>
          <div className="kpi-value mt-1.5">{sentQuotes.length}</div>
          <div className="kpi-delta neutral mt-1.5">{lakh(sentValue)} potential</div>
        </div>
        <div className="card" style={{ borderTop: reorderAlerts.length > 0 ? "3px solid #f59e0b" : undefined }}>
          <div className="kpi-label">Material Alerts</div>
          <div className="kpi-value mt-1.5">{reorderAlerts.length}</div>
          <div className="kpi-delta neutral mt-1.5">{wastePct > 0 ? `${wastePct}% waste ratio (90d)` : "No waste logged yet"}</div>
        </div>
      </div>

      {/* Pipeline by stage */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-2">
          <h3 className="card-title">Production Pipeline</h3>
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
            <ClipboardList className="w-4 h-4" /> Open the order board <ChevronRight className="w-3.5 h-3.5" />
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

      {/* Material alerts */}
      <div className="card">
        <div className="flex items-center gap-2 mb-3">
          <AlertTriangle className="w-4 h-4 text-warn" />
          <h3 className="card-title mb-0">Material Reorder Alerts</h3>
        </div>
        {reorderAlerts.length === 0 ? (
          <div className="py-4 text-sm text-fg-subtle">All materials above reorder level.</div>
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
          <Calculator className="w-4 h-4" /> Build a quote <ChevronRight className="w-3.5 h-3.5" />
        </Link>
      </div>
    </div>
  );
}
