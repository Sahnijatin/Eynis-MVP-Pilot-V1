import { fetchQueueData } from "../../lib/data";
import { filtersToSearchString } from "../../lib/queue-filters";
import { QueueActionBanner } from "../../components/ui/queue-action-banner";
import { PendingForm, PendingSubmitButton } from "../../components/ui/pending-form";
import { AlertCircle, Clock, RefreshCw, Search, Users } from "lucide-react";

export const dynamic = "force-dynamic";

const categoryLabel: Record<string, string> = {
  housekeeping: "Housekeeping",
  maintenance: "Maintenance",
  fnb: "In-Room Dining",
  concierge: "Guest Services",
  front_desk: "Front Desk"
};

const statusBadge: Record<string, string> = {
  open: "badge badge-green",
  accepted: "badge badge-blue",
  escalated: "badge badge-red",
  resolved: "badge badge-slate"
};

const statusLabel: Record<string, string> = {
  open: "NEW",
  accepted: "IN-PROGRESS",
  escalated: "ESCALATED",
  resolved: "RESOLVED",
  pending: "PENDING"
};

const priorityColor: Record<string, string> = {
  urgent: "text-red-600 font-bold",
  high: "text-amber-600 font-semibold",
  normal: "text-slate-500"
};

function elapsedTimer(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h.toString().padStart(2,"0")}:${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
  return `${m.toString().padStart(2,"0")}:${s.toString().padStart(2,"0")}`;
}

function isOverdue(isoDate: string, minutes = 45) {
  return Date.now() - new Date(isoDate).getTime() > minutes * 60000;
}

