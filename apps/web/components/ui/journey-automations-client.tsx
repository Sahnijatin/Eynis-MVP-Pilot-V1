"use client";

import { useMemo, useState } from "react";
import { Plus, Zap, MessageSquare, RefreshCw, UserX, Star, ArrowRightCircle, Pause, Play } from "lucide-react";
import { useToast } from "../ds";
import { PreviewBanner } from "./preview-badge";
import { NewFlowModal, FLOW_TRIGGERS, FLOW_ACTIONS, type FlowPrefill, type SequenceOption } from "./new-flow-modal";
import type { AutomationsResponse } from "../../lib/data";

type FlowItem = AutomationsResponse["items"][number];

const TRIGGER_LABEL: Record<string, string> = Object.fromEntries(FLOW_TRIGGERS.map((o) => [o.value, o.label]));
const ACTION_LABEL: Record<string, string> = Object.fromEntries(FLOW_ACTIONS.map((o) => [o.value, o.label]));

// Illustrative example flows — now double as one-click templates that pre-fill the
// New Flow modal (keys match the shared vocabulary). Industry-neutral CRM journeys.
const EXAMPLE_FLOWS: Array<{ Icon: typeof MessageSquare; prefill: Required<Pick<FlowPrefill, "name" | "trigger" | "action" | "channels">> & FlowPrefill; detail: string }> = [
  { Icon: MessageSquare, detail: "WhatsApp + email · uses source, project type and signals from the enquiry",
    prefill: { name: "New enquiry → 5-minute reply", trigger: "new_lead", action: "send_whatsapp", channels: ["whatsapp", "email"], detail: "AI-personalised first response within 5 minutes" } },
  { Icon: RefreshCw, detail: "Day 3, day 7, day 14 with a new angle each time, then sales handoff",
    prefill: { name: "Quote sent · no response → follow-up", trigger: "quote_no_response", action: "multi_touch_followup", channels: ["whatsapp", "email"], delayHours: 72, detail: "Multi-touch follow-up kicks in" } },
  { Icon: ArrowRightCircle, detail: "Relevant past work · spec sheets · finance options · FAQs",
    prefill: { name: "Active opportunity → nurture drip", trigger: "deal_stage_changed", action: "nurture_drip", channels: ["email"], detail: "Nurture content drip by evaluation stage" } },
  { Icon: Zap, detail: "References the exact configuration · offers a reason to reopen",
    prefill: { name: "Deal abandoned → re-engagement", trigger: "deal_lost", action: "send_whatsapp", channels: ["whatsapp"], detail: "AI-personalised re-engagement" } },
  { Icon: UserX, detail: "Triggered by time since last order + re-buy cycle prediction",
    prefill: { name: "Dormant client → re-buy nudge", trigger: "contact_dormant", action: "send_whatsapp", channels: ["whatsapp"], delayHours: 2160, detail: "Re-buy nudge with refresh suggestion" } },
  { Icon: Star, detail: "Routes positive sentiment to a public review · negative to your team to fix",
    prefill: { name: "Order delivered → review / referral", trigger: "order_delivered", action: "ask_review", channels: ["whatsapp", "email"], detail: "Satisfaction check → review or referral ask" } },
];

