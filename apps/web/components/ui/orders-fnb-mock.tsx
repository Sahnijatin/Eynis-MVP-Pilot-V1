"use client";

import { useState } from "react";
import { AlertTriangle, Truck, ChevronRight, TreePine, Wrench, Package } from "lucide-react";
import { ClientDetailPanel, type ClientDetailData } from "./client-detail-panel";
import { ImportExportButtons } from "./import-export-buttons";
import { TableEmpty } from "../ds";
import { PreviewBanner } from "./preview-badge";

const PIPELINE_STAGES = [
  { id: "new", label: "New Order", color: "#6366f1", count: 12, value: "₹18.4L" },
  { id: "production", label: "In Production", color: "#f59e0b", count: 18, value: "₹34.2L" },
  { id: "qc", label: "QC Review", color: "#8b5cf6", count: 8, value: "₹14.8L" },
  { id: "dispatch", label: "Ready to Dispatch", color: "#10b981", count: 6, value: "₹9.2L" },
  { id: "delivered", label: "Delivered", color: "#64748b", count: 34, value: "₹58.6L" }
];

const LIVE_ORDERS = [
  { id: "ORD-2847", client: "Sharma Interiors", sku: "Walnut Wardrobe × 4", value: "₹3,20,000", due: "2 Jun", stage: "production", priority: "high", daysLeft: 7 },
  { id: "ORD-2851", client: "Patel Architects", sku: "Oak Dining Table × 2", value: "₹1,85,000", due: "5 Jun", stage: "qc", priority: "normal", daysLeft: 10 },
  { id: "ORD-2839", client: "Kapoor Furnishings", sku: "Modular Sofa Set × 1", value: "₹4,50,000", due: "28 May", stage: "dispatch", priority: "urgent", daysLeft: 2 },
  { id: "ORD-2856", client: "Grandview Hotels", sku: "Executive Chairs × 40", value: "₹8,00,000", due: "12 Jun", stage: "new", priority: "normal", daysLeft: 17 },
  { id: "ORD-2844", client: "Mehta Residences", sku: "Custom Bookshelf × 3", value: "₹2,10,000", due: "30 May", stage: "production", priority: "high", daysLeft: 4 },
  { id: "ORD-2860", client: "Azure Hospitality", sku: "Lobby Benches × 12", value: "₹5,40,000", due: "18 Jun", stage: "new", priority: "normal", daysLeft: 23 }
];

const BOTTLENECKS = [
  { Icon: TreePine, title: "Wood Finishing Unit — Backlog", desc: "8 orders waiting, capacity reached. Est. delay: 2 days", severity: "high" },
  { Icon: Wrench, title: "Upholstery Team Understaffed", desc: "3 workers on leave. 4 orders impacted.", severity: "medium" },
  { Icon: Package, title: "Teak Veneer Out of Stock", desc: "Reorder placed. ETA: 4 Jun. 2 orders at risk.", severity: "high" }
];

const VENDOR_SLIPS = [
  { vendor: "Rajasthan Timber Co.", item: "Burma Teak Planks", expected: "22 May", status: "3 days late", risk: "high" },
  { vendor: "Suri Hardware", item: "Hydraulic Hinges × 200", expected: "24 May", status: "1 day late", risk: "medium" }
];

