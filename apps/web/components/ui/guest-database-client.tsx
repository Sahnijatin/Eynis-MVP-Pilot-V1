"use client";

import { useState, useRef } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Download, Upload, UserPlus, Star, Search, CheckCircle, AlertCircle } from "lucide-react";
import { ClientDetailPanel, type ClientDetailData } from "./client-detail-panel";
import { escapeCSV, parseCSVLine } from "../../lib/csv";
import { Modal, TableEmpty } from "../ds";

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
  offset: number;
  pageSize: number;
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

interface FormState {
  fullName: string;
  phone: string;
  email: string;
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", { year: "numeric", month: "short", day: "numeric" });
}

const EMPTY_FORM: FormState = { fullName: "", phone: "", email: "" };

type ImportStatus = { type: "success"; count: number; failed?: number } | { type: "error"; message: string } | null;

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
      { id: g.id + "-1", title: "Last stay", subtitle: `${g.visitCount} visit${g.visitCount === 1 ? "" : "s"} on record`, date: formatDate(g.lastStay), status: g.status, statusColor: g.status === "ACTIVE" ? "#059669" : "#475569", statusBg: g.status === "ACTIVE" ? "#d1fae5" : "#f1f5f9" },
    ],
    notes: "Add stay-level notes from the full profile page.",
  };
}

// Build the hrefs for server-driven pagination, preserving the active search.
function pageHref(offset: number, search?: string): string {
  const qs = new URLSearchParams();
  if (search) qs.set("search", search);
  if (offset > 0) qs.set("offset", String(offset));
  const s = qs.toString();
  return s ? `/guest-database?${s}` : "/guest-database";
}

