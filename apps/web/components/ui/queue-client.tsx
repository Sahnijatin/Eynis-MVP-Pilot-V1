"use client";

import { useRouter } from "next/navigation";
import { Clock, RefreshCw, Download } from "lucide-react";
import { QueueActionBanner } from "./queue-action-banner";
import { PendingForm, PendingSubmitButton } from "./pending-form";
import { TableEmpty } from "../ds";

export interface QueueItem {
  id: string;
  status: string;
  category: string;
  summary: string;
  priority?: string;
  createdAt: string;
  assignedToUserId?: string | null;
}

export interface UserItem {
  id: string;
  fullName: string;
}

export interface QueueFilters {
  status: string;
  slaState: string;
  assignedToMe: string;
  sortBy: string;
  sortOrder: string;
}

interface Props {
  items: QueueItem[];
  users: UserItem[];
  filters: QueueFilters;
  action: string;
  result: string;
  flashMsg: string;
  returnSearch: string;
}

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

// Priority → badge style. Priorities come from the API's classification.
const priorityBadge: Record<string, string> = {
  urgent: "badge badge-red",
  high: "badge badge-red",
  medium: "badge badge-blue",
  low: "badge badge-slate"
};

function elapsedTimer(isoDate: string) {
  const diff = Date.now() - new Date(isoDate).getTime();
  const totalSec = Math.floor(diff / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function isOverdue(isoDate: string, minutes = 45) {
  return Date.now() - new Date(isoDate).getTime() > minutes * 60000;
}

export function QueueClient({ items, users, filters, action, result, flashMsg, returnSearch }: Props) {
  const router = useRouter();
  const userMap = Object.fromEntries(users.map((u) => [u.id, u.fullName]));

  const kpis = {
    open: items.filter(i => i.status === "open").length,
    inProgress: items.filter(i => i.status === "accepted").length,
    escalated: items.filter(i => i.status === "escalated").length,
    unassigned: items.filter(i => !i.assignedToUserId && i.status !== "resolved").length
  };

  // Real per-user active load, computed from the requests on screen.
  const activeByUser = new Map<string, number>();
  for (const i of items) {
    if (i.assignedToUserId && i.status !== "resolved") {
      activeByUser.set(i.assignedToUserId, (activeByUser.get(i.assignedToUserId) ?? 0) + 1);
    }
  }
  const staffWorkload = users
    .map((u) => ({ name: u.fullName, active: activeByUser.get(u.id) ?? 0 }))
    .filter((s) => s.active > 0)
    .sort((a, b) => b.active - a.active)
    .slice(0, 5);
  const maxActive = Math.max(1, ...staffWorkload.map((s) => s.active));

  return (
    <div>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Service Requests</h1>
            <p className="page-subtitle">Manage live guest needs and staff assignments</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Branded CSV export (E-9), honoring the active status filter. */}
            <a
              href={`/api/service-requests/export${filters.status ? `?status=${encodeURIComponent(filters.status)}` : ""}`}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
            >
              <Download className="w-3.5 h-3.5" /> Export CSV
            </a>
          </div>
        </div>
      </div>

      {(action || flashMsg) && <QueueActionBanner action={action} result={result} flashMsg={flashMsg} filters={filters} />}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #f59e0b" }}>
          <div className="kpi-label">Open Requests</div>
          <div className="kpi-value">{kpis.open}</div>
          <div className="text-xs text-slate-500 mt-1">active now</div>
        </div>
        <div className="card">
          <div className="kpi-label">In-Progress</div>
          <div className="kpi-value">{kpis.inProgress}</div>
          <div className="text-xs text-slate-500 mt-1 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> staff assigned</div>
        </div>
        <div className="card" style={{ borderLeft: kpis.escalated > 0 ? "3px solid #ef4444" : undefined, background: kpis.escalated > 0 ? "#fff5f5" : undefined }}>
          <div className="kpi-label text-red-500">Escalations</div>
          <div className="kpi-value text-red-600">{kpis.escalated}</div>
          {kpis.escalated > 0 && <div className="text-xs text-red-400 mt-1 font-semibold uppercase tracking-wide">URGENT</div>}
        </div>
        <div className="card">
          <div className="kpi-label">Unassigned</div>
          <div className="kpi-value">{kpis.unassigned}</div>
          <div className="text-xs text-slate-500 mt-1">awaiting an owner</div>
        </div>
      </div>

      {/* Main two-column */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* Live Request Board */}
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title mb-0">Live Request Board</h3>
            <button
              onClick={() => router.refresh()}
              aria-label="Refresh requests"
              className="w-7 h-7 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 transition-colors"
            >
              <RefreshCw className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Status filter tabs */}
          <div className="flex gap-2 mb-4">
            {["All", "open", "accepted", "escalated", "resolved"].map((s) => {
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
                  <th>Priority</th>
                  <th>Request Type</th>
                  <th>Description</th>
                  <th>Timer</th>
                  <th>Assigned To</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {items.map((item) => {
                  const overdue = item.status !== "resolved" && isOverdue(item.createdAt);
                  return (
                    <tr key={item.id} className={overdue ? "bg-red-50" : ""}>
                      <td>
                        <span className={priorityBadge[item.priority ?? ""] ?? "badge badge-slate"}>
                          {(item.priority ?? "—").toUpperCase()}
                        </span>
                      </td>
                      <td><span className="text-slate-700 font-medium text-sm">{categoryLabel[item.category] ?? item.category}</span></td>
                      <td><span className="text-slate-600 text-sm truncate max-w-xs block">{item.summary}</span></td>
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
                          <span className="text-slate-500 text-sm">Unassigned</span>
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
                {items.length === 0 && (
                  <TableEmpty colSpan={7} icon="🔔" title="No requests here"
                    description="New requests appear as they arrive — or adjust the filters above." />
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column — real per-user active load from the visible requests. */}
        <div className="flex flex-col gap-4">
          <div className="card flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="card-title mb-0">Staff Workload</h3>
              <span className="text-xs text-slate-500 uppercase tracking-wider">ACTIVE LOAD</span>
            </div>
            {staffWorkload.length === 0 ? (
              <p className="text-sm text-slate-500">No requests are assigned right now.</p>
            ) : (
              <div className="space-y-3">
                {staffWorkload.map((s) => (
                  <div key={s.name}>
                    <div className="flex justify-between mb-1">
                      <span className="text-sm font-medium text-slate-700">{s.name}</span>
                      <span className="text-xs text-slate-500">{s.active} active</span>
                    </div>
                    <div className="progress-track">
                      <div className="progress-fill" style={{ width: `${(s.active / maxActive) * 100}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
