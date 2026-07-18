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
  // Stable identity for per-entity state resets (falls back to `name`).
  entityId?: string;
  // Persist the notes; resolve true on success. When absent the Notes tab is
  // read-only — an editable field whose save goes nowhere is worse than none.
  onSaveNotes?: (notes: string) => Promise<boolean>;
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

export function ClientDetailPanel({ open, onClose, name, subtitle, kpis, detail, accentColor, headerChildren, entityId, onSaveNotes }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [notes, setNotes] = useState(detail.notes);
  const [notesDirty, setNotesDirty] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);

  // When the panel is reused for a different entity (the parent swaps props
  // without unmounting), reset the per-entity state so we don't show the previous
  // client's notes/active tab. React's recommended "reset state on prop change".
  const key = entityId ?? name;
  const [trackedKey, setTrackedKey] = useState(key);
  const [trackedNotes, setTrackedNotes] = useState(detail.notes);
  if (key !== trackedKey) {
    setTrackedKey(key);
    setTrackedNotes(detail.notes);
    setNotes(detail.notes);
    setNotesDirty(false);
    setActiveTab("overview");
    setNotesSaved(false);
    setSaveError(false);
  } else if (detail.notes !== trackedNotes) {
    // Same entity, fresher notes from the parent (async load) — adopt them
    // unless the user has already started editing.
    setTrackedNotes(detail.notes);
    if (!notesDirty) setNotes(detail.notes);
  }

  if (!open) return null;

  const tabs: Array<{ id: Tab; label: string }> = [
    { id: "overview", label: "Overview" },
    { id: "history", label: detail.historyLabel },
    { id: "contact", label: "Contact" },
    { id: "notes", label: "Notes" },
  ];

  async function saveNotes() {
    if (!onSaveNotes || saving) return;
    setSaving(true);
    setSaveError(false);
    try {
      const ok = await onSaveNotes(notes);
      if (ok) {
        setNotesDirty(false);
        setNotesSaved(true);
        setTimeout(() => setNotesSaved(false), 2000);
      } else {
        setSaveError(true);
      }
    } catch {
      setSaveError(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/30 z-40 transition-opacity"
        onClick={onClose}
      />

      {/* Panel */}
      <div className="fixed right-0 top-0 bottom-0 w-[480px] bg-surface shadow-2xl z-50 flex flex-col">
        {/* Header */}
        <div className="flex items-start gap-3 px-5 py-4 border-b border-line">
          <Avatar name={name} color={accentColor} />
          <div className="flex-1 min-w-0">
            <h2 className="font-bold text-fg text-base leading-tight truncate">{name}</h2>
            <p className="text-xs text-fg-muted mt-0.5">{subtitle}</p>
            {headerChildren && <div className="mt-1.5">{headerChildren}</div>}
          </div>
          <button
            onClick={onClose}
            className="text-fg-muted hover:text-fg-muted p-1 rounded-lg hover:bg-surface-inset transition-colors shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-line px-5 gap-1">
          {tabs.map(t => (
            <button
              key={t.id}
              onClick={() => setActiveTab(t.id)}
              className={`px-3 py-2.5 text-xs font-semibold border-b-2 transition-colors -mb-px ${
                activeTab === t.id
                  ? "border-current"
                  : "border-transparent text-fg-muted hover:text-fg-muted"
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
                  <div key={i} className="bg-surface-inset rounded-xl p-3.5">
                    <div className="text-xs text-fg-muted font-medium">{k.label}</div>
                    <div className="text-lg font-bold text-fg mt-0.5">{k.value}</div>
                  </div>
                ))}
              </div>

              {/* Recent activity */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-xs font-semibold uppercase tracking-wider text-fg-muted">
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
                    <div key={i} className="flex items-start gap-3 p-3 rounded-lg border border-line hover:bg-surface-inset">
                      <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                        <Clock className="w-4 h-4" style={{ color: accentColor }} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-fg truncate">{item.title}</div>
                        <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                          <span className="text-xs text-fg-muted">{item.date}</span>
                          {item.subtitle && <span className="text-xs text-fg-muted">{item.subtitle}</span>}
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {item.amount && <div className="text-sm font-bold text-fg">{item.amount}</div>}
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
                <div className="text-center py-12 text-fg-muted text-sm">No {detail.historyLabel.toLowerCase()} recorded yet</div>
              ) : (
                detail.history.map((item, i) => (
                  <div key={i} className="p-4 rounded-xl border border-line hover:bg-surface-inset transition-colors">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs text-fg-muted font-mono mb-0.5">{item.id}</div>
                        <div className="text-sm font-semibold text-fg">{item.title}</div>
                        {item.subtitle && <div className="text-xs text-fg-muted mt-0.5">{item.subtitle}</div>}
                      </div>
                      <div className="text-right shrink-0">
                        {item.amount && <div className="text-sm font-bold text-fg">{item.amount}</div>}
                        <span
                          className="text-[10px] font-semibold px-2 py-0.5 rounded-full"
                          style={{ background: item.statusBg, color: item.statusColor }}
                        >
                          {item.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 mt-2 text-xs text-fg-muted">
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
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-inset">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <User className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Contact Person</div>
                    <div className="text-sm font-semibold text-fg">{detail.contact.person}</div>
                    {detail.contact.role && <div className="text-xs text-fg-muted">{detail.contact.role}</div>}
                  </div>
                </div>
              )}
              {detail.contact.phone && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-inset">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <Phone className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Phone</div>
                    <div className="text-sm font-semibold text-fg">{detail.contact.phone}</div>
                  </div>
                </div>
              )}
              {detail.contact.email && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-inset">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <Mail className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Email</div>
                    <div className="text-sm font-semibold text-fg">{detail.contact.email}</div>
                  </div>
                </div>
              )}
              {detail.contact.address && (
                <div className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-inset">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <MapPin className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">Address</div>
                    <div className="text-sm font-semibold text-fg">{detail.contact.address}</div>
                  </div>
                </div>
              )}
              {detail.contact.extras?.map((e, i) => (
                <div key={i} className="flex items-center gap-3 p-3.5 rounded-xl bg-surface-inset">
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0" style={{ background: `${accentColor}15` }}>
                    <FileText className="w-4 h-4" style={{ color: accentColor }} />
                  </div>
                  <div>
                    <div className="text-xs text-fg-muted">{e.label}</div>
                    <div className="text-sm font-semibold text-fg">{e.value}</div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* NOTES */}
          {activeTab === "notes" && (
            onSaveNotes ? (
              <div className="space-y-3">
                <textarea
                  rows={10}
                  className="w-full border border-line rounded-xl px-4 py-3 text-sm text-fg focus:outline-none focus:ring-2 resize-none"
                  style={{ "--tw-ring-color": accentColor } as React.CSSProperties}
                  placeholder="Add internal notes about this client…"
                  value={notes}
                  onChange={e => { setNotes(e.target.value); setNotesDirty(true); }}
                />
                {saveError && (
                  <p className="text-xs text-danger">Could not save notes — please try again.</p>
                )}
                <button
                  onClick={saveNotes}
                  disabled={saving}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-60"
                  style={{ background: accentColor }}
                >
                  {saving ? "Saving…" : notesSaved ? "✓ Saved" : "Save Notes"}
                </button>
              </div>
            ) : (
              <p className="text-sm text-fg-muted whitespace-pre-wrap">
                {detail.notes || "No notes recorded."}
              </p>
            )
          )}
        </div>
      </div>
    </>
  );
}
