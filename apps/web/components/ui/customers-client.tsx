"use client";

import { useState } from "react";
import { AlertCircle, TrendingUp, X, CheckCircle } from "lucide-react";
import type { IndustryTerminology } from "../../lib/industry-config";

const MFG_CLIENTS_INIT = [
  { name: "Marriott Hotels India", type: "Corporate", ltv: "₹1.84 Cr", lastOrder: "12 May 2025", orders: 14, status: "active", segment: "key" },
  { name: "Patel Architects LLP", type: "Architect/Channel", ltv: "₹68.4L", lastOrder: "22 May 2025", orders: 9, status: "active", segment: "channel" },
  { name: "Kapoor Developers", type: "Real Estate", ltv: "₹92.0L", lastOrder: "8 Apr 2025", orders: 7, status: "dormant_60", segment: "at-risk" },
  { name: "The Leela Group", type: "Hospitality", ltv: "₹2.1 Cr", lastOrder: "3 Jun 2024", orders: 22, status: "dormant_90", segment: "dormant" },
  { name: "Sharma Retail Chains", type: "Retail", ltv: "₹34.2L", lastOrder: "18 May 2025", orders: 5, status: "active", segment: "growth" },
  { name: "ITC Hotels", type: "Hospitality", ltv: "₹1.1 Cr", lastOrder: "26 May 2025", orders: 11, status: "active", segment: "key" },
  { name: "Tata Housing Ltd.", type: "Real Estate", ltv: "₹58.0L", lastOrder: "15 Mar 2025", orders: 8, status: "dormant_60", segment: "at-risk" }
];

const CLIENT_TYPES = ["Corporate", "Architect/Channel", "Real Estate", "Hospitality", "Retail"];

interface Client {
  name: string; type: string; ltv: string; lastOrder: string; orders: number; status: string; segment: string;
}

interface AddClientForm {
  name: string; type: string; contact: string; phone: string; ltv: string; segment: string;
}

function SegmentBadge({ segment }: { segment: string }) {
  const map: Record<string, { label: string; color: string; bg: string }> = {
    key: { label: "Key Account", color: "#1d4ed8", bg: "#eff6ff" },
    channel: { label: "Channel Partner", color: "#7c3aed", bg: "#f5f3ff" },
    growth: { label: "Growth", color: "#059669", bg: "#d1fae5" },
    "at-risk": { label: "At Risk", color: "#d97706", bg: "#fef3c7" },
    dormant: { label: "Dormant", color: "#dc2626", bg: "#fee2e2" }
  };
  const s = map[segment] ?? map.growth;
  return <span className="badge text-xs" style={{ background: s.bg, color: s.color }}>{s.label}</span>;
}

function StatusDot({ status }: { status: string }) {
  if (status === "active") return <span className="flex items-center gap-1 text-xs text-emerald-600"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" />Active</span>;
  if (status === "dormant_60") return <span className="flex items-center gap-1 text-xs text-amber-600"><span className="w-2 h-2 rounded-full bg-amber-400 inline-block" />60d dormant</span>;
  return <span className="flex items-center gap-1 text-xs text-red-600"><span className="w-2 h-2 rounded-full bg-red-500 inline-block animate-pulse" />90d+ dormant</span>;
}

