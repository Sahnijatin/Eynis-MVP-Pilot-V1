"use client";

import { useState, useRef } from "react";
import { TrendingUp, TrendingDown, AlertCircle, CheckCircle, XCircle, Clock, X, Building2, Briefcase, ShoppingBag, Home } from "lucide-react";

const QUOTES_INIT = [
  { id: "QT-0412", client: "Marriott Hotels", project: "Executive Suite Furniture — 24 Rooms", value: 28_00_000, margin: 34, status: "negotiating", sent: "18 May", expiry: "2 Jun" },
  { id: "QT-0411", client: "Kapoor Developers", project: "Luxury Villa Interiors — 3BHK", value: 12_50_000, margin: 41, status: "sent", sent: "20 May", expiry: "4 Jun" },
  { id: "QT-0410", client: "Patel Architects", project: "Commercial Office — 80 Workstations", value: 18_00_000, margin: 28, status: "won", sent: "5 May", expiry: "—" },
  { id: "QT-0409", client: "Sharma Retail", project: "Store Display Units × 60", value: 7_20_000, margin: 22, status: "lost", sent: "28 Apr", expiry: "—" },
  { id: "QT-0408", client: "The Leela Group", project: "Lobby + Lounge Furniture", value: 45_00_000, margin: 38, status: "draft", sent: "—", expiry: "—" },
  { id: "QT-0407", client: "Tata Housing", project: "Modular Kitchen Units × 120", value: 36_00_000, margin: 31, status: "sent", sent: "22 May", expiry: "6 Jun" }
];

const MARGIN_FLOOR = 25;

const TEMPLATES = [
  { id: "hospitality", Icon: Building2, name: "Hospitality Furniture Package", desc: "Hotel rooms, lobby seating, restaurant furniture", defaultProject: "Hospitality Furniture Package", defaultMargin: 35, color: "#0f766e" },
  { id: "office", Icon: Briefcase, name: "Office Workstation Setup", desc: "Workstations, conference tables, executive chairs", defaultProject: "Office Workstation Setup", defaultMargin: 32, color: "#1d4ed8" },
  { id: "retail", Icon: ShoppingBag, name: "Retail Display Units", desc: "Store fixtures, display stands, counter units", defaultProject: "Retail Display Units", defaultMargin: 38, color: "#7c3aed" },
  { id: "residential", Icon: Home, name: "Custom Residential Interior", desc: "Villa/apartment wardrobes, kitchen, living room", defaultProject: "Custom Residential Interior", defaultMargin: 42, color: "#ea580c" }
];

interface QuoteEntry {
  id: string; client: string; project: string; value: number; margin: number; status: string; sent: string; expiry: string;
}

function StatusBadge({ status }: { status: string }) {
  const map: Record<string, { label: string; color: string; bg: string; icon: typeof CheckCircle }> = {
    draft: { label: "Draft", color: "#64748b", bg: "#f1f5f9", icon: Clock },
    sent: { label: "Sent", color: "#1d4ed8", bg: "#eff6ff", icon: Clock },
    negotiating: { label: "Negotiating", color: "#d97706", bg: "#fef3c7", icon: AlertCircle },
    won: { label: "Won", color: "#059669", bg: "#d1fae5", icon: CheckCircle },
    lost: { label: "Lost", color: "#dc2626", bg: "#fee2e2", icon: XCircle }
  };
  const s = map[status] ?? map.draft;
  const Icon = s.icon;
  return (
    <span className="badge inline-flex items-center gap-1" style={{ background: s.bg, color: s.color }}>
      <Icon className="w-3 h-3" />{s.label}
    </span>
  );
}

function fmt(n: number) {
  if (n >= 100_000) return `₹${(n / 100_000).toFixed(1)}L`;
  return `₹${n.toLocaleString("en-IN")}`;
}

