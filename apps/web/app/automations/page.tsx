import { fetchAutomations, fetchAutomationExecutions } from "../../lib/data";
import { getUserWorkspace } from "../../lib/workspace";
import { Plus, Zap, Clock, Download, Filter, CheckCircle2, XCircle, AlertCircle, MessageSquare, RefreshCw, UserX, Star, ArrowRightCircle, Bell } from "lucide-react";
import { CampaignBarChart } from "../../components/ui/charts";
import { PreviewBanner } from "../../components/ui/preview-badge";

export const dynamic = "force-dynamic";

const templateLibrary = [
  { Icon: Bell, name: "Pre-Arrival Welcome", desc: "Early digital check-in and personalized amenity selection trigger.", code: "pre_arrival_welcome" },
  { Icon: Star, name: "Late Checkout Upsell", desc: "Identify high-value guests on departure eve for extended stay offers.", code: "late_checkout_upsell" },
  { Icon: MessageSquare, name: "Post-Stay Review", desc: "Automated loyalty point injection for private feedback collection.", code: "post_stay_review" }
];

const MFG_FLOWS = [
  { Icon: MessageSquare, trigger: "New enquiry lands", action: "AI-personalised first response within 5 minutes", detail: "WhatsApp + email · uses source, project type, signals from the enquiry", status: "active", executions: 84, conversions: 71 },
  { Icon: RefreshCw, trigger: "Quote sent · no response after 72hr", action: "Multi-touch follow-up kicks in", detail: "Day 3, day 7, day 14 with a new angle each time, then sales handoff", status: "active", executions: 38, conversions: 14 },
  { Icon: ArrowRightCircle, trigger: "Active opportunity", action: "Nurture content drip by evaluation stage", detail: "Relevant past work · spec sheets · finance options · FAQs", status: "active", executions: 22, conversions: 9 },
  { Icon: Zap, trigger: "Quote abandoned · day 30", action: "AI-personalised re-engagement", detail: "References the exact configuration · offers a reason to reopen", status: "active", executions: 17, conversions: 4 },
  { Icon: UserX, trigger: "Dormant client · predictive window hit", action: "Re-buy nudge with refurb suggestion", detail: "Triggered by time since last PO + refurb cycle prediction", status: "active", executions: 11, conversions: 3 },
  { Icon: Star, trigger: "Order delivered", action: "Satisfaction check → review or referral ask", detail: "Routes positive sentiment to Google · negative to your team to fix", status: "active", executions: 56, conversions: 48 }
];

const triggerLabel: Record<string, string> = {
  sla_breach: "SLA Breach",
  sentiment_low: "Negative Sentiment",
  checkin_welcome: "Guest Check-in",
  upsell_followup: "Request Resolved"
};

