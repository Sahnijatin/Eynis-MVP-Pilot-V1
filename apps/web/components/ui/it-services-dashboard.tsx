import Link from "next/link";
import { ChevronRight, ClipboardList, Ticket } from "lucide-react";
import { SmartInsights } from "./smart-insights";
import { fetchDashboardData } from "../../lib/data";

// IT / Tech Corporate help desk (#166) — every number traces to a real
// ServiceRequest (a "ticket") that arrived via the email/webhook intake doors and
// was classified by the IT_HELPDESK pack. No mock data: sourced entirely from the
// generic, tenant-scoped dashboard endpoints.

// Ticket taxonomy (IT_HELPDESK pack), in the order shown.
const TICKET_CATEGORIES: Array<{ key: string; label: string; color: string }> = [
  { key: "incident", label: "Incident", color: "#dc2626" },
  { key: "access", label: "Access", color: "#4f46e5" },
  { key: "hardware", label: "Hardware", color: "#f59e0b" },
  { key: "software", label: "Software", color: "#0ea5e9" },
  { key: "facilities", label: "Facilities", color: "#10b981" },
  { key: "hr_ops", label: "HR Ops", color: "#8b5cf6" },
];

export async function ItServicesDashboard() {
  const dash = await fetchDashboardData();
  const m = dash.overview?.metrics;
  const byCategory = dash.queueSummary?.byCategory ?? {};
  const recent = dash.liveFeed?.items ?? [];

  const open = m?.openCount ?? 0;
  const breached = m?.slaBreachedOpenCount ?? 0;
  const onTrackPct = open > 0 ? Math.round(((open - breached) / open) * 100) : 100;
  const maxCat = Math.max(1, ...TICKET_CATEGORIES.map((c) => byCategory[c.key] ?? 0));
  const totalByCat = TICKET_CATEGORIES.reduce((s, c) => s + (byCategory[c.key] ?? 0), 0);

  return (
    <div>
      <SmartInsights industry="it_services" />

      {/* Help desk KPIs — real tickets from email/webhook intake (#166) */}
      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Open Tickets</div>
          <div className="kpi-value mt-1.5">{open}</div>
          <div className="kpi-delta neutral mt-1.5">{m?.resolvedTodayCount ?? 0} resolved today</div>
        </div>
        <div className="card" style={{ borderTop: onTrackPct < 90 ? "3px solid #f59e0b" : undefined }}>
          <div className="kpi-label">SLA On-Track</div>
          <div className="kpi-value mt-1.5">{onTrackPct}%</div>
          <div className="kpi-delta neutral mt-1.5">{breached} past deadline</div>
        </div>
        <div className="card" style={{ borderTop: breached > 0 ? "3px solid #dc2626" : undefined }}>
          <div className="kpi-label">SLA Breached</div>
          <div className="kpi-value mt-1.5">{breached}</div>
          <div className="kpi-delta neutral mt-1.5">need immediate action</div>
        </div>
        <div className="card" style={{ borderTop: (m?.escalatedOpenCount ?? 0) > 0 ? "3px solid #f59e0b" : undefined }}>
          <div className="kpi-label">Escalations</div>
          <div className="kpi-value mt-1.5">{m?.escalatedOpenCount ?? 0}</div>
          <div className="kpi-delta neutral mt-1.5">routed to a supervisor</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Open by category */}
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-3">
            <h3 className="card-title mb-0">Open Tickets by Category</h3>
            <Link href="/queue" className="inline-flex items-center gap-1 text-sm font-medium text-slate-600 hover:text-slate-800">
              <ClipboardList className="w-4 h-4" /> Ticket queue <ChevronRight className="w-3.5 h-3.5" />
            </Link>
          </div>
          {totalByCat === 0 ? (
            <div className="py-4 text-sm text-slate-400">No open tickets — signal arrives via the email/webhook/CSV intake doors.</div>
          ) : (
            <div className="space-y-2">
              {TICKET_CATEGORIES.map((c) => {
                const n = byCategory[c.key] ?? 0;
                return (
                  <div key={c.key} className="flex items-center gap-3">
                    <div className="w-24 text-sm text-slate-600">{c.label}</div>
                    <div className="flex-1 h-2.5 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full rounded-full" style={{ width: `${(n / maxCat) * 100}%`, background: c.color }} />
                    </div>
                    <div className="w-8 text-right text-sm font-semibold text-slate-700">{n}</div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Recent tickets */}
        <div className="card">
          <div className="flex items-center gap-2 mb-3">
            <Ticket className="w-4 h-4 text-slate-500" />
            <h3 className="card-title mb-0">Recent Tickets</h3>
          </div>
          {recent.length === 0 ? (
            <div className="py-6 text-center text-sm text-slate-400">No recent tickets yet.</div>
          ) : (
            <div className="space-y-2">
              {recent.slice(0, 6).map((t) => (
                <div key={t.id} className="text-sm border-b border-slate-100 pb-2 last:border-0">
                  <div className="font-medium text-slate-700 truncate">{t.summary}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {t.category} · {t.priority}
                    {t.assignedTo?.fullName ? ` · ${t.assignedTo.fullName}` : ""}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
