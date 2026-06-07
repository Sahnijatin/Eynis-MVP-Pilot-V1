"use client";

import { useState } from "react";
import { AlertCircle, Clock, RefreshCw, Search, Download } from "lucide-react";
import { QueueActionBanner } from "./queue-action-banner";
import { PendingForm, PendingSubmitButton } from "./pending-form";
import { TableEmpty } from "../ds";

type Period = "Today" | "Week" | "Month";

export interface QueueItem {
  id: string;
  status: string;
  category: string;
  summary: string;
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

const PERIOD_KPIS: Record<Period, { open: number; inProgress: number; escalated: number; avgRes: string }> = {
  Today: { open: 0,   inProgress: 0,  escalated: 0,  avgRes: "18m" },  // overridden from live data
  Week:  { open: 142, inProgress: 28, escalated: 7,  avgRes: "22m" },
  Month: { open: 524, inProgress: 96, escalated: 31, avgRes: "19m" }
};

const PERIOD_VOLUME: Record<Period, Array<{ label: string; v: number }>> = {
  Today: [
    { label: "8AM",  v: 3  }, { label: "10AM", v: 5 }, { label: "12PM", v: 8 },
    { label: "2PM",  v: 6  }, { label: "4PM",  v: 12}, { label: "6PM",  v: 9 },
    { label: "8PM",  v: 10 }, { label: "10PM", v: 7 }
  ],
  Week: [
    { label: "Mon", v: 32 }, { label: "Tue", v: 41 }, { label: "Wed", v: 38 },
    { label: "Thu", v: 55 }, { label: "Fri", v: 48 }, { label: "Sat", v: 62 }, { label: "Sun", v: 44 }
  ],
  Month: [
    { label: "Wk 1", v: 142 }, { label: "Wk 2", v: 168 },
    { label: "Wk 3", v: 195 }, { label: "Wk 4", v: 178 }
  ]
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
  const [period, setPeriod] = useState<Period>("Today");

  const userMap = Object.fromEntries(users.map((u) => [u.id, u.fullName]));

  const liveOpen = items.filter(i => i.status === "open").length;
  const liveInProgress = items.filter(i => i.status === "accepted").length;
  const liveEscalated = items.filter(i => i.status === "escalated").length;
  const staffWorkload = users.slice(0, 3).map((u, idx) => ({ name: u.fullName, active: [4, 3, 1][idx] ?? 1 }));

  const kpis = period === "Today"
    ? { open: liveOpen, inProgress: liveInProgress, escalated: liveEscalated, avgRes: "18m" }
    : PERIOD_KPIS[period];

  const volumeBars = PERIOD_VOLUME[period];
  const maxVol = Math.max(...volumeBars.map(b => b.v));

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
            <div className="flex border border-slate-200 rounded-lg overflow-hidden text-sm">
              {(["Today", "Week", "Month"] as Period[]).map((t) => (
                <button
                  key={t}
                  onClick={() => setPeriod(t)}
                  className={`px-4 py-1.5 font-medium transition-colors ${t === period ? "bg-teal-700 text-white" : "text-slate-600 hover:bg-slate-50"}`}
                >
                  {t}
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>

      {(action || flashMsg) && <QueueActionBanner action={action} result={result} flashMsg={flashMsg} filters={filters} />}

      {/* KPIs */}
      <div className="kpi-grid mb-5">
        <div className="card" style={{ borderLeft: "3px solid #f59e0b" }}>
          <div className="kpi-label">Open Requests</div>
          <div className="kpi-value">{kpis.open}</div>
          <div className="text-xs text-slate-400 mt-1">{period === "Today" ? "active now" : `total this ${period.toLowerCase()}`}</div>
        </div>
        <div className="card">
          <div className="kpi-label">In-Progress</div>
          <div className="kpi-value">{kpis.inProgress}</div>
          <div className="text-xs text-slate-400 mt-1 flex items-center gap-1"><RefreshCw className="w-3 h-3" /> staff assigned</div>
        </div>
        <div className="card" style={{ borderLeft: kpis.escalated > 0 ? "3px solid #ef4444" : undefined, background: kpis.escalated > 0 ? "#fff5f5" : undefined }}>
          <div className="kpi-label text-red-500">Escalations</div>
          <div className="kpi-value text-red-600">{kpis.escalated}</div>
          {kpis.escalated > 0 && <div className="text-xs text-red-400 mt-1 font-semibold uppercase tracking-wide">URGENT</div>}
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Resolution</div>
          <div className="kpi-value">{kpis.avgRes}</div>
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
                {items.map((item, idx) => {
                  const overdue = item.status !== "resolved" && isOverdue(item.createdAt);
                  return (
                    <tr key={item.id} className={overdue ? "bg-red-50" : ""}>
                      <td>
                        <span className={`font-semibold text-sm ${overdue ? "text-red-600" : "text-teal-700"}`}>
                          {100 + ((idx * 47 + 312) % 400)}
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
                {items.length === 0 && (
                  <TableEmpty colSpan={7} icon="🔔" title="No requests here"
                    description="New requests appear as they arrive — or adjust the filters above." />
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Right column */}
        <div className="flex flex-col gap-4">
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

          {/* Request Volume — changes per period */}
          <div className="card flex-1">
            <div className="flex items-center justify-between mb-3">
              <h3 className="card-title mb-0">Request Volume</h3>
              <span className="text-xs text-slate-400 uppercase tracking-wider">{period === "Today" ? "LAST 12H" : period === "Week" ? "MON–SUN" : "WK1–WK4"}</span>
            </div>
            <div className="flex items-end gap-1 h-24">
              {volumeBars.map((b, i) => (
                <div key={i} className="flex-1 rounded-sm transition-all duration-300"
                  style={{ height: `${(b.v / maxVol) * 100}%`, background: i === Math.floor(volumeBars.length / 2) ? "#0f766e" : "#e2e8f0" }} />
              ))}
            </div>
            <div className="flex justify-between text-[10px] text-slate-400 mt-1">
              <span>{volumeBars[0]?.label}</span>
              <span>{volumeBars[Math.floor(volumeBars.length / 2)]?.label}</span>
              <span>{volumeBars[volumeBars.length - 1]?.label}</span>
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
                { room: "402", req: "Mini-bar Restock",   by: "Sanya K.",   time: "14m 20s", stars: 4 },
                { room: "115", req: "Technical: TV Setup", by: "Marcus V.", time: "28m 05s", stars: 5 },
                { room: "312", req: "Extra Towels",        by: "Elena R.",  time: "08m 45s", stars: 5 },
                { room: "204", req: "Room Cleaning",       by: "Amit S.",   time: "22m 10s", stars: 4 }
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
