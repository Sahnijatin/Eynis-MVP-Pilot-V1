"use client";

// Integrations module (E-5). Renders every connector as a large square tile —
// logo, name, description, what it needs, status badge, and a Connect button —
// grouped by category. Connect opens a modal that captures exactly the fields a
// connector needs and saves them to the per-tenant ConnectorConfig (secrets are
// masked on read and preserved on re-save by the API).
//
// E-13b: built on the ds/ design primitives (Modal, Button, Badge, Input, Label)
// and the white-label brand token, instead of a hand-rolled modal + hardcoded
// teal. Per-connector brand colors (item.brandColor) are intentionally kept.

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, Loader2, Eye, EyeOff, Plug } from "lucide-react";
import { Modal, Button, Badge, Input, Label, tokens as t } from "../ds";
import type { ConnectorRegistryItem } from "../../lib/data";

const CATEGORY_ORDER = ["communication", "email", "voice", "pms", "pos", "payments"];

const STATUS_TONE: Record<ConnectorRegistryItem["status"], { tone: "success" | "neutral" | "warning"; label: string }> = {
  connected: { tone: "success", label: "Connected" },
  planned: { tone: "neutral", label: "Planned" },
  disabled: { tone: "warning", label: "Disabled" },
};

function StatusBadge({ status }: { status: ConnectorRegistryItem["status"] }) {
  const s = STATUS_TONE[status] ?? STATUS_TONE.disabled;
  return <Badge tone={s.tone}>{s.label}</Badge>;
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
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: t.color.accentSoft }}>
            <Plug className="w-4.5 h-4.5" style={{ color: t.color.accent }} />
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
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-500 mb-3">{list[0]?.categoryLabel ?? cat}</h2>
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
        <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">What it needs</div>
        <div className="text-xs text-slate-600">{needs}</div>
      </div>
      <Button variant="primary" onClick={onConnect} disabled={item.planned} style={{ width: "100%" }}>
        {item.planned ? "Coming soon" : item.status === "connected" ? "Manage" : "Connect"}
      </Button>
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
    <Modal
      title={item.name}
      onClose={onClose}
      footer={
        <>
          {item.status === "connected" && (
            <Button variant="danger" onClick={() => void save(false)} disabled={saving}>Disconnect</Button>
          )}
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancel</Button>
          <Button variant="primary" onClick={() => void save(true)} disabled={saving}>
            {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
            {item.status === "connected" ? "Save" : "Connect"}
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2.5 mb-3">
        <div className="w-9 h-9 rounded-lg flex items-center justify-center text-lg" style={{ background: item.brandColor + "1a" }}>{item.icon}</div>
        <div className="text-xs text-slate-500">{item.categoryLabel}</div>
      </div>
      <p className="text-xs text-slate-500 mb-3">{item.description}</p>

      {item.requiredFields.length === 0 ? (
        <p className="text-sm text-slate-500">This connector needs no credentials — just enable it.</p>
      ) : (
        <div className="space-y-3">
          {item.requiredFields.map((f) => (
            <div key={f.key}>
              <Label>{f.label}</Label>
              <div className="relative">
                <Input
                  type={f.secret && !showSecret[f.key] ? "password" : "text"}
                  placeholder={f.secret && item.config?.[f.key] === "***" ? "•••••• (saved — leave blank to keep)" : (f.placeholder ?? "")}
                  value={values[f.key] ?? ""}
                  onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}
                  style={f.secret ? { paddingRight: 36 } : undefined}
                />
                {f.secret && (
                  <button type="button" onClick={() => setShowSecret((s) => ({ ...s, [f.key]: !s[f.key] }))}
                    aria-label={showSecret[f.key] ? "Hide value" : "Show value"}
                    className="absolute right-2.5 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-600">
                    {showSecret[f.key] ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {error && <div className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2 mt-3">{error}</div>}
    </Modal>
  );
}
