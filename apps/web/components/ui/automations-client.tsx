"use client";

import { useMemo, useState } from "react";
import { Plus, Zap, Clock, Download, Filter, CheckCircle2, XCircle, AlertCircle, MessageSquare, Star, Bell, X, Pause, Play } from "lucide-react";
import { CampaignBarChart } from "./charts";
import { PreviewBadge } from "./preview-badge";
import { useToast } from "../ds";
import type { AutomationsResponse, AutomationExecutionsResponse } from "../../lib/data";

type Item = AutomationsResponse["items"][number];
type Execution = AutomationExecutionsResponse["items"][number];

const templateLibrary = [
  { Icon: Bell, name: "Pre-Arrival Welcome", desc: "Early digital check-in and personalized amenity selection trigger.", code: "pre_arrival_welcome" },
  { Icon: Star, name: "Late Checkout Upsell", desc: "Identify high-value guests on departure eve for extended stay offers.", code: "late_checkout_upsell" },
  { Icon: MessageSquare, name: "Post-Stay Review", desc: "Automated loyalty point injection for private feedback collection.", code: "post_stay_review" },
];

const triggerLabel: Record<string, string> = {
  sla_breach: "SLA Breach", sentiment_low: "Negative Sentiment", checkin_welcome: "Guest Check-in", upsell_followup: "Request Resolved",
};
const actionLabel: Record<string, string> = {
  escalate_sr: "Escalate Request", create_sr: "Create Alert SR", send_whatsapp: "Send WhatsApp", queue_offer: "Queue Upsell Offer",
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function successRate(item: Item): string {
  return item.executions > 0 ? ((item.conversions / item.executions) * 100).toFixed(1) : "0.0";
}

function downloadCsv(rows: Item[]) {
  const header = ["Automation Name", "Type", "Status", "Executions", "Success Rate %", "Revenue (INR)", "Last Fired"];
  // Quote every field; prefix a leading =/+/-/@ with an apostrophe so a rule name
  // can't be interpreted as a formula when the CSV is opened in a spreadsheet.
  const esc = (v: string) => {
    const safe = /^[=+\-@]/.test(v) ? `'${v}` : v;
    return `"${safe.replace(/"/g, '""')}"`;
  };
  const lines = rows.map((r) => [
    r.name,
    r.ruleType === "operational" ? "Engine" : "Marketing",
    r.isActive ? "Active" : "Paused",
    String(r.executions),
    successRate(r),
    r.revenueInr > 0 ? String(r.revenueInr) : "",
    r.lastFiredAt ? new Date(r.lastFiredAt).toISOString() : "Never",
  ].map((c) => esc(c)).join(","));
  const csv = [header.map(esc).join(","), ...lines].join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "automations.csv";
  a.click();
  URL.revokeObjectURL(url);
}

export function AutomationsClient({ initialItems, initialSummary, initialExecutions, error }: {
  initialItems: Item[];
  initialSummary: AutomationsResponse["summary"];
  initialExecutions: Execution[];
  error?: string;
}) {
  const toast = useToast();
  const [items, setItems] = useState<Item[]>(initialItems);
  const [typeFilter, setTypeFilter] = useState<"all" | "operational" | "marketing">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "paused">("all");
  const [filterOpen, setFilterOpen] = useState(false);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  // The page fetches up to 200 executions: the full set feeds the per-day
  // activity chart; the log below shows the most recent 15.
  const executions = initialExecutions.slice(0, 15);

  const filtered = useMemo(() => items.filter((i) =>
    (typeFilter === "all" || i.ruleType === typeFilter) &&
    (statusFilter === "all" || (statusFilter === "active" ? i.isActive : !i.isActive))
  ), [items, typeFilter, statusFilter]);

  const activeFlows = items.filter((i) => i.isActive).length;

  // Real engine activity: executions per day (total vs successful) over the
  // last 14 days, aggregated from the execution log — never fabricated bars.
  const weeklyData = useMemo(() => {
    const dayMs = 24 * 3600_000;
    const now = Date.now();
    return Array.from({ length: 14 }, (_, i) => {
      const d = new Date(now - (13 - i) * dayMs);
      const key = d.toISOString().slice(0, 10);
      const ofDay = initialExecutions.filter((ex) => ex.executedAt.slice(0, 10) === key);
      return {
        day: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short" }),
        executions: ofDay.length,
        conversions: ofDay.filter((ex) => ex.actionResult === "success").length,
      };
    });
  }, [initialExecutions]);
  const hasChartData = weeklyData.some((d) => d.executions > 0);

  async function toggleRule(item: Item) {
    const next = !item.isActive;
    setTogglingId(item.id);
    // Optimistic update.
    setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, isActive: next } : i));
    try {
      const res = await fetch(`/api/automations/${item.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: next }),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) {
        setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, isActive: item.isActive } : i)); // revert
        toast.push(data.error ?? "Couldn't update the automation", "error");
        return;
      }
      toast.push(next ? `Resumed "${item.name}"` : `Paused "${item.name}"`, "success");
    } catch {
      setItems((prev) => prev.map((i) => i.id === item.id ? { ...i, isActive: item.isActive } : i)); // revert
      toast.push("Couldn't update the automation — please try again", "error");
    } finally {
      setTogglingId(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Automations</h1>
            <p className="page-subtitle">Rule-based workflows that fire automatically — 60s evaluation cycle.</p>
          </div>
          <button onClick={() => setInfoOpen(true)} className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: "#f59e0b" }}>
            <Plus className="w-4 h-4" /> Create New Workflow
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #0f766e" }}>
          <div className="kpi-label">Total Automations</div>
          <div className="kpi-value mt-1.5">{items.length}</div>
          <div className="kpi-delta neutral mt-2">● {items.filter(i => i.ruleType === "operational").length} operational rules</div>
        </div>
        <div className="card">
          <div className="kpi-label">Active Flows</div>
          <div className="kpi-value mt-1.5">{activeFlows}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label flex items-center gap-2">Avg. Conversion <PreviewBadge label="Sample" /></div>
          </div>
          <div className="kpi-value mt-1.5">{initialSummary.avgConversion.toFixed(1)}%</div>
        </div>
        <div className="card">
          <div className="kpi-label flex items-center gap-2">Revenue Attributed <PreviewBadge label="Sample" /></div>
          <div className="kpi-value mt-1.5">₹{(initialSummary.revenueAttributed / 1000).toFixed(0)}K</div>
        </div>
      </div>

      {/* Template Library + Performance */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title mb-0">Automation Library</h3>
            <button onClick={() => setInfoOpen(true)} className="text-sm font-medium" style={{ color: "var(--color-teal)" }}>View All</button>
          </div>
          <div className="space-y-3">
            {templateLibrary.map((t) => (
              <div key={t.code} className="p-3 rounded-lg border border-slate-100 bg-slate-50 hover:bg-teal-50 hover:border-teal-100 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <t.Icon className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">{t.desc}</p>
                <button onClick={() => setInfoOpen(true)} className="text-xs font-semibold flex items-center gap-1" style={{ color: "var(--color-teal)" }}>
                  Use Template →
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="card-title mb-0">Engine Activity</h3>
              <p className="text-xs text-slate-500 mt-0.5">Executions per day · last 14 days</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block" />EXECUTIONS</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />SUCCESSFUL</span>
            </div>
          </div>
          {hasChartData
            ? <CampaignBarChart data={weeklyData} names={["Executions", "Successful"]} />
            : <div className="py-14 text-center text-sm text-slate-400">No engine activity in the last 14 days — this chart fills in as rules fire.</div>}
        </div>
      </div>

      {/* Active Automations Log */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="card-title mb-0">All Automation Rules</h3>
          <div className="flex gap-2">
            <button onClick={() => setFilterOpen(v => !v)} className={`px-3 py-1.5 text-sm font-medium rounded-lg border flex items-center gap-1.5 ${filterOpen || typeFilter !== "all" || statusFilter !== "all" ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-600 hover:bg-slate-50"}`}><Filter className="w-3.5 h-3.5" /> Filter</button>
            <button onClick={() => downloadCsv(filtered)} className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export CSV</button>
          </div>
        </div>

        {filterOpen && (
          <div className="flex items-center gap-4 mb-3 p-3 rounded-lg bg-slate-50 border border-slate-100">
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
              Type
              <select value={typeFilter} onChange={e => setTypeFilter(e.target.value as typeof typeFilter)} className="text-sm border border-slate-200 rounded px-2 py-1">
                <option value="all">All</option>
                <option value="operational">Engine</option>
                <option value="marketing">Marketing</option>
              </select>
            </label>
            <label className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
              Status
              <select value={statusFilter} onChange={e => setStatusFilter(e.target.value as typeof statusFilter)} className="text-sm border border-slate-200 rounded px-2 py-1">
                <option value="all">All</option>
                <option value="active">Active</option>
                <option value="paused">Paused</option>
              </select>
            </label>
            {(typeFilter !== "all" || statusFilter !== "all") && (
              <button onClick={() => { setTypeFilter("all"); setStatusFilter("all"); }} className="text-xs text-slate-500 hover:text-slate-700 ml-auto">Clear filters</button>
            )}
          </div>
        )}

        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Automation Name</th><th>Type</th><th>Status</th><th>Executions</th><th>Success Rate</th><th>Revenue</th><th>Last Fired</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((item) => {
                const sr = successRate(item);
                return (
                  <tr key={item.id}>
                    <td>
                      <span className="flex items-center gap-2">
                        <Zap className="w-4 h-4 text-teal-600" />
                        <span className="font-medium text-slate-800">{item.name}</span>
                      </span>
                    </td>
                    <td>
                      <span className={`badge ${item.ruleType === "operational" ? "badge-blue" : "badge-amber"} text-[10px]`}>
                        {item.ruleType === "operational" ? "ENGINE" : "MARKETING"}
                      </span>
                    </td>
                    <td>
                      <button
                        onClick={() => toggleRule(item)}
                        disabled={togglingId === item.id}
                        title={item.isActive ? "Pause this automation" : "Resume this automation"}
                        className={`badge inline-flex items-center gap-1 ${item.isActive ? "badge-green" : "badge-amber"} ${togglingId === item.id ? "opacity-50" : "hover:opacity-80 cursor-pointer"}`}
                      >
                        {item.isActive ? <Pause className="w-3 h-3" /> : <Play className="w-3 h-3" />}
                        {item.isActive ? "Active" : "Paused"}
                      </button>
                    </td>
                    <td className="font-semibold text-slate-700">{item.executions.toLocaleString()}</td>
                    <td className={`font-semibold ${parseFloat(sr) >= 80 ? "text-emerald-600" : parseFloat(sr) >= 50 ? "text-amber-600" : "text-slate-500"}`}>{sr}%</td>
                    <td className="font-semibold text-slate-700">
                      {item.revenueInr > 0 ? `₹${item.revenueInr.toLocaleString("en-IN")}` : <span className="text-slate-500">—</span>}
                    </td>
                    <td className="text-slate-500 text-xs">
                      {item.lastFiredAt ? (
                        <span className="flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(item.lastFiredAt)}</span>
                      ) : <span className="text-slate-300">Never</span>}
                    </td>
                  </tr>
                );
              })}
              {filtered.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">{items.length === 0 ? "No automations configured yet" : "No automations match these filters"}</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Engine Execution Log — real-time events from the automation worker */}
      <div className="card">
        <div className="flex items-center gap-2 mb-4">
          <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <h3 className="card-title mb-0">Engine Execution Log</h3>
          <span className="text-xs text-slate-500 ml-auto">Live — 60s cycle</span>
        </div>
        {executions.length === 0 ? (
          <div className="text-center py-10 text-slate-500 text-sm">No executions yet — engine will fire on next cycle</div>
        ) : (
          <div className="space-y-2">
            {executions.map((ex) => (
              <div key={ex.id} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50 transition-colors">
                <div className="mt-0.5 shrink-0">
                  {ex.actionResult === "success" ? <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                    : ex.actionResult === "failed" ? <XCircle className="w-4 h-4 text-red-400" />
                    : <AlertCircle className="w-4 h-4 text-amber-400" />}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">{triggerLabel[ex.triggerType] ?? ex.triggerType}</span>
                    <span className="text-slate-300">→</span>
                    <span className="text-xs font-medium text-teal-700">{actionLabel[ex.actionType] ?? ex.actionType}</span>
                    <span className={`badge text-[10px] ${ex.actionResult === "success" ? "badge-green" : ex.actionResult === "failed" ? "badge-red" : "badge-amber"}`}>{ex.actionResult.toUpperCase()}</span>
                  </div>
                  {ex.resultDetail && <div className="text-xs text-slate-500 mt-0.5 truncate">{ex.resultDetail}</div>}
                  <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{ex.ruleCode}</div>
                </div>
                <div className="text-xs text-slate-500 shrink-0 whitespace-nowrap">{timeAgo(ex.executedAt)}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-6 left-64 z-40">
        <button onClick={() => setInfoOpen(true)} className="px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold text-white flex items-center gap-2" style={{ background: "#0f766e" }}>
          <Plus className="w-4 h-4" /> New Workflow
        </button>
      </div>

      {/* Honest info modal — custom workflow authoring isn't self-serve yet, so
          rather than fake a builder we explain how automations work today. */}
      {infoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setInfoOpen(false)}>
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-md p-5" onClick={e => e.stopPropagation()}>
            <div className="flex items-start justify-between mb-3">
              <h3 className="text-base font-semibold text-slate-800">Custom workflows</h3>
              <button onClick={() => setInfoOpen(false)} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              Your operational automations already run automatically on a 60-second cycle — you can <strong>pause or resume</strong> any rule from the table below, and export the list to CSV.
            </p>
            <p className="text-sm text-slate-600 mb-4">
              Building brand-new custom workflows (your own triggers and actions) is on the roadmap. Want a specific flow set up in the meantime? Reach out to your account team and we&apos;ll configure it for you.
            </p>
            <div className="flex justify-end">
              <button onClick={() => setInfoOpen(false)} className="px-4 py-2 text-sm font-semibold rounded-lg text-white" style={{ background: "#0f766e" }}>Got it</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