const actionLabel: Record<string, string> = {
  escalate_sr: "Escalate Request",
  create_sr: "Create Alert SR",
  send_whatsapp: "Send WhatsApp",
  queue_offer: "Queue Upsell Offer"
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

export default async function AutomationsPage() {
  const { industry, config } = await getUserWorkspace();

  // Non-hospitality industries: render static industry-specific automations
  if (industry !== "hospitality") {
    const totalExec = MFG_FLOWS.reduce((s, f) => s + f.executions, 0);
    const totalConv = MFG_FLOWS.reduce((s, f) => s + f.conversions, 0);
    return (
      <div>
        <PreviewBanner>These flows and their numbers are illustrative — automations for this industry are not yet wired to your live data.</PreviewBanner>
        <div className="flex items-center justify-between mb-5">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Customer Journey Automations</h1>
            <p className="text-sm text-slate-500 mt-0.5">AI-built flows · triggered by data · personalised by AI · tracked end-to-end</p>
          </div>
          <button className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: config.accentColor }}>
            <Plus className="w-4 h-4" /> New Flow
          </button>
        </div>
        <div className="kpi-grid mb-5">
          <div className="card">
            <div className="kpi-label">Active Flows</div>
            <div className="kpi-value mt-1.5">{MFG_FLOWS.length}</div>
            <div className="kpi-delta up mt-1.5">All running</div>
          </div>
          <div className="card">
            <div className="kpi-label">Executions (30d)</div>
            <div className="kpi-value mt-1.5">{totalExec}</div>
            <div className="kpi-delta neutral mt-1.5">Across all flows</div>
          </div>
          <div className="card">
            <div className="kpi-label">Conversions (30d)</div>
            <div className="kpi-value mt-1.5">{totalConv}</div>
            <div className="kpi-delta up mt-1.5">↑ {Math.round((totalConv / totalExec) * 100)}% avg rate</div>
          </div>
          <div className="card">
            <div className="kpi-label">Revenue Attributed</div>
            <div className="kpi-value mt-1.5">₹18.4L</div>
            <div className="kpi-delta up mt-1.5">↑ +22% vs last month</div>
          </div>
        </div>
        <div className="space-y-3">
          {MFG_FLOWS.map((flow, i) => (
            <div key={i} className="card">
              <div className="flex items-start gap-4">
                <div className="w-10 h-10 rounded-xl flex items-center justify-center shrink-0" style={{ background: config.accentColor + "12" }}>
                  <flow.Icon className="w-5 h-5" style={{ color: config.accentColor }} />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Trigger</span>
                    <span className="text-sm font-semibold text-slate-800">{flow.trigger}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    {/* Neutral label — never the platform brand (white-label, 3.2). */}
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: config.accentColor }}>Action</span>
                    <span className="text-sm font-medium text-slate-700">{flow.action}</span>
                  </div>
                  <p className="text-xs text-slate-500">{flow.detail}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-slate-800">{flow.executions}</div>
                  <div className="text-xs text-slate-500">executions</div>
                  <div className="text-sm font-semibold mt-1" style={{ color: config.accentColor }}>{flow.conversions} converted</div>
                </div>
                <span className="badge shrink-0" style={{ background: config.accentColor + "12", color: config.accentColor }}>● Active</span>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Hospitality: fetch live data from API
  let data: Awaited<ReturnType<typeof fetchAutomations>> | null = null;
  let execData: Awaited<ReturnType<typeof fetchAutomationExecutions>> | null = null;
  let error = "";
  try {
    [data, execData] = await Promise.all([fetchAutomations(), fetchAutomationExecutions(15)]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load automations";
  }

  const summary = data?.summary ?? { totalAutomations: 0, activeFlows: 0, avgConversion: 0, revenueAttributed: 0, totalExecutions: 0 };
  const items = data?.items ?? [];
  const executions = execData?.items ?? [];

  const weeklyData = [
    { day: "01 Nov", executions: 200, conversions: 60 },
    { day: "08 Nov", executions: 280, conversions: 85 },
    { day: "15 Nov", executions: 320, conversions: 95 },
    { day: "22 Nov", executions: 380, conversions: 110 },
    { day: "30 Nov", executions: summary.totalExecutions > 0 ? Math.min(summary.totalExecutions, 500) : 480, conversions: 180 }
  ];

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Automations</h1>
            <p className="page-subtitle">Rule-based workflows that fire automatically — 60s evaluation cycle.</p>
          </div>
          <button className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: "#f59e0b" }}>
            <Plus className="w-4 h-4" /> Create New Workflow
          </button>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #0f766e" }}>
          <div className="kpi-label">Total Automations</div>
          <div className="kpi-value mt-1.5">{summary.totalAutomations}</div>
          <div className="kpi-delta neutral mt-2">● {items.filter(i => i.ruleType === "operational").length} operational rules</div>
        </div>
        <div className="card">
          <div className="kpi-label">Active Flows</div>
          <div className="kpi-value mt-1.5">{summary.activeFlows}</div>
        </div>
        <div className="card">
          <div className="flex items-start justify-between">
            <div className="kpi-label">Avg. Conversion</div>
            <span className="badge badge-red text-[10px]">−2.4%</span>
          </div>
          <div className="kpi-value mt-1.5">{summary.avgConversion.toFixed(1)}%</div>
        </div>
        <div className="card">
          <div className="kpi-label">Revenue Attributed</div>
          <div className="kpi-value mt-1.5">₹{(summary.revenueAttributed / 1000).toFixed(0)}K</div>
        </div>
      </div>

      {/* Template Library + Performance */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        <div className="card col-span-1">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title mb-0">Automation Library</h3>
            <button className="text-sm font-medium" style={{ color: "var(--color-teal)" }}>View All</button>
          </div>
          <div className="space-y-3">
            {templateLibrary.map((t) => (
              <div key={t.code} className="p-3 rounded-lg border border-slate-100 bg-slate-50 hover:bg-teal-50 hover:border-teal-100 transition-colors">
                <div className="flex items-center gap-2 mb-1">
                  <t.Icon className="w-4 h-4 text-slate-500" />
                  <span className="text-sm font-semibold text-slate-800">{t.name}</span>
                </div>
                <p className="text-xs text-slate-500 mb-2">{t.desc}</p>
                <button className="text-xs font-semibold flex items-center gap-1" style={{ color: "var(--color-teal)" }}>
                  Use Template →
                </button>
              </div>
            ))}
          </div>
        </div>

        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="card-title mb-0">Workflow Performance</h3>
              <p className="text-xs text-slate-500 mt-0.5">Flow Executions vs Conversions (30D)</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-teal-700 inline-block" />EXECUTIONS</span>
              <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-500 inline-block" />CONVERSIONS</span>
            </div>
          </div>
          <CampaignBarChart data={weeklyData} />
        </div>
      </div>

      {/* Active Automations Log */}
      <div className="card mb-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="card-title mb-0">All Automation Rules</h3>
          <div className="flex gap-2">
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><Filter className="w-3.5 h-3.5" /> Filter</button>
            <button className="px-3 py-1.5 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"><Download className="w-3.5 h-3.5" /> Export CSV</button>
          </div>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Automation Name</th>
                <th>Type</th>
                <th>Status</th>
                <th>Executions</th>
                <th>Success Rate</th>
                <th>Revenue</th>
                <th>Last Fired</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const sr = item.executions > 0 ? ((item.conversions / item.executions) * 100).toFixed(1) : "0.0";
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
                      <span className={`badge ${item.isActive ? "badge-green" : "badge-amber"}`}>
                        {item.isActive ? "Active" : "Paused"}
                      </span>
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
              {items.length === 0 && (
                <tr><td colSpan={7} className="text-center py-10 text-slate-500">No automations configured yet</td></tr>
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
                  {ex.actionResult === "success" ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-500" />
                  ) : ex.actionResult === "failed" ? (
                    <XCircle className="w-4 h-4 text-red-400" />
                  ) : (
                    <AlertCircle className="w-4 h-4 text-amber-400" />
                  )}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-semibold text-slate-700 uppercase tracking-wide">
                      {triggerLabel[ex.triggerType] ?? ex.triggerType}
                    </span>
                    <span className="text-slate-300">→</span>
                    <span className="text-xs font-medium text-teal-700">
                      {actionLabel[ex.actionType] ?? ex.actionType}
                    </span>
                    <span className={`badge text-[10px] ${ex.actionResult === "success" ? "badge-green" : ex.actionResult === "failed" ? "badge-red" : "badge-amber"}`}>
                      {ex.actionResult.toUpperCase()}
                    </span>
                  </div>
                  {ex.resultDetail && (
                    <div className="text-xs text-slate-500 mt-0.5 truncate">{ex.resultDetail}</div>
                  )}
                  <div className="text-[10px] text-slate-500 mt-0.5 font-mono">{ex.ruleCode}</div>
                </div>
                <div className="text-xs text-slate-500 shrink-0 whitespace-nowrap">
                  {timeAgo(ex.executedAt)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="fixed bottom-6 left-64 z-50">
        <button className="px-4 py-2.5 rounded-xl shadow-lg text-sm font-semibold text-white flex items-center gap-2" style={{ background: "#0f766e" }}>
          <Plus className="w-4 h-4" /> New Workflow
        </button>
      </div>
    </div>
  );
}
