"use client";

import { Fragment, useMemo, useState } from "react";
import { Loader2, Search, LogOut, Check, Building2, Mail, Globe, ChevronDown } from "lucide-react";
import { SendingDomainPanel } from "./sending-domain-panel";
import { RoutingDomainPanel } from "./routing-domain-panel";

export interface ConsoleTenant {
  id: string;
  name: string;
  industry: string;
  whitelabelTier: string;
  slug: string | null;
  customDomain: string | null;
  createdAt: string;
}
export interface IndustryOption {
  key: string;
  label: string;
}

// What a single editable cell tracks. `field` distinguishes the two columns so a
// save targets the right endpoint.
type Field = "industry" | "tier";

interface CellState {
  selected: string;
  saving: boolean;
  saved: boolean;
  error: string | null;
}

const ENDPOINT: Record<Field, (id: string) => string> = {
  industry: (id) => `/api/admin/tenants/${encodeURIComponent(id)}/industry`,
  tier: (id) => `/api/admin/tenants/${encodeURIComponent(id)}/whitelabel-tier`
};
const PAYLOAD_KEY: Record<Field, "industry" | "tier"> = { industry: "industry", tier: "tier" };
const RESULT_KEY: Record<Field, "industry" | "whitelabelTier"> = { industry: "industry", tier: "whitelabelTier" };

