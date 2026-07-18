import { fetchAutomations, fetchAutomationExecutions } from "../../lib/data";
import { getUserWorkspace } from "../../lib/workspace";
import { Plus, Zap, MessageSquare, RefreshCw, UserX, Star, ArrowRightCircle } from "lucide-react";
import { PreviewBanner } from "../../components/ui/preview-badge";
import { AutomationsClient } from "../../components/ui/automations-client";

export const dynamic = "force-dynamic";

const MFG_FLOWS = [
  { Icon: MessageSquare, trigger: "New enquiry lands", action: "AI-personalised first response within 5 minutes", detail: "WhatsApp + email · uses source, project type, signals from the enquiry", status: "active", executions: 84, conversions: 71 },
  { Icon: RefreshCw, trigger: "Quote sent · no response after 72hr", action: "Multi-touch follow-up kicks in", detail: "Day 3, day 7, day 14 with a new angle each time, then sales handoff", status: "active", executions: 38, conversions: 14 },
  { Icon: ArrowRightCircle, trigger: "Active opportunity", action: "Nurture content drip by evaluation stage", detail: "Relevant past work · spec sheets · finance options · FAQs", status: "active", executions: 22, conversions: 9 },
  { Icon: Zap, trigger: "Quote abandoned · day 30", action: "AI-personalised re-engagement", detail: "References the exact configuration · offers a reason to reopen", status: "active", executions: 17, conversions: 4 },
  { Icon: UserX, trigger: "Dormant client · predictive window hit", action: "Re-buy nudge with refurb suggestion", detail: "Triggered by time since last PO + refurb cycle prediction", status: "active", executions: 11, conversions: 3 },
  { Icon: Star, trigger: "Order delivered", action: "Satisfaction check → review or referral ask", detail: "Routes positive sentiment to Google · negative to your team to fix", status: "active", executions: 56, conversions: 48 }
];

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
            <h1 className="text-xl font-bold text-fg">Customer Journey Automations</h1>
            <p className="text-sm text-fg-muted mt-0.5">AI-built flows · triggered by data · personalised by AI · tracked end-to-end</p>
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
                    <span className="text-xs font-semibold text-fg-muted uppercase tracking-wide">Trigger</span>
                    <span className="text-sm font-semibold text-fg">{flow.trigger}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    {/* Neutral label — never the platform brand (white-label, 3.2). */}
                    <span className="text-xs font-semibold uppercase tracking-wide" style={{ color: config.accentColor }}>Action</span>
                    <span className="text-sm font-medium text-fg">{flow.action}</span>
                  </div>
                  <p className="text-xs text-fg-muted">{flow.detail}</p>
                </div>
                <div className="text-right shrink-0">
                  <div className="text-lg font-bold text-fg">{flow.executions}</div>
                  <div className="text-xs text-fg-muted">executions</div>
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

  // Hospitality: fetch live data from the API and hand it to the interactive
  // client (pause/resume rules, filter, export CSV).
  let data: Awaited<ReturnType<typeof fetchAutomations>> | null = null;
  let execData: Awaited<ReturnType<typeof fetchAutomationExecutions>> | null = null;
  let error = "";
  try {
    // 200 recent executions: 15 rows feed the log below, the rest feed the
    // per-day activity chart so it reflects real engine history.
    [data, execData] = await Promise.all([fetchAutomations(), fetchAutomationExecutions(200)]);
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load automations";
  }

  const summary = data?.summary ?? { totalAutomations: 0, activeFlows: 0, avgConversion: 0, revenueAttributed: 0, totalExecutions: 0 };

  return (
    <AutomationsClient
      initialItems={data?.items ?? []}
      initialSummary={summary}
      initialExecutions={execData?.items ?? []}
      error={error}
    />
  );
}