export function CustomersClient({ terminology }: { terminology: IndustryTerminology }) {
  const [clients, setClients] = useState<Client[]>(MFG_CLIENTS_INIT);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<AddClientForm>({ name: "", type: "Corporate", contact: "", phone: "", ltv: "", segment: "growth" });
  const [formError, setFormError] = useState("");
  const [formSuccess, setFormSuccess] = useState(false);

  const active = clients.filter(c => c.status === "active").length;
  const dormant = clients.filter(c => c.status === "dormant_90").length;
  const atRisk = clients.filter(c => c.status === "dormant_60").length;

  function closeModal() {
    setModalOpen(false);
    setForm({ name: "", type: "Corporate", contact: "", phone: "", ltv: "", segment: "growth" });
    setFormError("");
    setFormSuccess(false);
  }

  function submitClient() {
    if (!form.name.trim()) { setFormError(`${terminology.entity} name is required.`); return; }
    const ltvDisplay = form.ltv ? (form.ltv.startsWith("₹") ? form.ltv : `₹${form.ltv}`) : "₹0";
    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
    setClients(prev => [
      { name: form.name.trim(), type: form.type, ltv: ltvDisplay, lastOrder: "—", orders: 0, status: "active", segment: form.segment },
      ...prev
    ]);
    setFormSuccess(true);
    setTimeout(closeModal, 1500);
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">{terminology.entityPlural} & Channel Intelligence</h1>
          <p className="text-sm text-slate-500 mt-0.5">Corporate accounts · architect network · dormant recovery</p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "#1d4ed8" }}
        >
          + Add {terminology.entity}
        </button>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Total {terminology.entityPlural}</div>
          <div className="kpi-value mt-1.5">{clients.length}</div>
          <div className="kpi-delta up mt-1.5">↑ 2 new this quarter</div>
        </div>
        <div className="card">
          <div className="kpi-label">Active (last 30d)</div>
          <div className="kpi-value mt-1.5" style={{ color: "#059669" }}>{active}</div>
          <div className="kpi-delta up mt-1.5">Revenue generating</div>
        </div>
        <div className="card" style={{ borderTop: atRisk > 0 ? "3px solid #f59e0b" : undefined }}>
          <div className="kpi-label">At Risk (60d)</div>
          <div className="kpi-value mt-1.5" style={{ color: "#d97706" }}>{atRisk}</div>
          <div className="kpi-delta down mt-1.5">Need re-engagement</div>
        </div>
        <div className="card" style={{ borderTop: dormant > 0 ? "3px solid #f43f5e" : undefined }}>
          <div className="kpi-label">Dormant (90d+)</div>
          <div className="kpi-value mt-1.5" style={{ color: "#dc2626" }}>{dormant}</div>
          <div className="kpi-delta down mt-1.5">Re-activation needed</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <h3 className="card-title mb-4">{terminology.entityPlural} Directory</h3>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {[terminology.entity, "Type", "Lifetime Value", "Last Order", "Orders", "Segment", "Status"].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {clients.map((c, i) => (
                <tr key={i} className={`border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer ${c.status === "dormant_90" ? "bg-red-50" : c.status === "dormant_60" ? "bg-amber-50" : ""}`}>
                  <td className="py-2.5 px-2 font-semibold text-slate-800">{c.name}</td>
                  <td className="py-2.5 px-2 text-xs text-slate-500">{c.type}</td>
                  <td className="py-2.5 px-2 font-semibold text-slate-700">{c.ltv}</td>
                  <td className="py-2.5 px-2 text-xs text-slate-500">{c.lastOrder}</td>
                  <td className="py-2.5 px-2 text-slate-600">{c.orders}</td>
                  <td className="py-2.5 px-2"><SegmentBadge segment={c.segment} /></td>
                  <td className="py-2.5 px-2"><StatusDot status={c.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-red-500" />
              <h3 className="card-title mb-0">Re-engagement Needed</h3>
            </div>
            {clients.filter(c => c.status !== "active").length === 0 ? (
              <div className="text-sm text-emerald-600 text-center py-4 font-medium">All clients active</div>
            ) : (
              clients.filter(c => c.status !== "active").map((c, i) => (
                <div key={i} className={`p-2.5 mb-2 rounded-lg ${c.status === "dormant_90" ? "bg-red-50 border border-red-100" : "bg-amber-50 border border-amber-100"}`}>
                  <div className={`text-xs font-semibold ${c.status === "dormant_90" ? "text-red-800" : "text-amber-800"}`}>{c.name}</div>
                  <div className={`text-xs mt-0.5 ${c.status === "dormant_90" ? "text-red-600" : "text-amber-600"}`}>
                    LTV: {c.ltv} · Last: {c.lastOrder}
                  </div>
                  <button className={`mt-1.5 text-xs font-medium px-2 py-1 rounded ${c.status === "dormant_90" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"}`}>
                    Send re-engagement via WhatsApp
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <TrendingUp className="w-4 h-4 text-blue-500" />
              <h3 className="card-title mb-0">Top by LTV</h3>
            </div>
            {clients.filter(c => c.segment === "key").map((c, i) => (
              <div key={i} className="flex items-center justify-between py-2 border-b border-slate-50 last:border-0">
                <div>
                  <div className="text-sm font-semibold text-slate-700">{c.name}</div>
                  <div className="text-xs text-slate-400">{c.orders} orders</div>
                </div>
                <div className="text-sm font-bold text-slate-800">{c.ltv}</div>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Add Client Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-800 text-base">Add {terminology.entity}</h2>
                <p className="text-xs text-slate-400 mt-0.5">New entry will appear in the directory immediately</p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            {formSuccess ? (
              <div className="px-6 py-12 text-center">
                <div className="w-12 h-12 bg-emerald-100 rounded-full flex items-center justify-center mx-auto mb-3">
                  <CheckCircle className="w-6 h-6 text-emerald-600" />
                </div>
                <div className="font-semibold text-emerald-700 text-sm">{terminology.entity} added successfully</div>
                <div className="text-xs text-slate-400 mt-1">Now visible in the directory</div>
              </div>
            ) : (
              <div className="px-6 py-5 space-y-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                    {terminology.entity} Name <span className="text-red-500">*</span>
                  </label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                    placeholder="e.g. Oberoi Hotels Ltd."
                    value={form.name}
                    onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
                  />
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Client Type</label>
                    <select
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 bg-white"
                      value={form.type}
                      onChange={e => setForm(f => ({ ...f, type: e.target.value }))}
                    >
                      {CLIENT_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Segment</label>
                    <select
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 bg-white"
                      value={form.segment}
                      onChange={e => setForm(f => ({ ...f, segment: e.target.value }))}
                    >
                      <option value="key">Key Account</option>
                      <option value="channel">Channel Partner</option>
                      <option value="growth">Growth</option>
                      <option value="at-risk">At Risk</option>
                    </select>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Contact Person</label>
                    <input
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                      placeholder="e.g. Rohit Sharma"
                      value={form.contact}
                      onChange={e => setForm(f => ({ ...f, contact: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Phone / Email</label>
                    <input
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400"
                      placeholder="+91 98XXX XXXXX"
                      value={form.phone}
                      onChange={e => setForm(f => ({ ...f, phone: e.target.value }))}
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-600 mb-1.5">Estimated LTV</label>
                  <input
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                    placeholder="e.g. ₹25L or 2500000"
                    value={form.ltv}
                    onChange={e => setForm(f => ({ ...f, ltv: e.target.value }))}
                  />
                </div>

                {formError && <p className="text-xs text-red-600 font-medium">{formError}</p>}

                <div className="flex gap-3 pt-1">
                  <button onClick={closeModal} className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors">
                    Cancel
                  </button>
                  <button onClick={submitClient} className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90" style={{ background: "#1d4ed8" }}>
                    Add {terminology.entity}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