export function GuestDatabaseClient({ items: guests, total, search, offset, pageSize }: Props) {
  const router = useRouter();
  const [selected, setSelected] = useState<GuestRow | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [success, setSuccess] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
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

  // Create one record through the real contacts API (guests and CRM contacts
  // share the Contact model). Returns true on success.
  async function createGuest(payload: { fullName: string; phone?: string; email?: string }): Promise<boolean> {
    try {
      const res = await fetch("/api/contacts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...payload, source: "manual" }),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean };
      return res.ok && data.ok;
    } catch {
      return false;
    }
  }

  async function handleImport(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!fileInputRef.current) return;
    fileInputRef.current.value = "";
    if (!file) return;
    if (!file.name.endsWith(".csv")) {
      setImportStatus({ type: "error", message: "Only .csv files are supported" });
      setTimeout(() => setImportStatus(null), 4000);
      return;
    }
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    if (lines.length < 2) {
      setImportStatus({ type: "error", message: "CSV has no data rows" });
      setTimeout(() => setImportStatus(null), 4000);
      return;
    }
    const headers = parseCSVLine(lines[0]).map(h => h.replace(/^"|"$/g, "").toLowerCase().trim());
    const nameIdx  = headers.findIndex(h => h === "name" || h === "full name" || h === "fullname");
    const phoneIdx = headers.findIndex(h => h === "phone" || h === "phone number");
    const emailIdx = headers.findIndex(h => h === "email");
    if (nameIdx === -1) {
      setImportStatus({ type: "error", message: 'CSV must have a "Name" column' });
      setTimeout(() => setImportStatus(null), 4000);
      return;
    }

    setBusy(true);
    let ok = 0;
    let failed = 0;
    try {
      for (const line of lines.slice(1)) {
        const cols = parseCSVLine(line).map(c => c.replace(/^"|"$/g, ""));
        const fullName = cols[nameIdx]?.trim();
        if (!fullName) continue;
        const created = await createGuest({
          fullName,
          phone: phoneIdx >= 0 ? cols[phoneIdx]?.trim() || undefined : undefined,
          email: emailIdx >= 0 ? cols[emailIdx]?.trim() || undefined : undefined,
        });
        if (created) ok++; else failed++;
      }
    } finally {
      setBusy(false);
    }
    setImportStatus(ok > 0 ? { type: "success", count: ok, failed } : { type: "error", message: "No rows could be imported." });
    setTimeout(() => setImportStatus(null), 5000);
    if (ok > 0) router.refresh();
  }

  function openModal() {
    setForm({ ...EMPTY_FORM });
    setSuccess(false);
    setSubmitError(null);
    setModalOpen(true);
  }

  function closeModal() {
    setModalOpen(false);
    setSuccess(false);
    setSubmitError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || !form.fullName.trim()) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const created = await createGuest({
        fullName: form.fullName.trim(),
        phone: form.phone.trim() || undefined,
        email: form.email.trim() || undefined,
      });
      if (created) {
        setSuccess(true);
        router.refresh();
        setTimeout(closeModal, 1500);
      } else {
        setSubmitError("Could not save this record — please try again.");
      }
    } finally {
      setBusy(false);
    }
  }

  const from = total === 0 ? 0 : offset + 1;
  const to = Math.min(offset + guests.length, total);
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;
  // Compact page window: first, last, and pages adjacent to the current one.
  const pageNumbers = Array.from({ length: totalPages }, (_, i) => i + 1)
    .filter(p => p === 1 || p === totalPages || Math.abs(p - currentPage) <= 1);

  return (
    <>
      <div className="page-header">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="page-title">Guest Database</h1>
            <p className="page-subtitle">Managing {total.toLocaleString()} guest record{total === 1 ? "" : "s"}.</p>
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
              disabled={busy}
              className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5 disabled:opacity-50"
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
            ? <><CheckCircle className="w-4 h-4 shrink-0" /> {importStatus.count} guest{importStatus.count !== 1 ? "s" : ""} imported{importStatus.failed ? ` · ${importStatus.failed} failed` : ""}</>
            : <><AlertCircle className="w-4 h-4 shrink-0" /> {importStatus.message}</>
          }
        </div>
      )}

      {/* Search */}
      <div className="card mb-4">
        <div className="flex-1 relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-500" />
          <form method="GET">
            <input
              name="search"
              defaultValue={search ?? ""}
              placeholder="Search by name or phone..."
              className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
            />
          </form>
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
                        <div className="text-xs text-slate-500">{g.phoneE164}</div>
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
                    <Link href={`/guest-database/${g.id}`} className="ml-3 text-xs text-slate-500 hover:underline" onClick={(e) => e.stopPropagation()}>
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
            <span className="text-sm text-slate-500">Showing {from.toLocaleString()} to {to.toLocaleString()} of {total.toLocaleString()} guests</span>
            {totalPages > 1 && (
              <div className="flex items-center gap-1">
                {pageNumbers.map((p, i) => {
                  const prev = pageNumbers[i - 1];
                  const gap = prev !== undefined && p - prev > 1;
                  return (
                    <span key={p} className="flex items-center gap-1">
                      {gap && <span className="text-slate-500 px-1">…</span>}
                      <Link
                        href={pageHref((p - 1) * pageSize, search)}
                        className={`w-8 h-8 rounded-lg text-sm font-medium flex items-center justify-center ${p === currentPage ? "text-white" : "text-slate-600 hover:bg-slate-100"}`}
                        style={p === currentPage ? { background: "var(--color-primary, #0f766e)" } : {}}
                      >
                        {p}
                      </Link>
                    </span>
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Add New Guest Modal */}
      {modalOpen && (
        <Modal title="Add New Guest" onClose={closeModal} width={448}>
            {success ? (
              <div className="flex flex-col items-center justify-center py-10 gap-3">
                <CheckCircle className="w-12 h-12 text-emerald-500" />
                <p className="text-sm font-semibold text-slate-700">Guest added successfully!</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                <p className="text-xs text-slate-500 -mt-1">Create a new guest profile in the database</p>
                {submitError && (
                  <div className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm bg-red-50 text-red-700 border border-red-200">
                    <AlertCircle className="w-4 h-4 shrink-0" /> {submitError}
                  </div>
                )}
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

                <div className="flex gap-3 pt-2">
                  <button type="button" onClick={closeModal}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold border border-slate-200 text-slate-600 hover:bg-slate-50">
                    Cancel
                  </button>
                  <button type="submit" disabled={busy}
                    className="flex-1 py-2.5 rounded-xl text-sm font-semibold text-white disabled:opacity-60"
                    style={{ background: "var(--color-primary, #0f766e)" }}>
                    {busy ? "Adding…" : "Add Guest"}
                  </button>
                </div>
              </form>
            )}
        </Modal>
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