function StageBadge({ stage }: { stage: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    new: { label: "New", color: "#6366f1", bg: "#ede9fe" },
    production: { label: "In Production", color: "#d97706", bg: "#fef3c7" },
    qc: { label: "QC Review", color: "#7c3aed", bg: "#f3e8ff" },
    dispatch: { label: "Ready to Dispatch", color: "#059669", bg: "#d1fae5" },
    delivered: { label: "Delivered", color: "#475569", bg: "#f1f5f9" }
  };
  const s = map[stage] ?? map.new;
  return <span className="badge" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function PriorityBadge({ priority }: { priority: string }) {
  if (priority === "urgent") return <span className="badge" style={{ background: "#fee2e2", color: "#dc2626" }}>URGENT</span>;
  if (priority === "high") return <span className="badge" style={{ background: "#fef3c7", color: "#d97706" }}>HIGH</span>;
  return <span className="badge" style={{ background: "#f1f5f9", color: "#64748b" }}>NORMAL</span>;
}

type LiveOrder = (typeof LIVE_ORDERS)[number];

function buildOrderDetail(o: LiveOrder): ClientDetailData {
  return {
    historyLabel: "Status Timeline",
    contact: {
      person: o.client,
      role: "Client",
      extras: [
        { label: "Order ID",   value: o.id },
        { label: "SKU",        value: o.sku },
        { label: "Value",      value: o.value },
        { label: "Due",        value: o.due },
        { label: "Days Left",  value: String(o.daysLeft) },
        { label: "Priority",   value: o.priority.toUpperCase() },
      ],
    },
    history: [
      { id: "evt-1", title: "Order received",   date: "Day 0",  status: "Done",  statusColor: "#059669", statusBg: "#d1fae5" },
      { id: "evt-2", title: "In production",    date: "Day 3",  status: o.stage === "new" ? "Upcoming" : "Done", statusColor: o.stage === "new" ? "#64748b" : "#059669", statusBg: o.stage === "new" ? "#f1f5f9" : "#d1fae5" },
      { id: "evt-3", title: "QC review",        date: "Day 7",  status: ["qc", "dispatch", "delivered"].includes(o.stage) ? "Done" : "Pending", statusColor: ["qc", "dispatch", "delivered"].includes(o.stage) ? "#059669" : "#d97706", statusBg: ["qc", "dispatch", "delivered"].includes(o.stage) ? "#d1fae5" : "#fef3c7" },
      { id: "evt-4", title: "Ready to dispatch",date: "Day 9",  status: ["dispatch", "delivered"].includes(o.stage) ? "Done" : "Pending", statusColor: ["dispatch", "delivered"].includes(o.stage) ? "#059669" : "#64748b", statusBg: ["dispatch", "delivered"].includes(o.stage) ? "#d1fae5" : "#f1f5f9" },
      { id: "evt-5", title: "Delivered",        date: o.due,    status: o.stage === "delivered" ? "Done" : "Pending", statusColor: o.stage === "delivered" ? "#059669" : "#64748b", statusBg: o.stage === "delivered" ? "#d1fae5" : "#f1f5f9" },
    ],
    notes: o.priority === "urgent"
      ? "Urgent — <3 days to due date. Flag any blockers immediately."
      : "On schedule. Daily standup updates this status.",
  };
}

export function OrdersFnbMock() {
  const [selected, setSelected] = useState<LiveOrder | null>(null);

  return (
    <div>
      <PreviewBanner />
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Live Order Command Centre</h1>
          <p className="text-sm text-slate-500 mt-0.5">Real-time production pipeline · click an order for the full status timeline</p>
        </div>
        <div className="flex items-center gap-3">
          <span className="text-sm text-slate-500">Pipeline value:</span>
          <span className="font-bold text-lg text-slate-800">₹1.35 Cr</span>
          <span className="badge badge-teal">44 ACTIVE</span>
          <ImportExportButtons
            rows={LIVE_ORDERS}
            columns={[
              { label: "Order ID",  value: "id" },
              { label: "Client",    value: "client" },
              { label: "SKU",       value: "sku" },
              { label: "Value",     value: "value" },
              { label: "Due",       value: "due" },
              { label: "Stage",     value: "stage" },
              { label: "Priority",  value: "priority" },
              { label: "Days Left", value: "daysLeft" },
            ]}
            fileBase="orders"
            accentColor="#1d4ed8"
          />
        </div>
      </div>

      {/* Pipeline board */}
      <div className="kpi-grid mb-5" style={{ gridTemplateColumns: "repeat(5, 1fr)" }}>
        {PIPELINE_STAGES.map((s) => (
          <div key={s.id} className="card" style={{ borderTop: `3px solid ${s.color}` }}>
            <div className="kpi-label">{s.label}</div>
            <div className="kpi-value mt-1" style={{ color: s.color }}>{s.count}</div>
            <div className="text-xs text-slate-500 mt-1 font-medium">{s.value}</div>
          </div>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Live orders table */}
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title mb-0">Active Orders</h3>
            <span className="text-xs text-slate-400 font-medium flex items-center gap-1">
              44 total <ChevronRight className="w-3.5 h-3.5" />
            </span>
          </div>
          <div className="table-wrap">
            <table className="data-table no-row-hover">
              <thead>
                <tr>
                  <th>Order ID</th>
                  <th>Client</th>
                  <th>SKU</th>
                  <th>Value</th>
                  <th>Due</th>
                  <th>Stage</th>
                  <th>Priority</th>
                </tr>
              </thead>
              <tbody>
                {LIVE_ORDERS.map((o) => (
                  <tr key={o.id} onClick={() => setSelected(o)} className="hover:bg-blue-50 transition-colors cursor-pointer">
                    <td className="font-mono text-xs text-blue-600 font-semibold">{o.id}</td>
                    <td className="font-medium text-slate-800">{o.client}</td>
                    <td className="text-slate-600 text-xs">{o.sku}</td>
                    <td className="font-semibold text-slate-700">{o.value}</td>
                    <td>
                      <span className={`text-xs font-medium ${o.daysLeft <= 3 ? "text-red-600" : o.daysLeft <= 7 ? "text-amber-600" : "text-slate-500"}`}>
                        {o.due} ({o.daysLeft}d)
                      </span>
                    </td>
                    <td><StageBadge stage={o.stage} /></td>
                    <td><PriorityBadge priority={o.priority} /></td>
                  </tr>
                ))}
                {LIVE_ORDERS.length === 0 && (
                  <TableEmpty colSpan={7} icon="📦" title="No active orders" description="New production orders will appear here." />
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right: Bottlenecks + Vendor Slips */}
        <div className="flex flex-col gap-4">
          {/* Bottlenecks */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <AlertTriangle className="w-4 h-4 text-amber-500" />
              <h3 className="card-title mb-0">Production Bottlenecks</h3>
            </div>
            <div className="space-y-3">
              {BOTTLENECKS.map((b, i) => (
                <div key={i} className={`alert-card ${b.severity === "high" ? "error" : "warning"}`}>
                  <b.Icon className={`w-4 h-4 shrink-0 ${b.severity === "high" ? "text-red-500" : "text-amber-500"}`} />
                  <div>
                    <div className="text-sm font-semibold text-slate-800">{b.title}</div>
                    <div className="text-xs text-slate-500 mt-0.5">{b.desc}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Vendor slips */}
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <Truck className="w-4 h-4 text-rose-500" />
              <h3 className="card-title mb-0">Vendor Slip Tracker</h3>
            </div>
            <div className="space-y-2">
              {VENDOR_SLIPS.map((v, i) => (
                <div key={i} className="p-3 rounded-lg border border-rose-100 bg-rose-50">
                  <div className="text-sm font-semibold text-rose-800">{v.vendor}</div>
                  <div className="text-xs text-rose-600 mt-0.5">{v.item}</div>
                  <div className="flex justify-between mt-1.5">
                    <span className="text-xs text-slate-500">Expected: {v.expected}</span>
                    <span className={`text-xs font-medium ${v.risk === "high" ? "text-red-600" : "text-amber-600"}`}>{v.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* On-time delivery trend */}
      <div className="card">
        <h3 className="card-title">On-Time Delivery Rate — Last 6 Months</h3>
        <div className="flex items-end gap-3 mt-3" style={{ height: 100 }}>
          {[
            { month: "Dec", pct: 78 }, { month: "Jan", pct: 82 }, { month: "Feb", pct: 76 },
            { month: "Mar", pct: 85 }, { month: "Apr", pct: 88 }, { month: "May", pct: 83 }
          ].map((d) => (
            <div key={d.month} className="flex-1 flex flex-col items-center gap-1">
              <span className="text-xs font-semibold text-slate-600">{d.pct}%</span>
              <div className="w-full rounded-t-sm" style={{ height: `${(d.pct - 70) * 4}px`, background: d.pct >= 85 ? "#10b981" : d.pct >= 80 ? "#f59e0b" : "#f43f5e", minHeight: 8 }} />
              <span className="text-xs text-slate-500">{d.month}</span>
            </div>
          ))}
        </div>
        <div className="flex items-center gap-4 mt-3 text-xs">
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 inline-block" />≥ 85% Target</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-amber-400 inline-block" />80–84%</span>
          <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-rose-400 inline-block" />&lt; 80%</span>
        </div>
      </div>

      {selected && (
        <ClientDetailPanel
          open={!!selected}
          onClose={() => setSelected(null)}
          name={selected.client}
          subtitle={`${selected.id} · ${selected.sku}`}
          kpis={[
            { label: "Value",      value: selected.value },
            { label: "Due",        value: selected.due },
            { label: "Days Left",  value: String(selected.daysLeft) },
            { label: "Priority",   value: selected.priority.toUpperCase() },
          ]}
          detail={buildOrderDetail(selected)}
          accentColor="#1d4ed8"
        />
      )}
    </div>
  );
}
