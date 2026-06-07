"use client";

import { useMemo, useState } from "react";
import { Loader2, Search, LogOut, Check, Building2 } from "lucide-react";

export interface ConsoleTenant {
  id: string;
  name: string;
  industry: string;
  slug: string | null;
  customDomain: string | null;
  createdAt: string;
}
export interface IndustryOption {
  key: string;
  label: string;
}

interface RowState {
  selected: string; // currently-chosen industry in the dropdown
  saving: boolean;
  saved: boolean;
  error: string | null;
}

// The internal provisioning console (E-8): a cross-tenant table where Eynis staff
// set each tenant's industry. Custom domain + white-label tier (E-9/E-10) will
// land here too — this is the shared provisioning surface.
export function ProvisioningConsole({
  tenants,
  industries,
  error
}: {
  tenants: ConsoleTenant[];
  industries: IndustryOption[];
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(tenants.map((t) => [t.id, { selected: t.industry, saving: false, saved: false, error: null }]))
  );
  // Authoritative persisted industry per tenant (updates after a successful save).
  const [persisted, setPersisted] = useState<Record<string, string>>(() =>
    Object.fromEntries(tenants.map((t) => [t.id, t.industry]))
  );

  const labelFor = useMemo(() => {
    const m = new Map(industries.map((i) => [i.key, i.label]));
    return (key: string) => m.get(key) ?? key;
  }, [industries]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return tenants;
    return tenants.filter(
      (t) =>
        t.name.toLowerCase().includes(q) ||
        t.id.toLowerCase().includes(q) ||
        (t.slug ?? "").toLowerCase().includes(q)
    );
  }, [tenants, query]);

  function setRow(id: string, patch: Partial<RowState>) {
    setRows((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
  }

  async function save(t: ConsoleTenant) {
    const row = rows[t.id];
    if (!row || row.selected === persisted[t.id]) return;
    setRow(t.id, { saving: true, saved: false, error: null });
    try {
      const r = await fetch(`/api/admin/tenants/${encodeURIComponent(t.id)}/industry`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ industry: row.selected })
      });
      const data = (await r.json()) as { ok: boolean; error?: string; tenant?: { industry: string } };
      if (!r.ok || !data.ok) {
        setRow(t.id, { saving: false, error: data.error ?? "Save failed." });
        return;
      }
      const newIndustry = data.tenant?.industry ?? row.selected;
      setPersisted((prev) => ({ ...prev, [t.id]: newIndustry }));
      setRow(t.id, { saving: false, saved: true, selected: newIndustry, error: null });
      setTimeout(() => setRow(t.id, { saved: false }), 2500);
    } catch {
      setRow(t.id, { saving: false, error: "Could not reach the server." });
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-5xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold text-slate-800">Provisioning Console</h1>
          <button onClick={logout} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
        <p className="text-sm text-slate-400 mb-6">
          Internal staff surface. Set each tenant&apos;s industry — this re-shapes their nav, terminology and
          modules, so it is provisioned by us, not the customer.
        </p>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
        ) : (
          <>
            <div className="relative mb-4 max-w-sm">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by name, id or slug…"
                className="w-full pl-9 pr-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 bg-white"
              />
            </div>

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-500 uppercase tracking-wider border-b border-slate-100">
                    <th className="px-4 py-3">Tenant</th>
                    <th className="px-4 py-3">Industry</th>
                    <th className="px-4 py-3 w-32"></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={3} className="px-4 py-8 text-center text-slate-400">No tenants match your search.</td>
                    </tr>
                  )}
                  {filtered.map((t) => {
                    const row = rows[t.id];
                    const dirty = row && row.selected !== persisted[t.id];
                    return (
                      <tr key={t.id} className="border-b border-slate-50 last:border-0">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-slate-300 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800 truncate">{t.name}</div>
                              <div className="text-xs text-slate-400 truncate">
                                {t.id}
                                {t.slug ? ` · ${t.slug}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3">
                          <select
                            value={row?.selected ?? t.industry}
                            onChange={(e) => setRow(t.id, { selected: e.target.value, saved: false, error: null })}
                            className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
                          >
                            {industries.map((i) => (
                              <option key={i.key} value={i.key}>{i.label}</option>
                            ))}
                            {/* Surface an unrecognised stored value rather than hiding it. */}
                            {!industries.some((i) => i.key === (row?.selected ?? t.industry)) && (
                              <option value={row?.selected ?? t.industry}>{labelFor(row?.selected ?? t.industry)} (current)</option>
                            )}
                          </select>
                          {row?.error && <div className="text-xs text-red-600 mt-1">{row.error}</div>}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {row?.saved ? (
                            <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700">
                              <Check className="w-4 h-4" /> Saved
                            </span>
                          ) : (
                            <button
                              onClick={() => save(t)}
                              disabled={!dirty || row?.saving}
                              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white inline-flex items-center gap-1.5 bg-teal-700 disabled:opacity-40"
                            >
                              {row?.saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                              {row?.saving ? "Saving…" : "Save"}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