export function JourneyAutomationsClient({ accentColor, industryLabel, initialFlows, sequences = [] }: {
  accentColor: string;
  industryLabel: string;
  initialFlows: FlowItem[];
  sequences?: SequenceOption[];
}) {
  const toast = useToast();
  const [flows, setFlows] = useState<FlowItem[]>(initialFlows);
  const [modalOpen, setModalOpen] = useState(false);
  const [prefill, setPrefill] = useState<FlowPrefill | undefined>(undefined);
  const [togglingId, setTogglingId] = useState<string | null>(null);

  const activeCount = useMemo(() => flows.filter((f) => f.isActive).length, [flows]);
  const totalExec = useMemo(() => flows.reduce((s, f) => s + f.executions, 0), [flows]);
  const totalConv = useMemo(() => flows.reduce((s, f) => s + f.conversions, 0), [flows]);
  const totalRevenue = useMemo(() => flows.reduce((s, f) => s + f.revenueInr, 0), [flows]);

  function openBlank() { setPrefill(undefined); setModalOpen(true); }
  function openTemplate(p: FlowPrefill) { setPrefill(p); setModalOpen(true); }

  function onCreated(rule: FlowItem) {
    setFlows((prev) => [rule, ...prev]);
    setModalOpen(false);
  }

  async function toggle(item: FlowItem) {
    const next = !item.isActive;
    setTogglingId(item.id);
    setFlows((prev) => prev.map((f) => f.id === item.id ? { ...f, isActive: next } : f));
    try {
      const res = await fetch(`/api/automations/${item.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ isActive: next }),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setFlows((prev) => prev.map((f) => f.id === item.id ? { ...f, isActive: item.isActive } : f));
        toast.push(data.error ?? "Couldn't update the flow", "error");
        return;
      }
      toast.push(next ? `Resumed "${item.name}"` : `Paused "${item.name}"`, "success");
    } catch {
      setFlows((prev) => prev.map((f) => f.id === item.id ? { ...f, isActive: item.isActive } : f));
      toast.push("Couldn't update the flow — please try again", "error");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-fg">Customer Journey Automations</h1>
          <p className="text-sm text-fg-muted mt-0.5">AI-built flows · triggered by data · personalised by AI · tracked end-to-end</p>
        </div>
        <button onClick={openBlank} className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: accentColor }}>
          <Plus className="w-4 h-4" /> New Flow
        </button>
      </div>

      {/* KPIs — real numbers from the tenant's own flows. */}
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Active Flows</div>
          <div className="kpi-value mt-1.5">{activeCount}</div>
          <div className="kpi-delta neutral mt-1.5">{flows.length} total</div>
        </div>
        <div className="card">
          <div className="kpi-label">Executions (30d)</div>
          <div className="kpi-value mt-1.5">{totalExec}</div>
          <div className="kpi-delta neutral mt-1.5">Across all flows</div>
        </div>
        <div className="card">
          <div className="kpi-label">Conversions (30d)</div>
          <div className="kpi-value mt-1.5">{totalConv}</div>
          <div className="kpi-delta up mt-1.5">{totalExec > 0 ? `${Math.round((totalConv / totalExec) * 100)}% avg rate` : "—"}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Revenue Attributed</div>
          <div className="kpi-value mt-1.5">{totalRevenue > 0 ? `₹${(totalRevenue / 1000).toFixed(0)}K` : "₹0"}</div>
          <div className="kpi-delta neutral mt-1.5">From attributed flows</div>
        </div>
      </div>

      {/* The tenant's own flows. */}
      {flows.length === 0 ? (
        <div className="card text-center py-10 mb-6">
          <div className="text-sm font-semibold text-fg mb-1">No flows yet</div>
          <p className="text-sm text-fg-muted mb-4">Create your first journey automation, or start from one of the examples below.</p>
          <button onClick={openBlank} className="px-4 py-2 text-sm font-semibold rounded-lg text-white inline-flex items-center gap-1.5" style={{ background: accentColor }}>
            <Plus className="w-4 h-4" /> New Flow
          </button>
        </div>
      ) : (
        <div className="space-y-3 mb-8">
          {flows.map((flow) => (
            <div key={flow.id} className="card">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + "12" }}>
                  <Zap className="w-5 h-5" style={{ color: accentColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-semibold text-fg mb-1">{flow.name}</div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Trigger</span>
                    <span className="text-sm text-fg">{flow.trigger ? (TRIGGER_LABEL[flow.trigger] ?? flow.trigger) : "—"}</span>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accentColor }}>Action</span>
                    <span className="text-sm text-fg">{flow.action ? (ACTION_LABEL[flow.action] ?? flow.action) : "—"}</span>
                    {(flow.channels ?? []).map((c) => (
                      <span key={c} className="badge text-[10px]" style={{ background: accentColor + "12", color: accentColor }}>{c}</span>
                    ))}
                  </div>
                  {flow.detail && <p className="text-xs text-fg-muted">{flow.detail}</p>}
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-fg">{flow.executions}</div>
                  <div className="text-xs text-fg-muted">executions</div>
                  <div className="text-sm font-semibold mt-1" style={{ color: accentColor }}>{flow.conversions} converted</div>
                </div>
                <button
                  onClick={() => toggle(flow)}
                  disabled={togglingId === flow.id}
                  title={flow.isActive ? "Pause this flow" : "Resume this flow"}
                  className={`badge inline-flex items-center gap-1 shrink-0 ${togglingId === flow.id ? "opacity-50" : "hover:opacity-80 cursor-pointer"}`}
                  style={{ background: flow.isActive ? accentColor + "12" : "var(--warn-bg, #fef3c7)", color: flow.isActive ? accentColor : "var(--warn, #b45309)" }}
                >
                  {flow.isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                  {flow.isActive ? "Active" : "Paused"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Example flows — one click to start a real flow from a proven template. */}
      <div className="mb-2">
        <h2 className="text-base font-semibold text-fg">Example flows for {industryLabel}</h2>
        <p className="text-sm text-fg-muted mt-0.5">Start from a template — you can tweak every field before it goes live.</p>
      </div>
      <PreviewBanner>These examples are illustrative starting points. Click “Use this template” to create a real, editable flow from one.</PreviewBanner>
      <div className="space-y-3">
        {EXAMPLE_FLOWS.map((ex, i) => (
          <div key={i} className="card">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: accentColor + "12" }}>
                <ex.Icon className="w-5 h-5" style={{ color: accentColor }} />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Trigger</span>
                  <span className="text-sm font-semibold text-fg">{TRIGGER_LABEL[ex.prefill.trigger] ?? ex.prefill.trigger}</span>
                </div>
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: accentColor }}>Action</span>
                  <span className="text-sm font-medium text-fg">{ACTION_LABEL[ex.prefill.action] ?? ex.prefill.action}</span>
                </div>
                <p className="text-xs text-fg-muted">{ex.detail}</p>
              </div>
              <button onClick={() => openTemplate(ex.prefill)} className="text-sm font-semibold flex items-center gap-1 shrink-0" style={{ color: accentColor }}>
                Use this template →
              </button>
            </div>
          </div>
        ))}
      </div>

      {modalOpen && <NewFlowModal prefill={prefill} sequences={sequences} onClose={() => setModalOpen(false)} onCreated={onCreated} />}
    </div>
  );
}