// The internal provisioning console (E-8/E-9): a cross-tenant table where Eynis
// staff set each tenant's industry and white-label tier. Custom domain (E-10)
// will land here too — this is the shared provisioning surface.
export function ProvisioningConsole({
  tenants,
  industries,
  tiers,
  error
}: {
  tenants: ConsoleTenant[];
  industries: IndustryOption[];
  tiers: IndustryOption[];
  error: string | null;
}) {
  const [query, setQuery] = useState("");
  // Which per-row panel is open, keyed `${tenantId}:${"sending"|"routing"}`.
  const [expanded, setExpanded] = useState<string | null>(null);
  // Keyed by `${tenantId}:${field}`.
  const [cells, setCells] = useState<Record<string, CellState>>(() => {
    const init: Record<string, CellState> = {};
    for (const t of tenants) {
      init[`${t.id}:industry`] = { selected: t.industry, saving: false, saved: false, error: null };
      init[`${t.id}:tier`] = { selected: t.whitelabelTier, saving: false, saved: false, error: null };
    }
    return init;
  });
  const [persisted, setPersisted] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const t of tenants) {
      init[`${t.id}:industry`] = t.industry;
      init[`${t.id}:tier`] = t.whitelabelTier;
    }
    return init;
  });

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

  function setCell(key: string, patch: Partial<CellState>) {
    setCells((prev) => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  }

  async function save(tenantId: string, field: Field) {
    const key = `${tenantId}:${field}`;
    const cell = cells[key];
    if (!cell || cell.selected === persisted[key]) return;
    setCell(key, { saving: true, saved: false, error: null });
    try {
      const r = await fetch(ENDPOINT[field](tenantId), {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [PAYLOAD_KEY[field]]: cell.selected })
      });
      const data = (await r.json()) as { ok: boolean; error?: string; tenant?: Record<string, string> };
      if (!r.ok || !data.ok) {
        setCell(key, { saving: false, error: data.error ?? "Save failed." });
        return;
      }
      const newValue = data.tenant?.[RESULT_KEY[field]] ?? cell.selected;
      setPersisted((prev) => ({ ...prev, [key]: newValue }));
      setCell(key, { saving: false, saved: true, selected: newValue, error: null });
      setTimeout(() => setCell(key, { saved: false }), 2500);
    } catch {
      setCell(key, { saving: false, error: "Could not reach the server." });
    }
  }

  async function logout() {
    await fetch("/api/admin/logout", { method: "POST" });
    window.location.reload();
  }

  function EditableCell({ tenantId, field, options }: { tenantId: string; field: Field; options: IndustryOption[] }) {
    const key = `${tenantId}:${field}`;
    const cell = cells[key];
    const dirty = cell && cell.selected !== persisted[key];
    return (
      <div className="flex items-center gap-2">
        <select
          value={cell?.selected ?? ""}
          onChange={(e) => setCell(key, { selected: e.target.value, saved: false, error: null })}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500"
        >
          {options.map((o) => (
            <option key={o.key} value={o.key}>{o.label}</option>
          ))}
          {!options.some((o) => o.key === cell?.selected) && cell?.selected && (
            <option value={cell.selected}>{cell.selected} (current)</option>
          )}
        </select>
        {cell?.saved ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-teal-700">
            <Check className="w-4 h-4" /> Saved
          </span>
        ) : (
          <button
            onClick={() => save(tenantId, field)}
            disabled={!dirty || cell?.saving}
            className="px-2.5 py-1.5 text-xs font-semibold rounded-lg text-white inline-flex items-center gap-1.5 bg-teal-700 disabled:opacity-40"
          >
            {cell?.saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
            {cell?.saving ? "Saving…" : "Save"}
          </button>
        )}
        {cell?.error && <span className="text-xs text-red-600">{cell.error}</span>}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 p-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between mb-1">
          <h1 className="text-xl font-semibold text-slate-800">Provisioning Console</h1>
          <button onClick={logout} className="inline-flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
        <p className="text-sm text-slate-500 mb-6">
          Internal staff surface. Set each tenant&apos;s industry, white-label tier, and custom domain — these
          re-shape the tenant&apos;s experience or need DNS/SSL we own, so they are provisioned by us, not the customer.
        </p>

        {error ? (
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-xl p-4 text-sm">{error}</div>
        ) : (
          <>
            <div className="relative mb-4 max-w-sm">
              <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
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
                    <th className="px-4 py-3">White-label tier</th>
                    <th className="px-4 py-3">Custom domain</th>
                    <th className="px-4 py-3">Email domain</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-4 py-8 text-center text-slate-500">No tenants match your search.</td>
                    </tr>
                  )}
                  {filtered.map((t) => (
                    <Fragment key={t.id}>
                      <tr className="border-b border-slate-50 align-top">
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-2">
                            <Building2 className="w-4 h-4 text-slate-300 shrink-0" />
                            <div className="min-w-0">
                              <div className="font-medium text-slate-800 truncate">{t.name}</div>
                              <div className="text-xs text-slate-500 truncate">
                                {t.id}
                                {t.slug ? ` · ${t.slug}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        <td className="px-4 py-3"><EditableCell tenantId={t.id} field="industry" options={industries} /></td>
                        <td className="px-4 py-3"><EditableCell tenantId={t.id} field="tier" options={tiers} /></td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setExpanded(expanded === `${t.id}:routing` ? null : `${t.id}:routing`)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          >
                            <Globe className="w-3.5 h-3.5" /> {t.customDomain ?? "Set up"}
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded === `${t.id}:routing` ? "rotate-180" : ""}`} />
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <button
                            onClick={() => setExpanded(expanded === `${t.id}:sending` ? null : `${t.id}:sending`)}
                            className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-semibold rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                          >
                            <Mail className="w-3.5 h-3.5" /> Sending domain
                            <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded === `${t.id}:sending` ? "rotate-180" : ""}`} />
                          </button>
                        </td>
                      </tr>
                      {expanded === `${t.id}:routing` && (
                        <tr className="border-b border-slate-50">
                          <td colSpan={5} className="px-4 pb-4 pt-0">
                            <RoutingDomainPanel tenantId={t.id} initialSlug={t.slug} initialCustomDomain={t.customDomain} />
                          </td>
                        </tr>
                      )}
                      {expanded === `${t.id}:sending` && (
                        <tr className="border-b border-slate-50">
                          <td colSpan={5} className="px-4 pb-4 pt-0"><SendingDomainPanel tenantId={t.id} /></td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
