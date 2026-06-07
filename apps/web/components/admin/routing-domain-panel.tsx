"use client";

import { useState } from "react";
import { Loader2, Save } from "lucide-react";

const PLATFORM = "eynis.com";
const CNAME_TARGET = `cname.${PLATFORM}`;

// Staff editor for a tenant's white-label routing identity — subdomain (slug) +
// custom domain (E-10). Lives inside the provisioning console, expanded per row.
// The custom CNAME domain is provider-managed: staff set it here and own the
// DNS/SSL steps shown below. Initial values come from the console list (no extra
// fetch); saves go to the internal PATCH endpoint.
export function RoutingDomainPanel({
  tenantId,
  initialSlug,
  initialCustomDomain
}: {
  tenantId: string;
  initialSlug: string | null;
  initialCustomDomain: string | null;
}) {
  const [slug, setSlug] = useState(initialSlug ?? "");
  const [customDomain, setCustomDomain] = useState(initialCustomDomain ?? "");
  const [saved, setSaved] = useState<string | null>(initialCustomDomain);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  async function save() {
    setSaving(true);
    setError(null);
    setOk(false);
    try {
      const r = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/domains`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slug.trim() || null, customDomain: customDomain.trim() || null })
      });
      const data = (await r.json()) as { ok: boolean; error?: string; tenant?: { slug: string | null; customDomain: string | null } };
      if (!r.ok || !data.ok) { setError(data.error ?? "Save failed."); return; }
      setSlug(data.tenant?.slug ?? "");
      setCustomDomain(data.tenant?.customDomain ?? "");
      setSaved(data.tenant?.customDomain ?? null);
      setOk(true);
      setTimeout(() => setOk(false), 2500);
    } catch { setError("Could not reach the server."); }
    finally { setSaving(false); }
  }

  return (
    <div className="bg-slate-50 border border-slate-200 rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-slate-500 mb-1">Workspace subdomain</span>
          <div className="flex items-center gap-1.5">
            <input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="tempus"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
            <span className="text-xs text-slate-500 whitespace-nowrap">.{PLATFORM}</span>
          </div>
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-slate-500 mb-1">Custom domain</span>
          <input value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="app.acme.com"
            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-teal-500" />
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg text-white inline-flex items-center gap-1.5 bg-teal-700 disabled:opacity-40">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          Save domains
        </button>
        {ok && <span className="text-xs font-medium text-teal-700">Saved</span>}
        {error && <span className="text-xs text-red-600">{error}</span>}
      </div>

      {/* DNS / SSL setup steps for the custom domain (provider-owned ops). */}
      {saved && (
        <div className="text-xs text-slate-500 space-y-1">
          <div className="font-semibold text-slate-500">DNS the tenant must publish</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs bg-white rounded-lg border border-slate-200">
              <thead>
                <tr className="text-left text-slate-500 border-b border-slate-100">
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Value</th>
                </tr>
              </thead>
              <tbody>
                <tr className="align-top">
                  <td className="px-2 py-1.5 font-mono">CNAME</td>
                  <td className="px-2 py-1.5 font-mono break-all">{saved}</td>
                  <td className="px-2 py-1.5 font-mono break-all">{CNAME_TARGET}</td>
                </tr>
              </tbody>
            </table>
          </div>
          <p>Once the CNAME resolves, HTTPS is provisioned automatically — no cert work for the tenant.</p>
        </div>
      )}
    </div>
  );
}
