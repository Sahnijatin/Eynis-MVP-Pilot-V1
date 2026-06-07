"use client";

import { useEffect, useState } from "react";
import { X, Loader2, Users, UserRound } from "lucide-react";

// Per-report sharing ACL (E-16 Phase B). Lets the report's creator grant access
// to specific users and/or whole roles, on top of the tenant-wide "shared"
// toggle. Replaces the full grant set on save (PUT /reports/:id/shares).

interface ShareUser { id: string; fullName: string; email: string }
interface ShareRole { key: string; displayName: string }
interface Grant { principalType: string; principalId: string }

const key = (type: string, id: string) => `${type}:${id}`;

export function ReportShareModal({ reportId, onClose }: { reportId: string; onClose: () => void }) {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<ShareUser[]>([]);
  const [roles, setRoles] = useState<ShareRole[]>([]);
  // Selected grants, keyed "user:<id>" / "role:<key>" for O(1) toggling.
  const [selected, setSelected] = useState<Set<string>>(new Set());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch(`/api/reports/${reportId}/shares`, { cache: "no-store" });
        const data = (await res.json()) as { ok: boolean; error?: string; shares?: Grant[]; users?: ShareUser[]; roles?: ShareRole[] };
        if (!alive) return;
        if (!res.ok || !data.ok) { setError(data.error ?? "Couldn't load sharing settings."); return; }
        setUsers(data.users ?? []);
        setRoles(data.roles ?? []);
        setSelected(new Set((data.shares ?? []).map((s) => key(s.principalType, s.principalId))));
      } catch {
        if (alive) setError("Couldn't load sharing settings.");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [reportId]);

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
      const res = await fetch(`/api/reports/${reportId}/shares`, {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ shares }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { setError(data.error ?? "Couldn't save sharing."); setSaving(false); return; }
      onClose();
    } catch { setError("Couldn't save sharing."); setSaving(false); }
  }

  const rowCls = "flex items-center gap-2.5 px-3 py-2 rounded-lg border cursor-pointer text-sm transition-colors";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h3 className="font-semibold text-slate-800">Share this report</h3>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-700"><X className="w-5 h-5" /></button>
        </div>

        <div className="px-5 py-4 overflow-y-auto">
          <p className="text-xs text-slate-500 mb-4">
            Grant read-only access to specific people or roles. They can open, run, and export this
            report — only you can edit or delete it. (Use “Everyone in workspace” on the report itself
            to share tenant-wide.)
          </p>

          {error && <div className="mb-3 p-2.5 bg-red-50 border border-red-200 text-red-700 rounded-lg text-xs">{error}</div>}

          {loading ? (
            <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-slate-400" /></div>
          ) : (
            <>
              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                <Users className="w-3.5 h-3.5" /> Roles
              </div>
              {roles.length === 0 ? <p className="text-xs text-slate-400 mb-4">No roles.</p> : (
                <div className="grid gap-1.5 mb-4">
                  {roles.map((r) => {
                    const k = key("role", r.key);
                    const on = selected.has(k);
                    return (
                      <label key={k} className={`${rowCls} ${on ? "border-teal-300 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(k)} className="accent-teal-600" />
                        <span className="text-slate-700">{r.displayName}</span>
                      </label>
                    );
                  })}
                </div>
              )}

              <div className="flex items-center gap-1.5 text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-2">
                <UserRound className="w-3.5 h-3.5" /> People
              </div>
              {users.length === 0 ? <p className="text-xs text-slate-400">No other members in this workspace.</p> : (
                <div className="grid gap-1.5">
                  {users.map((u) => {
                    const k = key("user", u.id);
                    const on = selected.has(k);
                    return (
                      <label key={k} className={`${rowCls} ${on ? "border-teal-300 bg-teal-50" : "border-slate-200 hover:bg-slate-50"}`}>
                        <input type="checkbox" checked={on} onChange={() => toggle(k)} className="accent-teal-600" />
                        <span className="min-w-0">
                          <span className="text-slate-700">{u.fullName || u.email}</span>
                          {u.fullName && <span className="text-slate-400 ml-1.5 text-xs">{u.email}</span>}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}
            </>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-3 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 bg-white hover:bg-slate-50">Cancel</button>
          <button onClick={save} disabled={loading || saving} className="px-4 py-2 text-sm font-semibold text-white rounded-lg inline-flex items-center gap-1.5 disabled:opacity-50" style={{ background: "var(--color-primary, #0f766e)" }}>
            {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Save sharing
          </button>
        </div>
      </div>
    </div>
  );
}