export default async function QueuePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = searchParams ? await searchParams : {};
  const filters = {
    status: typeof query.status === "string" ? query.status : "",
    slaState: typeof query.slaState === "string" ? query.slaState : "",
    assignedToMe: typeof query.assignedToMe === "string" ? query.assignedToMe : "",
    sortBy: typeof query.sortBy === "string" ? query.sortBy : "",
    sortOrder: typeof query.sortOrder === "string" ? query.sortOrder : ""
  };
  const action = typeof query.action === "string" ? query.action : "";
  const result = typeof query.result === "string" ? query.result : "";
  const flashMsg = typeof query.msg === "string" ? query.msg : "";
  const returnSearch = filtersToSearchString(filters);

  let error = "";
  let queueItems: NonNullable<Awaited<ReturnType<typeof fetchQueueData>>["queue"]["items"]> = [];
  let userItems: NonNullable<Awaited<ReturnType<typeof fetchQueueData>>["users"]["items"]> = [];

  try {
    const response = await fetchQueueData(filters);
    queueItems = response.queue.items ?? [];
    userItems = response.users.items ?? [];
  } catch (err) {
    error = err instanceof Error ? err.message : "Failed to load service requests";
  }

  const userMap = Object.fromEntries(userItems.map((u) => [u.id, u.fullName]));

  const open = queueItems.filter(i => i.status === "open").length;
  const inProgress = queueItems.filter(i => i.status === "accepted").length;
  const escalated = queueItems.filter(i => i.status === "escalated").length;
  const staffWorkload = userItems.slice(0, 3).map((u, idx) => ({
    name: u.fullName,
    active: [4, 3, 1][idx] ?? 1
  }));

  return (
    <div>
      {/* Page header */}
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Service Requests</h1>
            <p className="page-subtitle">Manage live guest needs and staff assignments</p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
              {["Today","Week","Month"].map((t) => (
                <button key={t} className={`px-4 py-1.5 font-medium transition-colors ${t === "Today" ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}>{t}</button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
      {(action || flashMsg) && <QueueActionBanner action={action} result={result} flashMsg={flashMsg} filters={filters} />}

      {/* Summary KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #f59e0b" }}>
          <div className="kpi-label">Open Requests</div>
          <div className="kpi-value">{open}</div>
          <div className="text-xs text-slate-400 mt-1">active now</div>
        </div>
        <div className="card">
          <div className="kpi-label">In-Progress</div>
          <div className="kpi-value">{inProgress}</div>
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> staff assigned</div>
        </div>
        <div className="card" style={{ borderLeft: escalated > 0 ? "3px solid #ef4444" : undefined, background: escalated > 0 ? "#fff5f5" : undefined }}>
          <div className="kpi-label text-red-500">Escalations</div>
          <div className="kpi-value text-red-600">{escalated}</div>
          {escalated > 0 && <div className="text-xs text-red-400 mt-1 font-semibold uppercase tracking-wide">URGENT</div>}
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Resolution</div>
          <div className="kpi-value">18m</div>
          <div className="kpi-delta up mt-1">−2m ↓</div>
        </div>
      </div>

      {/* Main two-column */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Live Request Board */}
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title mb-0 flex items-center gap-2">
              Live Request Board
              <span className="badge badge-green text-[10px]">Auto-refreshing</span>
            </h3>
            <button className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-400 hover:bg-slate-100 transition-colors">
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Filters */}
          <div className="flex gap-2 mb-4">
            {["All","open","accepted","escalated","resolved"].map((s) => {
              const label = s === "All" ? "All" : statusLabel[s] ?? s;
              const active = (filters.status === s) || (s === "All" && !filters.status);
              return (
                <a key={s} href={s === "All" ? "/queue" : `/queue?status=${s}`}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${active ? "bg-teal-700 text-white" : "bg-slate-100 text-slate-600 hover:bg-slate-200"}`}>
                  {label}
                </a>
              );
            })}
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Room</th>
                  <th>Request Type</th>
                  <th>Description</th>
                  <th>Timer</th>
                  <th>Assigned To</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {queueItems.map((item) => {
                  const overdue = item.status !== "resolved" && isOverdue(item.createdAt);
                  return (
                    <tr key={item.id} className={overdue ? "bg-red-50" : ""}>
                      <td>
                        <span className={`font-semibold text-sm ${overdue ? "text-red-600" : "text-teal-700"}`}>
                          {Math.floor(Math.random() * 400 + 100)}
                        </span>
                      </td>
                      <td>
                        <span className="text-slate-700 font-medium text-sm">{categoryLabel[item.category] ?? item.category}</span>
                      </td>
                      <td>
                        <span className="text-slate-600 text-sm truncate max-w-xs block">{item.summary}</span>
                      </td>
                      <td>
                        <span className={`font-mono text-sm flex items-center gap-1 ${overdue ? "text-red-500 font-bold" : "text-slate-500"}`}>
                          <Clock className="w-3 h-3" />
                          {elapsedTimer(item.createdAt)}
                        </span>
                      </td>
                      <td>
                        {item.assignedToUserId ? (
                          <span className="flex items-center gap-1.5">
                            <span className="w-6 h-6 rounded-full bg-teal-700 flex items-center justify-center text-white text-[10px] font-semibold">
                              {(userMap[item.assignedToUserId] ?? "?").split(" ").map(w => w[0]).join("").slice(0, 2)}
                            </span>
                            <span className="text-sm text-slate-700">{(userMap[item.assignedToUserId] ?? "").split(" ")[0]}</span>
                          </span>
                        ) : (
                          <span className="text-slate-400 text-sm">Unassigned</span>
                        )}
                      </td>
                      <td><span className={statusBadge[item.status] ?? "badge badge-slate"}>{statusLabel[item.status] ?? item.status.toUpperCase()}</span></td>
                      <td>
                        {item.status !== "resolved" && (
                          <PendingForm action={`/api/requests/${item.id}/status`}>
                            <input type="hidden" name="status" value={item.status === "open" ? "accepted" : "resolved"} />
                            <PendingSubmitButton label={item.status === "open" ? "Accept" : "Resolve"} variant="secondary" />
                          </PendingForm>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {queueItems.length === 0 && (
                  <tr><td colSpan={7} className="text-center py-10 text-slate-400">No requests match the current filter</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
          {/* Staff Workload */}
          <div className="card">
            <div className="flex items-center justify-between mb-3">
              <h3 className="card-title mb-0">Staff Workload</h3>
              <span className="text-xs text-slate-400 uppercase tracking-wider">ACTIVE LOAD</span>
            </div>
            <div className="space-y-3">
              {staffWorkload.map((s) => (
                <div key={s.name}>
                  <div className="flex justify-between mb-1">
                    <span className="text-sm font-medium text-slate-700">{s.name}</span>
                    <span className="text-xs text-slate-500">{s.active} active</span>
                  </div>
                  <div className="progress-track">
                    <div className="progress-fill" style={{ width: `${Math.min(100, s.active * 25)}%` }} />
                  </div>
                </div>
              ))}
            </div>
            <button className="w-full mt-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 transition-colors">
              Reassign Tasks
            </button>
          </div>

          {/* Request Volume (mini chart) */}
          <div className="card flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="card-title mb-0">Request Volume</h3>
              <span className="text-xs text-slate-400">LAST 12H</span>
            </div>
            <div className="flex items-end gap-1 h-24">
              {[3,5,4,8,6,12,9,10,7,8,11,9].map((v, i) => (
                <div key={i} className="flex-1 rounded-sm" style={{ height: `${(v / 12) * 100}%`, background: i === 5 || i === 10 ? "#0f766e" : "#e2e8f0" }} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>8AM</span><span>12PM</span><span>4PM</span><span>8PM</span><span>10PM</span>
            </div>
          </div>
        </div>
      </div>

      {/* Recent Resolution Log */}
      <div className="card">
        <div className="flex items-center justify-between mb-4">
          <h3 className="card-title mb-0">Recent Resolution Log</h3>
          <a href="#" className="text-sm font-medium" style={{ color: "var(--color-teal)" }}>View History</a>
        </div>
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Room</th>
                <th>Request</th>
                <th>Completed by</th>
                <th>Total Time</th>
                <th>Guest Score</th>
              </tr>
            </thead>
            <tbody>
              {[
                { room: "402", req: "Mini-bar Restock", by: "Sanya K.", time: "14m 20s", stars: 4 },
                { room: "115", req: "Technical: TV Setup", by: "Marcus V.", time: "28m 05s", stars: 5 },
                { room: "312", req: "Extra Towels", by: "Elena R.", time: "08m 45s", stars: 5 },
                { room: "204", req: "Room Cleaning", by: "Amit S.", time: "22m 10s", stars: 4 }
              ].map((r, i) => (
                <tr key={i}>
                  <td className="font-semibold text-teal-700">{r.room}</td>
                  <td className="text-slate-700">{r.req}</td>
                  <td>
                    <span className="flex items-center gap-1.5">
                      <span className="w-5 h-5 rounded-full bg-teal-700 flex items-center justify-center text-white text-[9px] font-bold">
                        {r.by.split(" ").map(w => w[0]).join("")}
                      </span>
                      {r.by}
                    </span>
                  </td>
                  <td className="font-mono text-slate-600">{r.time}</td>
                  <td>
                    <div className="flex gap-0.5">
                      {Array.from({ length: 5 }, (_, j) => (
                        <span key={j} className={j < r.stars ? "text-amber-400" : "text-slate-200"}>★</span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
