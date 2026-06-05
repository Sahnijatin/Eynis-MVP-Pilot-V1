"use client";

// Integrations module (E-5). Renders every connector as a large square tile —
// logo, name, description, what it needs, status badge, and a Connect button —
// grouped by category. Connect opens a modal that captures exactly the fields a
// connector needs and saves them to the per-tenant ConnectorConfig (secrets are
// masked on read and preserved on re-save by the API).

import { useState } from "react";
import { useRouter } from "next/navigation";
import { X, CheckCircle2, Loader2, Eye, EyeOff, Plug } from "lucide-react";
import type { ConnectorRegistryItem } from "../../lib/data";

const CATEGORY_ORDER = ["communication", "email", "voice", "pms", "pos", "payments"];

function StatusBadge({ status }: { status: ConnectorRegistryItem["status"] }) {
  const map = {
    connected: { label: "Connected", cls: "badge-green" },
    planned: { label: "Planned", cls: "badge-slate" },
    disabled: { label: "Disabled", cls: "badge-amber" },
  } as const;
  const s = map[status] ?? map.disabled;
  return <span className={`badge ${s.cls}`}>{s.label}</span>;
}

export function IntegrationsClient({ items, statusLoaded = true }: { items: ConnectorRegistryItem[]; statusLoaded?: boolean }) {
  const [active, setActive] = useState<ConnectorRegistryItem | null>(null);

  // Be defensive: never let a malformed/empty payload crash the page into the
  // error boundary — the Integrations module must always render its shell.
  const safeItems = Array.isArray(items) ? items : [];
  const byCategory = new Map<string, ConnectorRegistryItem[]>();
  for (const it of safeItems) {
    if (!byCategory.has(it.category)) byCategory.set(it.category, []);
    byCategory.get(it.category)!.push(it);
  }
  const categories = [...byCategory.keys()].sort(
    (a, b) => (CATEGORY_ORDER.indexOf(a) + 1 || 99) - (CATEGORY_ORDER.indexOf(b) + 1 || 99),
  );

  return (
    <div>
      <div className="mb-6">
        <div className="flex items-center gap-2 mb-1">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "rgba(15,118,110,0.12)" }}>
            <Plug className="w-4.5 h-4.5 text-teal-700" />
          </div>
          <h1 className="text-xl font-semibold text-slate-800">Integrations</h1>
        </div>
        <p className="text-sm text-slate-500 max-w-2xl">
          Connect the tools that power your operation. Each connector stores its credentials securely per workspace.
        </p>
      </div>

      {!statusLoaded && (
        <div className="mb-5 px-3 py-2.5 rounded-lg text-sm flex items-center gap-2 bg-amber-50 text-amber-800 border border-amber-100">
          <span className="w-1.5 h-1.5 rounded-full bg-amber-400 shrink-0" />
          Showing the connector catalog — sign in to your workspace to view and manage live connection status.
        </div>
      )}

      {categories.length === 0 && (
        <div className="card text-center py-10 text-sm text-slate-500">
          No connectors to show right now. Try refreshing, or check back shortly.
        </div>
      )}

      {categories.map((cat) => {
        const list = byCategory.get(cat)!;
        return (
          <div key={cat} className="mb-7">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-400 mb-3">{list[0]?.categoryLabel ?? cat}</h2>
            <div className="grid gap-4" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(240px, 1fr))" }}>
              {list.map((c) => (
                <ConnectorTile key={c.key} item={c} onConnect={() => setActive(c)} />
              ))}
            </div>
          </div>
        );
      })}

      {active && <ConnectModal item={active} onClose={() => setActive(null)} />}
    </div>
  );
}

