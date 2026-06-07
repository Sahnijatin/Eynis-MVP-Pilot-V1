"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { Download, Upload, UserPlus, Star, Search, CheckCircle, X, AlertCircle } from "lucide-react";
import { ClientDetailPanel, type ClientDetailData } from "./client-detail-panel";
import { escapeCSV, parseCSVLine } from "../../lib/csv";
import { TableEmpty } from "../ds";

// Parse a possibly-malformed date string from an imported CSV without throwing.
// `new Date("garbage").toISOString()` throws a RangeError, which would abort the
// entire import; fall back to "now" for unparseable values.
function safeIso(value: string | undefined): string {
  if (value) {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

export interface GuestRow {
  id: string;
  fullName: string;
  phoneE164: string;
  status: string;
  segment: string;
  lastStay: string;
  visitCount: number;
}

interface Props {
  items: GuestRow[];
  total: number;
  search?: string;
}

const segmentBadge: Record<string, string> = {
  VIP: "badge-amber",
  Business: "badge-blue",
  Family: "badge-green",
  Solo: "badge-slate",
  Couple: "badge-purple"
};

const statusBadge: Record<string, string> = {
  ACTIVE: "badge-green",
  "CHECK-OUT": "badge-slate",
  UPCOMING: "badge-amber"
};

const SEGMENTS = ["VIP", "Business", "Family", "Solo", "Couple"];
const STATUSES: Array<"ACTIVE" | "UPCOMING"> = ["ACTIVE", "UPCOMING"];

interface FormState {
  fullName: string;
  phone: string;
  email: string;
  segment: string;
  status: "ACTIVE" | "UPCOMING";
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

let nextId = 90001;

const EMPTY_FORM: FormState = { fullName: "", phone: "", email: "", segment: "Business", status: "ACTIVE" };

type ImportStatus = { type: "success"; count: number } | { type: "error"; message: string } | null;

function buildGuestDetail(g: GuestRow): ClientDetailData {
  return {
    historyLabel: "Stays & Requests",
    contact: {
      person: g.fullName,
      phone: g.phoneE164,
      extras: [
        { label: "Guest ID",    value: g.id },
        { label: "Segment",     value: g.segment },
        { label: "Status",      value: g.status },
        { label: "Visits",      value: String(g.visitCount) },
        { label: "Last stay",   value: formatDate(g.lastStay) },
      ],
    },
    history: [
      { id: g.id + "-1", title: "Last stay",      subtitle: g.segment === "VIP" ? "Suite · welcome amenities" : "Standard room", date: formatDate(g.lastStay), status: g.status, statusColor: g.status === "ACTIVE" ? "#059669" : "#475569", statusBg: g.status === "ACTIVE" ? "#d1fae5" : "#f1f5f9" },
    ],
    notes: g.segment === "VIP"
      ? "VIP — auto-welcome message at check-in, brief housekeeping daily."
      : "Add stay-level notes from the full profile page.",
  };
}

export function GuestDatabaseClient({ items: initialItems, total: initialTotal, search }: Props) {
  const [guests, setGuests] = useState<GuestRow[]>(initialItems);
  const [selected, setSelected] = useState<GuestRow | null>(null);
  const [total, setTotal] = useState(initialTotal);
  const [modalOpen, setModalOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM });
  const [importStatus, setImportStatus] = useState<ImportStatus>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function exportCSV() {
    const headers = ["Name", "Phone", "Status", "Segment", "Last Stay", "Visits"];
    const rows = guests.map(g => [g.fullName, g.phoneE164, g.status, g.segment, formatDate(g.lastStay), String(g.visitCount)]);
    const csv = [headers, ...rows].map(r => r.map(escapeCSV).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "guests-export.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setImportStatus({ type: "error", message: "Only .csv files are supported" });
      setTimeout(() => setImportStatus(null), 4000);
      return;
    }
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const text = (ev.target?.result as string) ?? "";
        const lines = text.split(/\r?\n/).filter(l => l.trim());
        if (lines.length < 2) {
          setImportStatus({ type: "error", message: "CSV has no data rows" });
          setTimeout(() => setImportStatus(null), 4000);
          return;
        }
        const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, "").toLowerCase().trim());
        const nameIdx     = headers.findIndex(h => h === "name" || h === "full name" || h === "fullname");
        const phoneIdx    = headers.findIndex(h => h === "phone" || h === "phone number");
        const statusIdx   = headers.findIndex(h => h === "status");
        const segmentIdx  = headers.findIndex(h => h === "segment");
        const lastStayIdx = headers.findIndex(h => h === "last stay" || h === "laststay");
        const visitsIdx   = headers.findIndex(h => h === "visits" || h === "visit count");
        if (nameIdx === -1) {
          setImportStatus({ type: "error", message: 'CSV must have a "Name" column' });
          setTimeout(() => setImportStatus(null), 4000);
          return;
        }
        const imported: GuestRow[] = lines.slice(1).map(line => {
          const cols = parseCSVLine(line).map(c => c.replace(/^"|"$/g, ""));
          const rawStatus = (cols[statusIdx] ?? "ACTIVE").toUpperCase();
          return {
            id: String(nextId++),
            fullName:   cols[nameIdx]    ?? "Unknown",
            phoneE164:  cols[phoneIdx]   ?? "—",
            status:     (rawStatus === "UPCOMING" || rawStatus === "CHECK-OUT") ? rawStatus : "ACTIVE",
            segment:    cols[segmentIdx] ?? "Solo",
            lastStay:   lastStayIdx >= 0 ? safeIso(cols[lastStayIdx]) : new Date().toISOString(),
            visitCount: visitsIdx >= 0 ? (parseInt(cols[visitsIdx], 10) || 1) : 1,
          };
        });
        setGuests(prev => [...imported, ...prev]);
        setTotal(prev => prev + imported.length);
        setImportStatus({ type: "success", count: imported.length });
        setTimeout(() => setImportStatus(null), 4000);
      } catch {
        setImportStatus({ type: "error", message: "Failed to parse CSV" });
        setTimeout(() => setImportStatus(null), 4000);
      }
    };
    reader.readAsText(file);
  }

  function openModal() {
    setForm({ ...EMPTY_FORM });
    setSuccess(false);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSuccess(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const newGuest: GuestRow = {
      id: String(nextId++),
      fullName: form.fullName,
      phoneE164: form.phone || "—",
      status: form.status,
      segment: form.segment,
      lastStay: new Date().toISOString(),
      visitCount: 1
    };
    setGuests(prev => [newGuest, ...prev]);
    setTotal(prev => prev + 1);
    setSuccess(true);
    setTimeout(closeModal, 1500);
  }

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Guest Database</h1>
            <p className="page-subtitle">Managing {total.toLocaleString()} sovereign entries across all tiers.</p>
          </div>
          <div className="flex items-center gap-2">
            <input
              ref={fileInputRef}
              type="file"
              accept=".csv"
              className="hidden"
              onChange={handleImport}
            />
            <button
              onClick={() => fileInputRef.current?.click()}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
            >
              <Upload className="w-3.5 h-3.5" /> Import
            </button>
            <button
              onClick={exportCSV}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" /> Export
            </button>
            <button
              onClick={openModal}
              className="px-4 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5"
              style={{ background: "var(--color-primary, #0f766e)" }}
            >
              <UserPlus className="w-3.5 h-3.5" /> Add New Guest
            </button>
          </div>
        </div>
      </div>

      {/* Import status toast */}
      {importStatus && (
        <div className={`mb-4 flex items-center gap-2 px-4 py-3 rounded-lg text-sm font-medium ${importStatus.type === "success" ? "bg-emerald-50 text-emerald-700 border border-emerald-200" : "bg-red-50 text-red-700 border border-red-200"}`}>
          {importStatus.type === "success"
            ? <><CheckCircle className="w-4 h-4 shrink-0" /> {importStatus.count} guest{importStatus.count !== 1 ? "s" : ""} imported successfully</>
            : <><AlertCircle className="w-4 h-4 shrink-0" /> {importStatus.message}</>
          }
        </div>
      )}

      {/* KPIs */}
      <div className="kpi-grid-3 mb-5">
        <div className="card">
          <div className="kpi-label">Total Records</div>
          <div className="kpi-value mt-1.5">{total.toLocaleString()}</div>
          <div className="kpi-delta up mt-1">+1.2%</div>
        </div>
        <div className="card">
          <div className="kpi-label">New This Month</div>
          <div className="kpi-value mt-1.5">324</div>
          <div className="mt-1"><span className="badge badge-green text-xs">On Target</span></div>
        </div>
        <div className="card" style={{ background: "#0f2d3d", color: "#fff" }}>
          <div className="text-xs uppercase tracking-wider font-medium" style={{ color: "#7ab8d4" }}>Repeat Guest Rate</div>
          <div className="text-2xl font-bold mt-1.5 text-white flex items-center gap-2">42% <span className="text-emerald-400 text-sm">↑</span></div>
        </div>
      </div>

      {/* Search + Filters */}
      <div className="card mb-4">
        <div className="flex items-center gap-3">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <form method="GET">
              <input
                name="search"
                defaultValue={search ?? ""}
                placeholder="Search by name, email or booking ID..."
                className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
              />
            </form>
          </div>
          <div className="flex items-center gap-2">
            <select className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 focus:outline-none">
              <option>All Segments</option>
              {SEGMENTS.map(s => <option key={s}>{s}</option>)}
            </select>
            <select className="px-3 py-2.5 rounded-lg border border-slate-200 text-sm text-slate-600 focus:outline-none">
              <option>Any Time</option>
              <option>Last 30 Days</option>
              <option>Last Quarter</option>
            </select>
          </div>
        </div>
      </div>

      {/* Table */}
      <div className="card">
        <div className="table-wrap">
          <table className="data-table">
            <thead>
              <tr>
                <th>Guest Name</th>
                <th>Status</th>
                <th>Segment</th>
                <th>Last Stay</th>
                <th>Visits</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id} onClick={() => setSelected(g)} className="cursor-pointer hover:bg-teal-50 transition-colors">
                  <td>
                    <div className="flex items-center gap-2.5">
                      <span className="w-8 h-8 rounded-full bg-teal-700 flex items-center justify-center text-white text-xs font-semibold">
                        {g.fullName.split(" ").map(w => w[0]).join("").slice(0, 2)}
                      </span>
                      <div>
                        <div className="text-sm font-medium text-slate-800 flex items-center gap-1.5">
                          {g.fullName}
                          {g.segment === "VIP" && <Star className="w-3 h-3 text-amber-400 fill-amber-400" />}
                        </div>
                        <div className="text-xs text-slate-400">{g.phoneE164}</div>
                      </div>
                    </div>
                  </td>
                  <td><span className={`badge ${statusBadge[g.status] ?? "badge-slate"}`}>{g.status}</span></td>
                  <td>
                    <span className={`badge ${segmentBadge[g.segment] ?? "badge-slate"} flex items-center gap-1`}>
                      {g.segment === "VIP" && <Star className="w-2.5 h-2.5 fill-current" />}
                      {g.segment}
                    </span>
                  </td>
                  <td className="text-slate-600 text-sm">{formatDate(g.lastStay)}</td>
                  <td className="font-semibold text-slate-700">{g.visitCount}</td>
                  <td>
                    <button
                      onClick={(e) => { e.stopPropagation(); setSelected(g); }}
                      className="text-sm font-medium hover:underline"
                      style={{ color: "var(--color-teal)" }}
                    >
                      View Profile
                    </button>
                    <Link href={`/guest-database/${g.id}`} className="ml-3 text-xs text-slate-400 hover:underline" onClick={(e) => e.stopPropagation()}>
                      Full page →
                    </Link>
                  </td>
                </tr>
              ))}
              {guests.length === 0 && (
                <TableEmpty colSpan={6} icon="👤" title="No records yet"
                  description="Records appear here as customers are added or imported." />
              )}
            </tbody>
          </table>
        </div>
        {total > 0 && (
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-slate-100">
            <span className="text-sm text-slate-500">Showing 1 to {Math.min(guests.length, total)} of {total.toLocaleString()} sovereign guests</span>
            <div className="flex items-center gap-1">
              {[1, 2, 3].map(p => (
                <button key={p} className={`w-8 h-8 rounded-lg text-sm font-medium ${p === 1 ? "text-white" : "text-slate-600 hover:bg-slate-100"}`}
                  style={p === 1 ? { background: "var(--color-primary, #0f766e)" } : {}}>{p}</button>
              ))}
              <span className="text-slate-400 px-1">...</span>
              <button className="w-8 h-8 rounded-lg text-sm text-slate-600 hover:bg-slate-100">{Math.ceil(total / 20)}</button>
            </div>
          </div>
        )}
      </div>

      {/* Add New Guest Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: "rgba(0,0,0,0.45)" }}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 pt-6 pb-4 border-b border-slate-100">
              <div>
                <h2 className="text-base font-bold text-slate-800">Add New Guest</h2>
                <p className="text-xs text-slate-500 mt-0.5">Create a new guest profile in the database</p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {success ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <CheckCircle className="w-12 h-12 text-emerald-500" />
                <p className="text-sm font-semibold text-slate-700">Guest added successfully!</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
                <div>
                  <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Full Name *</label>
                  <input
                    required
                    type="text"
                    placeholder="e.g. Rajesh Mehra"
                    value={form.fullName}
                    onChange={e => setForm(f => ({ ...f, fullName: e.target.value }))}
                    className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Phone</label>
                    <input
                      type="tel"
                      placeholder="+91 98765 43210"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                      className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Email</label>
                    <input
                      type="email"
                      placeholder="guest@email.com"
                      value={form.email}
                      onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
                      className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Segment</label>
                    <select
                      value={form.segment}
                      onChange={e => setForm(f => ({ ...f, segment: e.target.value }))}
                      className="mt-1.5 w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500"
                    >
                      {SEGMENTS.map(s => <option key={s}>{s}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs font-semibold text-slate-600 uppercase tracking-wider">Status</label>
                    <div className="mt-1.5 flex gap-2">
                      {STATUSES.map(s => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => setForm(f => ({ ...f, status: s }))}
                          className="flex-1 py-2 rounded-lg text-xs font-semibold transition-colors"
                          style={form.status === s
                            ? { background: "var(--color-primary, #0f766e)", color: "#fff" }
                            : { border: "1px solid #e2e8f0", color: "#475569" }}
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeModal}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit"
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white"
                    style={{ background: "var(--color-primary, #0f766e)" }}>
                    Add Guest
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {selected && (
        <ClientDetailPanel
          open={!!selected}
          onClose={() => setSelected(null)}
          name={selected.fullName}
          subtitle={`${selected.segment} · ${selected.visitCount} visit${selected.visitCount === 1 ? "" : "s"}`}
          kpis={[
            { label: "Visits",    value: String(selected.visitCount) },
            { label: "Last Stay", value: formatDate(selected.lastStay) },
            { label: "Segment",   value: selected.segment },
            { label: "Status",    value: selected.status },
          ]}
          detail={buildGuestDetail(selected)}
          accentColor="var(--color-primary, #0f766e)"
        />
      )}
    </>
  );
}
