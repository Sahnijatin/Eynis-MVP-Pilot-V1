"use client";

import { useState } from "react";
import { X, Phone, Mail, MapPin, User, FileText, Clock, ChevronRight } from "lucide-react";

export interface DetailContact {
  person?: string;
  role?: string;
  phone?: string;
  email?: string;
  address?: string;
  extras?: Array<{ label: string; value: string }>;
}

export interface DetailHistoryItem {
  id: string;
  title: string;
  subtitle?: string;
  amount?: string;
  date: string;
  status: string;
  statusColor: string;
  statusBg: string;
}

export interface ClientDetailData {
  contact: DetailContact;
  history: DetailHistoryItem[];
  historyLabel: string;
  notes: string;
}

interface Props {
  open: boolean;
  onClose: () => void;
  name: string;
  subtitle: string;
  kpis: Array<{ label: string; value: string }>;
  detail: ClientDetailData;
  accentColor: string;
  headerChildren?: React.ReactNode;
}

type Tab = "overview" | "history" | "contact" | "notes";

function Avatar({ name, color }: { name: string; color: string }) {
  const initials = name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
  return (
    <div
      className="w-12 h-12 rounded-xl flex items-center justify-center text-white text-base font-bold shrink-0"
      style={{ background: color }}
    >
      {initials}
    </div>
  );
}

export function ClientDetailPanel({ open, onClose, name, subtitle, kpis, detail, accentColor, headerChildren }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [notes, setNotes] = useState(detail.notes);
  const [notesSaved, setNotesSaved] = useState(false);

  // When the panel is reused for a different entity (the parent swaps `name`
  // without unmounting), reset the per-entity state so we don't show the previous
  // client's notes/active tab. React's recommended "reset state on prop change".
  const [trackedName, setTrackedName] = useState(name);
  if (name !== trackedName) {
    setTrackedName(name);
    setNotes(detail.notes);
    setActiveTab("overview");
    setNotesSaved(false);
  }

  if (!open) return null;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "history", label: detail.historyLabel },
    { id: "contact", label: "Contact" },
    { id: "notes", label: "Notes" },
  ];

  function saveNotes() {
    setNotesSaved(true);
    setTimeout(() => setNotesSaved(false), 2000);
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-white shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-slate-100">
          <Avatar name={name} color={accentColor} />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-slate-800 text-base leading-tight truncate">{name}</h2>
            <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>
            {headerChildren && <div className="mt-1.5">{headerChildren}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-slate-500 hover:text-slate-600 p-1 rounded-lg hover:bg-slate-100 transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-slate-100 px-5 gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                activeTab === t.id
                  ? "border-current"
                  : "border-transparent text-slate-500 hover:text-slate-600"
              }`}
              style={activeTab === t.id ? { color: accentColor, borderColor: accentColor } : {}}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Tab content — scrollable */}
        <div className="flex-1 overflow-y-auto p-5">

          {/* OVERVIEW */}
          {activeTab === "overview" && (
            <div className="space-y-4">
              {/* KPIs */}
              <div className="grid grid-cols-2 gap-3">
                {kpis.map((k, i) => (
                  <div key={i} className="bg-slate-50 rounded-xl p-3.5">
                    <div className="text-xs text-slate-500 font-medium">{k.label}</div>
                    <div className="text-lg font-bold text-slate-800 mt-0.5">{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Recent activity */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-slate-500">
                    Recent {detail.historyLabel}
                  </h3>
                  <button
                    onClick={() => setActiveTab("history")}
                    className="text-xs font-medium flex items-center gap-0.5"
                    style={{ color: accentColor }}
                  >
                    View all <ChevronRight className="w-3 h-3" />
                  </button>
                </div>
                <div className="space-y-2">
                  {detail.history.slice(0, 3).map((item, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-slate-100 hover:bg-slate-50">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                        <Clock className="w-4 h-4" style={{ color: accentColor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-slate-800 truncate">{item.title}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-slate-500">{item.date}</span>
                          {item.subtitle && <span className="text-xs text-slate-500">{item.subtitle}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {item.amount && <div className="text-sm font-bold text-slate-700">{item.amount}</div>}
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded-md"
                          style={{ background: item.statusBg, color: item.statusColor }}>
                          {item.status}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* HISTORY */}
          {activeTab === "history" && (
            <div className="space-y-2">
              {detail.history.length === 0 ? (
                <div className="text-center py-12 text-slate-500 text-sm">No {detail.historyLabel.toLowerCase()} recorded yet</div>
              ) : (
                detail.history.map((item, i) => (
                  <div key={i} className="p-4 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-slate-500 font-mono mb-0.5">{item.id}</div>
                        <div className="text-sm font-semibold text-slate-800">{item.title}</div>
                        {item.subtitle && <div className="text-xs text-slate-500 mt-0.5">{item.subtitle}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        {item.amount && <div className="text-sm font-bold text-slate-800">{item.amount}</div>}
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: item.statusBg, color: item.statusColor }}
                        >
                          {item.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-slate-500">
                      <Clock className="w-3 h-3" />
                      {item.date}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* CONTACT */}
          {activeTab === "contact" && (
            <div className="space-y-3">
              {detail.contact.person && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <User className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Contact Person</div>
                    <div className="text-sm font-semibold text-slate-800">{detail.contact.person}</div>
                    {detail.contact.role && <div className="text-xs text-slate-500">{detail.contact.role}</div>}
                  </div>
                </div>
              )}
              {detail.contact.phone && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <Phone className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Phone</div>
                    <div className="text-sm font-semibold text-slate-800">{detail.contact.phone}</div>
                  </div>
                </div>
              )}
              {detail.contact.email && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <Mail className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Email</div>
                    <div className="text-sm font-semibold text-slate-800">{detail.contact.email}</div>
                  </div>
                </div>
              )}
              {detail.contact.address && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <MapPin className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">Address</div>
                    <div className="text-sm font-semibold text-slate-800">{detail.contact.address}</div>
                  </div>
                </div>
              )}
              {detail.contact.extras?.map((e, i) => (
                <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl bg-slate-50">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <FileText className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-slate-500">{e.label}</div>
                    <div className="text-sm font-semibold text-slate-800">{e.value}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* NOTES */}
          {activeTab === "notes" && (
            <div className="space-y-3">
              <textarea
                rows={10}
                className="w-full border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-700 focus:outline-none focus:ring-2 resize-none"
                style={{ "--tw-ring-color": accentColor } as React.CSSProperties}
                placeholder="Add internal notes about this client…"
                value={notes}
                onChange={e => setNotes(e.target.value)}
              />
              <button
                onClick={saveNotes}
                className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90"
                style={{ background: accentColor }}
              >
                {notesSaved ? "✓ Saved" : "Save Notes"}
              </button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}
