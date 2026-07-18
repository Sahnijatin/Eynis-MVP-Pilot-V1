"use client";

import { useEffect, useState } from "react";
import { Loader2, Users, UserRound, Globe } from "lucide-react";
import { Modal } from "../ds";

// Per-run sharing ACL (RS-3, Unit B). Mirrors ReportShareModal but for research
// runs, which have no separate edit screen — so the tenant-wide "Everyone in
// workspace" toggle lives here too. The creator grants read/export access to
// specific users and/or whole roles; the full set is replaced on save
// (PUT /research/runs/:id/shares with { shared, shares }).

interface ShareUser { id: string; fullName: string; email: string }
interface ShareRole { key: string; displayName: string }
interface Grant { principalType: string; principalId: string }

const key = (type: string, id: string) => `${type}:${id}`;

export function ResearchShareModal({ runId, onClose, onSaved }: { runId: string; onClose: () => void; onSaved?: (shared: boolean) => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [roles, setRoles] = useState<ShareRole[]>([]);
  const [shared, setShared] = useState(false);
  // Selected grants, keyed "user:<id>" / "role:<key>" for O(1) toggling.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/research/runs/${runId}/shares`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; error?: string; shared?: boolean; shares?: Grant[]; users?: ShareUser[]; roles?: ShareRole[] };
        if (!alive) return;
        if (!res.ok || !data.ok) { setError(data.error ?? "Couldn't load sharing settings."); return; }
        setUsers(data.users ?? []);
        setRoles(data.roles ?? []);
        setShared(data.shared === true);
        setSelected(new Set((data.shares ?? []).map((s) => key(s.principalType, s.principalId))));
      } catch {
        if (alive) setError("Couldn't load sharing settings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [runId]);

  function toggle(k: string) {
    setSelected((cur) => {
      const next = new Set(cur);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const shares = [...selected].map((k) => {
        const [principalType, ...rest] = k.split(":");
        return { principalType, principalId: rest.join(":") };
      });
      const res = await fetch(`/api/research/runs/${runId}/shares`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shared, shares }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Couldn't save sharing."); setSaving(false); return; }
      onSaved?.(shared);
      onClose();
    } catch { setError("Couldn't save sharing."); setSaving(false); }
  }

  const rowCls = "flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors";

  return (
    <Modal
      title="Share this report"
      onClose={onClose}
      width={448}
      footer={
        <>
          <button onClick={onClose} className="px-3 py-2 text-sm border border-line rounded-lg text-fg-muted bg-surface hover:bg-surface-inset">Cancel</button>
          <button onClick={save} disabled={loading || saving} className="px-4 py-2 text-sm font-semibold text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: "var(--color-primary, #0f766e)" }}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save sharing
          </button>
        </>
      }
    >
      <div>
          <p className="text-xs text-fg-muted mb-4">
            Research runs are private to you by default. Grant read-only access to specific people or
            roles — they can open and export this report, but only you can re-share it.
          </p>

          {error && <div className="mb-3 p-2.5 bg-danger-bg border border-danger-border text-danger rounded-lg text-xs">{error}</div>}

          {loading ? (
            <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-fg-subtle" /></div>
          ) : (
            <>
              <label className={`${rowCls} mb-4 ${shared ? "border-accent-border bg-accent-bg" : "border-line hover:bg-surface-inset"}`}>
                <input type="checkbox" checked={shared} onChange={() => setShared((v) => !v)} className="accent-[var(--accent-solid,#0f766e)]" />
                <Globe className="w-3.5 h-3.5 text-fg-muted" />
                <span className="text-fg">Everyone in workspace</span>
              </label>

              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">
                <Users className="w-3.5 h-3.5" /> Roles
              </div>
              {roles.length === 0 ? <p className="text-xs text-fg-subtle mb-4">No roles.</p> : (
                <div className="grid gap-1.5 mb-4">
                  {roles.map((r) => {
                    const k = key("role", r.key);
                    const on = selected.has(k);
                    return (
                      <label key={k} className={`${rowCls} ${on ? "border-accent-border bg-accent-bg" : "border-line hover:bg-surface-inset"}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(k)} className="accent-[var(--accent-solid,#0f766e)]" />
                        <span className="text-fg">{r.displayName}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-muted uppercase tracking-wider mb-2">
                <UserRound className="w-3.5 h-3.5" /> People
              </div>
              {users.length === 0 ? <p className="text-xs text-fg-subtle">No other members in this workspace.</p> : (
                <div className="grid gap-1.5">
                  {users.map((u) => {
                    const k = key("user", u.id);
                    const on = selected.has(k);
                    return (
                      <label key={k} className={`${rowCls} ${on ? "border-accent-border bg-accent-bg" : "border-line hover:bg-surface-inset"}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(k)} className="accent-[var(--accent-solid,#0f766e)]" />
                        <span className="min-w-0">
                          <span className="text-fg">{u.fullName || u.email}</span>
                          {u.fullName && <span className="text-fg-subtle ml-1.5 text-xs">{u.email}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>
    </Modal>
  );
}