function ConnectorTile({ item, onConnect }: { item: ConnectorRegistryItem; onConnect: () => void }) {
  const needs = item.requiredFields.map((f) => f.label).join(", ") || "No credentials required";
  return (
    <div className="card flex flex-col" style={{ minHeight: 200 }}>
      <div className="flex items-start justify-between mb-2">
        <div className="w-11 h-11 rounded-xl flex items-center justify-center text-xl" style={{ background: item.brandColor + "1a" }}>
          <span>{item.icon}</span>
        </div>
        <StatusBadge status={item.status} />
      </div>
      <div className="font-semibold text-slate-800 text-sm">{item.name}</div>
      <p className="text-xs text-slate-500 mt-1 leading-relaxed flex-1">{item.description}</p>
      <div className="mt-2 mb-3">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-400">What it needs</div>
        <div className="text-xs text-slate-600">{needs}</div>
      </div>
      <button
        onClick={onConnect}
        disabled={item.planned}
        className="w-full py-2 rounded-lg text-sm font-semibold text-white disabled:opacity-50 disabled:cursor-not-allowed"
        style={{ background: item.planned ? "#94a3b8" : "#0f766e" }}
      >
        {item.planned ? "Coming soon" : item.status === "connected" ? "Manage" : "Connect"}
      </button>
    </div>
  );
}

function ConnectModal({ item, onClose }: { item: ConnectorRegistryItem; onClose: () => void }) {
  const router = useRouter();
  // Pre-fill non-secret fields from the saved (masked) config; secrets stay blank
  // and are only sent when the user types a new value.
  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const f of item.requiredFields) {
      const saved = item.config?.[f.key];
      if (saved != null && saved !== "***") init[f.key] = String(saved);
    }
    return init;
  });
  const [showSecret, setShowSecret] = useState<Record<string, boolean>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save(enabled: boolean) {
    setSaving(true); setError(null);
    try {
      const res = await fetch(`/api/connectors/${encodeURIComponent(item.key)}`, {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled, config: values }),
      });
      const data = await res.json() as { ok: boolean; error?: string };
      if (!res.ok || !data.ok) throw new Error(data.error || "Save failed");
      router.refresh();
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Save failed");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div onClick={onClose} className="fixed inset-0 z-[1000] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.45)" }}>
      <div onClick={(e) => e.stopPropagation()} className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-auto">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: item.brandColor + "1a" }}>{item.icon}</div>
            <div>
              <div className="font-semibold text-slate-800 text-sm">{item.name}</div>
              <div className="text-xs text-slate-400">{item.categoryLabel}</div>
            </div>
          </div>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X className="w-4 h-4" /></button>
        </div>

        <div className="px-5 py-4 space-y-3">
          <p className="text-xs text-slate-500">{item.description}</p>
          {item.requiredFields.length === 0 && (
            <p className="text-sm text-slate-500">This connector needs no credentials — just enable it.</p>
          )}
          {item.requiredFields.map((f) => (
            <div key={f.key}>
              <label className="block text-xs font-semibold text-slate-600 mb-1">{f.label}</label>
              <div className="relative">
                <input
                  type={f.secret && !showSecret[f.key] ? "password" : "text"}
                  placeholder={f.secret && item.config?.[f.key] === "***" ? "•••••• (saved — leave blank to keep)" : (f.placeholder ?? "")}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 pr-9"
                />
                {f.secret && (
                  <button type="button" onClick={() => setShowSecret((s) => ({ ...s, [f.key]: !s[f.key] }))}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600">
                    {showSecret[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
          {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</div>}
        </div>

        <div className="flex items-center gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={() => void save(true)} disabled={saving}
            className="px-4 py-2 text-sm font-semibold text-white rounded-lg flex items-center gap-1.5 disabled:opacity-50" style={{ background: "#0f766e" }}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {item.status === "connected" ? "Save" : "Connect"}
          </button>
          {item.status === "connected" && (
            <button onClick={() => void save(false)} disabled={saving}
              className="px-4 py-2 text-sm font-medium text-red-500 rounded-lg border border-red-100 hover:bg-red-50 disabled:opacity-50">
              Disconnect
            </button>
          )}
          <button onClick={onClose} className="ml-auto px-4 py-2 text-sm font-medium text-slate-500 rounded-lg hover:bg-slate-100">Cancel</button>
        </div>
      </div>
    </div>
  );
}