export default function QuotesPage() {
  const [quotes, setQuotes] = useState<QuoteEntry[]>(QUOTES_INIT);
  const [modalOpen, setModalOpen] = useState(false);
  const [step, setStep] = useState<"template" | "form">("template");
  const [selectedTemplate, setSelectedTemplate] = useState<typeof TEMPLATES[0] | null>(null);
  const [form, setForm] = useState({ client: "", project: "", value: "", margin: "", expiry: "", notes: "" });
  const [formError, setFormError] = useState("");
  const nextId = useRef(413);

  const defaultExpiry = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().split("T")[0];

  function openTemplate(t: typeof TEMPLATES[0] | null) {
    setSelectedTemplate(t);
    setForm({ client: "", project: t?.defaultProject ?? "", value: "", margin: String(t?.defaultMargin ?? 30), expiry: defaultExpiry, notes: "" });
    setStep("form");
    setFormError("");
  }

  function closeModal() {
    setModalOpen(false);
    setStep("template");
    setSelectedTemplate(null);
    setFormError("");
  }

  function submitQuote() {
    if (!form.client.trim()) { setFormError("Client name is required."); return; }
    if (!form.value || isNaN(Number(form.value)) || Number(form.value) <= 0) { setFormError("Enter a valid estimated value."); return; }
    const id = `QT-${String(nextId.current++).padStart(4, "0")}`;
    const today = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "short" });
    const expiryFmt = form.expiry ? new Date(form.expiry).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "—";
    setQuotes(prev => [
      { id, client: form.client, project: form.project || "Custom Project", value: Number(form.value), margin: Number(form.margin) || 30, status: "draft", sent: today, expiry: expiryFmt },
      ...prev
    ]);
    closeModal();
  }

  const active = quotes.filter(q => ["sent", "negotiating", "draft"].includes(q.status));
  const won = quotes.filter(q => q.status === "won");
  const totalPipeline = active.reduce((s, q) => s + q.value, 0);
  const avgMargin = Math.round(active.reduce((s, q) => s + q.margin, 0) / (active.length || 1));
  const closedCount = quotes.filter(q => ["won", "lost"].includes(q.status)).length;
  const winRate = closedCount > 0 ? Math.round((won.length / closedCount) * 100) : 0;
  const belowFloor = quotes.filter(q => q.margin < MARGIN_FLOOR && q.status !== "lost");

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-xl font-bold text-slate-800">Quote & Configurator Engine</h1>
          <p className="text-sm text-slate-500 mt-0.5">Live RFQ pipeline · margin floor enforced at {MARGIN_FLOOR}%</p>
        </div>
        <button
          onClick={() => { setModalOpen(true); setStep("template"); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
          style={{ background: "#1d4ed8" }}
        >
          + New Quote
        </button>
      </div>

      <div className="kpi-grid mb-5">
        <div className="card">
          <div className="kpi-label">Pipeline Value</div>
          <div className="kpi-value mt-1.5">{fmt(totalPipeline)}</div>
          <div className="kpi-delta up mt-1.5">↑ +12% vs last month</div>
        </div>
        <div className="card">
          <div className="kpi-label">Win Rate</div>
          <div className="kpi-value mt-1.5">{winRate}%</div>
          <div className="kpi-delta neutral mt-1.5">● {won.length} won of {closedCount}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Avg. Margin (Active)</div>
          <div className="kpi-value mt-1.5" style={{ color: avgMargin < MARGIN_FLOOR ? "#dc2626" : "#059669" }}>{avgMargin}%</div>
          <div className={`kpi-delta mt-1.5 ${avgMargin >= 30 ? "up" : "down"}`}>{avgMargin >= 30 ? "↑ Healthy margin" : "↓ Near floor"}</div>
        </div>
        <div className="card" style={{ borderTop: belowFloor.length > 0 ? "3px solid #f59e0b" : undefined }}>
          <div className="kpi-label">Below Margin Floor</div>
          <div className="kpi-value mt-1.5" style={{ color: belowFloor.length > 0 ? "#d97706" : "#059669" }}>{belowFloor.length}</div>
          <div className={`kpi-delta mt-1.5 ${belowFloor.length > 0 ? "down" : "up"}`}>{belowFloor.length > 0 ? `${belowFloor.length} quotes need review` : "All above floor"}</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-4">
            <h3 className="card-title mb-0">All Quotes</h3>
            <div className="flex gap-2">
              {["All", "Active", "Won", "Lost"].map(f => (
                <button key={f} className="text-xs px-2.5 py-1 rounded-lg border text-slate-500 hover:border-blue-300 hover:text-blue-600 transition-colors">{f}</button>
              ))}
            </div>
          </div>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-100">
                {["Quote ID", "Client", "Project", "Value", "Margin", "Status", "Expiry"].map(h => (
                  <th key={h} className="text-left py-2 px-2 text-xs font-semibold text-slate-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {quotes.map((q) => (
                <tr key={q.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors cursor-pointer">
                  <td className="py-2.5 px-2 font-mono text-xs text-blue-600 font-semibold">{q.id}</td>
                  <td className="py-2.5 px-2 font-medium text-slate-800">{q.client}</td>
                  <td className="py-2.5 px-2 text-slate-500 text-xs max-w-[180px] truncate">{q.project}</td>
                  <td className="py-2.5 px-2 font-semibold text-slate-700">{fmt(q.value)}</td>
                  <td className="py-2.5 px-2">
                    <div className="flex items-center gap-1.5">
                      <span className={`text-sm font-bold ${q.margin < MARGIN_FLOOR ? "text-red-600" : q.margin >= 35 ? "text-emerald-600" : "text-amber-600"}`}>{q.margin}%</span>
                      {q.margin >= 35 ? <TrendingUp className="w-3 h-3 text-emerald-500" /> : q.margin < MARGIN_FLOOR ? <TrendingDown className="w-3 h-3 text-red-500" /> : null}
                    </div>
                  </td>
                  <td className="py-2.5 px-2"><StatusBadge status={q.status} /></td>
                  <td className="py-2.5 px-2 text-xs text-slate-500">{q.expiry}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="flex flex-col gap-4">
          <div className="card">
            <div className="flex items-center gap-2 mb-3">
              <AlertCircle className="w-4 h-4 text-amber-500" />
              <h3 className="card-title mb-0">Margin Floor Policy</h3>
            </div>
            <div className="text-center py-4">
              <div className="text-4xl font-black text-slate-800">{MARGIN_FLOOR}%</div>
              <div className="text-xs text-slate-500 mt-1">Minimum acceptable margin</div>
            </div>
            <div className="space-y-3 mt-2">
              {quotes.filter(q => q.margin < MARGIN_FLOOR && q.status !== "lost").map(q => (
                <div key={q.id} className="p-2.5 rounded-lg border border-red-100 bg-red-50">
                  <div className="text-xs font-semibold text-red-700">{q.id} — {q.client}</div>
                  <div className="text-xs text-red-500 mt-0.5">Margin at {q.margin}% · Below floor by {MARGIN_FLOOR - q.margin}pp</div>
                </div>
              ))}
              {belowFloor.length === 0 && <div className="text-sm text-emerald-600 text-center py-2 font-medium">All active quotes above floor</div>}
            </div>
          </div>

          <div className="card">
            <h3 className="card-title">Quote Funnel</h3>
            <div className="space-y-2 mt-2">
              {[
                { label: "Draft", count: quotes.filter(q => q.status === "draft").length, color: "#64748b" },
                { label: "Sent", count: quotes.filter(q => q.status === "sent").length, color: "#1d4ed8" },
                { label: "Negotiating", count: quotes.filter(q => q.status === "negotiating").length, color: "#d97706" },
                { label: "Won", count: won.length, color: "#059669" },
                { label: "Lost", count: quotes.filter(q => q.status === "lost").length, color: "#dc2626" }
              ].map(s => (
                <div key={s.label} className="flex items-center gap-2">
                  <span className="text-xs text-slate-500 w-20">{s.label}</span>
                  <div className="flex-1 bg-slate-100 rounded-full h-2">
                    <div className="h-2 rounded-full" style={{ width: `${(s.count / quotes.length) * 100}%`, background: s.color }} />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 w-4">{s.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* New Quote Modal */}
      {modalOpen && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4" onClick={closeModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div>
                <h2 className="font-bold text-slate-800 text-base">
                  {step === "template" ? "New Quote" : `New Quote${selectedTemplate ? ` — ${selectedTemplate.name}` : " — Blank"}`}
                </h2>
                <p className="text-xs text-slate-400 mt-0.5">
                  {step === "template" ? "Choose a template to get started" : "Fill in the quote details"}
                </p>
              </div>
              <button onClick={closeModal} className="text-slate-400 hover:text-slate-600 p-1">
                <X className="w-5 h-5" />
              </button>
            </div>

            {step === "template" ? (
              <div className="px-6 py-5">
                <div className="grid grid-cols-2 gap-3 mb-4">
                  {TEMPLATES.map((t) => (
                    <button
                      key={t.id}
                      onClick={() => openTemplate(t)}
                      className="text-left p-4 rounded-xl border-2 border-slate-100 hover:border-slate-300 hover:shadow-sm transition-all"
                    >
                      <div className="w-9 h-9 rounded-lg flex items-center justify-center mb-3" style={{ background: t.color + "18" }}>
                        <t.Icon className="w-5 h-5" style={{ color: t.color }} />
                      </div>
                      <div className="font-semibold text-slate-800 text-sm mb-1">{t.name}</div>
                      <div className="text-xs text-slate-400 mb-2.5 leading-relaxed">{t.desc}</div>
                      <span className="text-xs px-2 py-0.5 rounded-full font-medium" style={{ background: t.color + "14", color: t.color }}>
                        Default margin: {t.defaultMargin}%
                      </span>
                    </button>
                  ))}
                </div>
                <button
                  onClick={() => openTemplate(null)}
                  className="w-full py-3 rounded-xl border-2 border-dashed border-slate-200 text-slate-500 text-sm font-medium hover:border-blue-300 hover:text-blue-600 transition-colors"
                >
                  + Start from scratch
                </button>
              </div>
            ) : (
              <div className="px-6 py-5">
                <div className="space-y-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                      Client Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                      placeholder="e.g. Marriott Hotels India"
                      value={form.client}
                      onChange={e => setForm(f => ({ ...f, client: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Project Description</label>
                    <input
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                      placeholder="Describe the project scope"
                      value={form.project}
                      onChange={e => setForm(f => ({ ...f, project: e.target.value }))}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">
                        Estimated Value (₹) <span className="text-red-500">*</span>
                      </label>
                      <input
                        type="number"
                        min="0"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                        placeholder="e.g. 500000"
                        value={form.value}
                        onChange={e => setForm(f => ({ ...f, value: e.target.value }))}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-semibold text-slate-600 mb-1.5">Target Margin (%)</label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                        placeholder="e.g. 35"
                        value={form.margin}
                        onChange={e => setForm(f => ({ ...f, margin: e.target.value }))}
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Quote Valid Until</label>
                    <input
                      type="date"
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100"
                      value={form.expiry}
                      onChange={e => setForm(f => ({ ...f, expiry: e.target.value }))}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Internal Notes</label>
                    <textarea
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-100 resize-none"
                      rows={2}
                      placeholder="Any internal notes for this quote..."
                      value={form.notes}
                      onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
                    />
                  </div>
                  {formError && <p className="text-xs text-red-600 font-medium">{formError}</p>}
                </div>
                <div className="flex gap-3 mt-6">
                  <button
                    onClick={() => setStep("template")}
                    className="flex-1 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold text-slate-600 hover:bg-slate-50 transition-colors"
                  >
                    Back
                  </button>
                  <button
                    onClick={submitQuote}
                    className="flex-1 py-2.5 rounded-lg text-sm font-semibold text-white transition-opacity hover:opacity-90"
                    style={{ background: "#1d4ed8" }}
                  >
                    Create Quote
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
