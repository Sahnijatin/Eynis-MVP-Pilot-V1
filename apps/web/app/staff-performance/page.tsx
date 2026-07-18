import { AlertTriangle } from "lucide-react";
import { fetchStaffPerformance } from "../../lib/data";
import { DateRangeControl } from "../../components/ui/date-range-control";

export const dynamic = "force-dynamic";

const prettyRole = (r: string) => r.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
const mins = (m: number) => `${Math.floor(m)}m ${Math.round((m % 1) * 60)}s`;
const initials = (name: string) => name.trim().split(/\s+/).filter(Boolean).map((w) => w[0]).slice(0, 2).join("").toUpperCase() || "—";

// Staff Performance — now backed by the real /analytics/staff-performance endpoint
// (#128, replacing the former static mock). Date-range aware (E-15); renders only
// real data (summary, leaderboard, workload, alerts). Industry-neutral copy.
export default async function StaffPerformancePage({
  searchParams,
}: {
  searchParams?: Promise<{ from?: string; to?: string }>;
}) {
  const sp = (await searchParams) ?? {};
  const data = await fetchStaffPerformance(sp.from, sp.to);
  const { summary, leaderboard, workloadByRole, alerts } = data;
  const hasData = leaderboard.length > 0 || workloadByRole.length > 0;
  const rangeLabel = sp.from && sp.to ? `${sp.from} → ${sp.to}` : "all time";

  return (
    <div>
      <div className="page-header">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h1 className="page-title">Staff Performance</h1>
            <p className="page-subtitle">Team efficiency and customer satisfaction — {rangeLabel}</p>
          </div>
          <DateRangeControl defaultPreset="30d" />
        </div>
      </div>

      {!hasData && (
        <div className="card mb-5" style={{ background: "#f8fafc" }}>
          <p className="text-sm text-fg-muted">No team activity in this window yet. Metrics populate as requests are assigned and resolved.</p>
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid var(--color-primary, #0f766e)" }}>
          <div className="kpi-label">Avg. Resolution Time</div>
          <div className="kpi-value mt-1.5">{summary.avgResolutionMinutes > 0 ? mins(summary.avgResolutionMinutes) : "—"}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Task Completion Rate</div>
          <div className="kpi-value mt-1.5">{summary.completionRate.toFixed(1)}%</div>
          <div className="mt-2 progress-track"><div className="progress-fill" style={{ width: `${Math.min(100, summary.completionRate)}%` }} /></div>
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Customer Rating</div>
          <div className="kpi-value mt-1.5">{summary.avgGuestRating === null ? "—" : `${summary.avgGuestRating.toFixed(1)}/5`}</div>
          <div className="text-xs text-fg-muted mt-1">{summary.avgGuestRating === null ? "No feedback yet" : "from sentiment feedback"}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Staff Utilization</div>
          <div className="kpi-value mt-1.5">{Math.round(summary.utilizationRate)}%</div>
          <div className="text-xs text-fg-muted mt-1">Active vs available staff</div>
        </div>
      </div>

      {/* Leaderboard */}
      <div className="card mb-4">
        <h3 className="card-title">Performance Leaderboard</h3>
        {leaderboard.length === 0 ? (
          <p className="text-sm text-fg-muted">No resolved tasks in this window.</p>
        ) : (
          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr><th>#</th><th>Name</th><th>Role</th><th>Completed</th><th>Avg. Resolution</th></tr>
              </thead>
              <tbody>
                {leaderboard.map((s, i) => (
                  <tr key={s.userId}>
                    <td><span className="w-6 h-6 rounded-full bg-warn-bg text-warn text-xs font-bold flex items-center justify-center">{i + 1}</span></td>
                    <td>
                      <span className="flex items-center gap-2">
                        <span className="w-7 h-7 rounded-full bg-accent flex items-center justify-center text-accent-contrast text-[10px] font-semibold">{initials(s.fullName)}</span>
                        <span className="font-medium text-fg text-sm">{s.fullName}</span>
                      </span>
                    </td>
                    <td className="text-fg-muted text-sm">{prettyRole(s.role)}</td>
                    <td className="font-semibold text-fg">{s.completedTasks}</td>
                    <td className="font-mono text-sm text-fg-muted">{s.avgResolutionMinutes > 0 ? mins(s.avgResolutionMinutes) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Workload by role */}
        <div className="card lg:col-span-2">
          <h3 className="card-title">Workload by Role</h3>
          {workloadByRole.length === 0 ? (
            <p className="text-sm text-fg-muted">No workload data.</p>
          ) : (
            <div className="space-y-3 mt-2">
              {workloadByRole.map((w) => {
                const total = w.openTasks + w.resolvedTasks;
                const resolvedPct = total > 0 ? (w.resolvedTasks / total) * 100 : 0;
                const openPct = total > 0 ? (w.openTasks / total) * 100 : 0;
                return (
                  <div key={w.role}>
                    <div className="flex justify-between mb-1.5">
                      <span className="text-sm font-medium text-fg">{prettyRole(w.role)}</span>
                      <span className="text-xs text-fg-muted">{w.resolvedTasks} / {total} tasks</span>
                    </div>
                    <div className="w-full h-2.5 rounded-full bg-surface-inset overflow-hidden flex">
                      <div className="h-full rounded-full" style={{ width: `${resolvedPct}%`, background: "var(--color-primary, #0f766e)" }} />
                      <div className="h-full" style={{ width: `${openPct}%`, background: "#e2e8f0" }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
          <div className="flex gap-4 mt-3 text-xs text-fg-muted">
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full inline-block" style={{ background: "var(--color-primary, #0f766e)" }} />Completed</span>
            <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-full bg-surface-inset inline-block" />Open / pending</span>
          </div>
        </div>

        {/* Alerts (real) */}
        <div className="card">
          <h3 className="card-title">Staffing Alerts</h3>
          {alerts.length === 0 ? (
            <p className="text-sm text-fg-muted">No alerts — workload looks balanced.</p>
          ) : (
            <div className="space-y-2 mt-2">
              {alerts.map((a, i) => (
                <div key={i} className="flex items-start gap-2 p-3 rounded-lg bg-warn-bg border border-warn-border">
                  <AlertTriangle className="w-4 h-4 text-warn shrink-0 mt-0.5" />
                  <div className="text-sm text-warn">{a}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
