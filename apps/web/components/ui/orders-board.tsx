"use client";

import { useCallback, useState } from "react";
import { PageHeader, Card, Badge, Select, useToast } from "../ds";
import type { OrderRow, OrderStageSummary } from "../../lib/data";

// Real Live Orders board (Phase 7): the fulfillment pipeline created from
// accepted quotes. Every number here traces to a DB row — no sample data.

const STAGES: Array<{ id: OrderRow["stage"]; label: string; color: string }> = [
  { id: "new", label: "New Order", color: "#6366f1" },
  { id: "production", label: "In Production", color: "#f59e0b" },
  { id: "qc", label: "QC Review", color: "#8b5cf6" },
  { id: "dispatch", label: "Ready to Dispatch", color: "#10b981" },
  { id: "delivered", label: "Delivered", color: "#64748b" },
];

const rupees = (paise: number) => `₹${(Math.round(paise) / 100).toLocaleString("en-IN")}`;
const lakh = (paise: number) => {
  const inr = paise / 100;
  return inr >= 100000 ? `₹${(inr / 100000).toFixed(1)}L` : rupees(paise);
};

export function OrdersBoard({ initialItems, initialSummary }: { initialItems: OrderRow[]; initialSummary: OrderStageSummary[] }) {
  const toast = useToast();
  const [items, setItems] = useState(initialItems);
  const [summary, setSummary] = useState(initialSummary);
  const [filter, setFilter] = useState<string>("");

  const refresh = useCallback(async () => {
    const res = await fetch("/api/orders?limit=200", { cache: "no-store" });
    const data = (await res.json()) as { ok: boolean; items?: OrderRow[]; summary?: OrderStageSummary[] };
    if (data.items) setItems(data.items);
    if (data.summary) setSummary(data.summary);
  }, []);

  const moveStage = useCallback(async (id: string, stage: string) => {
    const res = await fetch(`/api/orders/${id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ stage }),
    });
    const data = (await res.json()) as { ok: boolean; error?: string };
    if (!data.ok) { toast.push(data.error ?? "Could not move the order", "error"); return; }
    toast.push("Order moved", "success");
    refresh();
  }, [toast, refresh]);

  const visible = filter ? items.filter((o) => o.stage === filter) : items;

  return (
    <div>
      <PageHeader title="Live Orders" subtitle="Your production pipeline — created automatically from accepted quotes." />

      <div className="kpi-grid mb-5">
        {STAGES.map((s) => {
          const row = summary.find((x) => x.stage === s.id);
          return (
            <button key={s.id} className="card text-left" onClick={() => setFilter(filter === s.id ? "" : s.id)}
              style={{ borderTop: `3px solid ${s.color}`, cursor: "pointer", outline: filter === s.id ? `2px solid ${s.color}` : "none" }}>
              <div className="kpi-label">{s.label}</div>
              <div className="kpi-value mt-1.5">{row?.count ?? 0}</div>
              <div className="kpi-delta neutral mt-1.5">{lakh(row?.valuePaise ?? 0)}</div>
            </button>
          );
        })}
      </div>

      <Card>
        <div style={{ overflowX: "auto" }}>
          <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ textAlign: "left", color: "#64748b" }}>
                <th style={{ padding: "8px 10px" }}>Order</th>
                <th style={{ padding: "8px 10px" }}>Item</th>
                <th style={{ padding: "8px 10px" }}>Customer</th>
                <th style={{ padding: "8px 10px" }}>Quote</th>
                <th style={{ padding: "8px 10px", textAlign: "right" }}>Value</th>
                <th style={{ padding: "8px 10px" }}>Stage</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: "center", color: "#94a3b8" }}>
                  No orders {filter ? "in this stage" : "yet — accept a quote and it lands here automatically"}.
                </td></tr>
              )}
              {visible.map((o) => (
                <tr key={o.id} style={{ borderTop: "1px solid #e2e8f0" }}>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace" }}>{o.number}</td>
                  <td style={{ padding: "8px 10px" }}>{o.title}</td>
                  <td style={{ padding: "8px 10px", color: o.contactName || o.companyName ? "#0f172a" : "#94a3b8" }}>{o.companyName ?? o.contactName ?? "—"}</td>
                  <td style={{ padding: "8px 10px", fontFamily: "monospace", color: "#64748b" }}>{o.quoteNumber}</td>
                  <td style={{ padding: "8px 10px", textAlign: "right", fontWeight: 600 }}>{rupees(o.valuePaise)}</td>
                  <td style={{ padding: "8px 10px" }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <Badge tone={o.stage === "delivered" ? "success" : o.stage === "production" ? "warning" : "accent"}>{STAGES.find((s) => s.id === o.stage)?.label ?? o.stage}</Badge>
                      <Select value={o.stage} onChange={(e) => moveStage(o.id, e.target.value)}>
                        {STAGES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
                      </Select>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
