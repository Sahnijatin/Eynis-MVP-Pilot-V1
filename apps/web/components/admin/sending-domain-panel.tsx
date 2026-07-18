"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, Save } from "lucide-react";

interface DnsRecord { type: string; name: string; value: string; priority?: number }
interface SendingDomain {
  domain: string;
  fromLocalPart: string;
  fromName: string | null;
  status: string;
  dnsRecords: DnsRecord[];
  lastCheckedAt?: string | null;
}

const STATUS_STYLE: Record<string, string> = {
  verified: "bg-accent-bg text-accent-text border-accent-line",
  pending: "bg-warn-bg text-warn border-warn-border",
  failed: "bg-danger-bg text-danger border-danger-border"
};

// Staff editor for a tenant's white-label sending domain (E-9). Lives inside the
// provisioning console, expanded per tenant row.
export function SendingDomainPanel({ tenantId }: { tenantId: string }) {
  const [loading, setLoading] = useState(true);
  const [domain, setDomain] = useState("");
  const [localPart, setLocalPart] = useState("notifications");
  const [fromName, setFromName] = useState("");
  const [current, setCurrent] = useState<SendingDomain | null>(null);
  const [saving, setSaving] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Load failure ≠ "no domain": rendering the empty form on a transient error
  // would let a staff save silently overwrite an existing config.
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const r = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/sending-domain`, { cache: "no-store" });
        const data = (await r.json()) as { ok: boolean; sendingDomain: SendingDomain | null };
        if (!alive) return;
        if (!r.ok || !data.ok) { setLoadFailed(true); return; }
        if (data.sendingDomain) {
          setCurrent(data.sendingDomain);
          setDomain(data.sendingDomain.domain);
          setLocalPart(data.sendingDomain.fromLocalPart);
          setFromName(data.sendingDomain.fromName ?? "");
        }
      } catch {
        if (alive) setLoadFailed(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [tenantId]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/sending-domain`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ domain, fromLocalPart: localPart, fromName: fromName || null })
      });
      const data = (await r.json()) as { ok: boolean; error?: string; sendingDomain?: SendingDomain };
      if (!r.ok || !data.ok) { setError(data.error ?? "Save failed."); return; }
      if (data.sendingDomain) setCurrent(data.sendingDomain);
    } catch { setError("Could not reach the server."); }
    finally { setSaving(false); }
  }

  async function verify() {
    setVerifying(true);
    setError(null);
    try {
      const r = await fetch(`/api/admin/tenants/${encodeURIComponent(tenantId)}/sending-domain/verify`, { method: "POST" });
      const data = (await r.json()) as { ok: boolean; error?: string; sendingDomain?: SendingDomain };
      if (!r.ok || !data.ok) { setError(data.error ?? "Verify failed."); return; }
      if (data.sendingDomain) setCurrent(data.sendingDomain);
    } catch { setError("Could not reach the server."); }
    finally { setVerifying(false); }
  }

  if (loading) return <div className="text-sm text-fg-muted py-3">Loading sending domain…</div>;
  if (loadFailed) {
    return (
      <div className="text-sm text-danger py-3">
        Couldn&apos;t load this tenant&apos;s current sending-domain config. The form is hidden so an existing domain isn&apos;t overwritten — reload to try again.
      </div>
    );
  }

  const status = current?.status ?? "none";

  return (
    <div className="bg-surface-inset border border-line rounded-lg p-4 space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <label className="block">
          <span className="block text-xs font-semibold text-fg-muted mb-1">Domain</span>
          <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="mail.acme.com"
            className="w-full px-3 py-2 rounded-lg border border-line text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent-focus" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-fg-muted mb-1">From (local part)</span>
          <input value={localPart} onChange={(e) => setLocalPart(e.target.value)} placeholder="campaigns"
            className="w-full px-3 py-2 rounded-lg border border-line text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent-focus" />
        </label>
        <label className="block">
          <span className="block text-xs font-semibold text-fg-muted mb-1">From name (optional)</span>
          <input value={fromName} onChange={(e) => setFromName(e.target.value)} placeholder="Acme Co"
            className="w-full px-3 py-2 rounded-lg border border-line text-sm bg-surface focus:outline-none focus:ring-2 focus:ring-accent-focus" />
        </label>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={save} disabled={saving || !domain}
          className="px-3 py-1.5 text-xs font-semibold rounded-lg text-accent-contrast inline-flex items-center gap-1.5 bg-accent disabled:opacity-40">
          {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
          {current ? "Update domain" : "Register domain"}
        </button>
        {current && (
          <button onClick={verify} disabled={verifying}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg inline-flex items-center gap-1.5 border border-line bg-surface text-fg-muted disabled:opacity-40">
            {verifying ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Check verification
          </button>
        )}
        {status !== "none" && (
          <span className={`text-xs font-semibold px-2 py-1 rounded-full border ${STATUS_STYLE[status] ?? "bg-surface-inset text-fg-muted border-line"}`}>
            {status}
          </span>
        )}
        {current && (
          <span className="text-xs text-fg-muted">
            Sends as {current.fromName ? `${current.fromName} ` : ""}&lt;{current.fromLocalPart}@{current.domain}&gt;
            {status !== "verified" ? " — used only once verified" : ""}
          </span>
        )}
      </div>

      {error && <div className="text-xs text-danger">{error}</div>}

      {current && current.dnsRecords.length > 0 && (
        <div>
          <div className="text-xs font-semibold text-fg-muted mb-1">DNS records the tenant must publish</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs bg-surface rounded-lg border border-line">
              <thead>
                <tr className="text-left text-fg-muted border-b border-line">
                  <th className="px-2 py-1.5">Type</th>
                  <th className="px-2 py-1.5">Name</th>
                  <th className="px-2 py-1.5">Value</th>
                </tr>
              </thead>
              <tbody>
                {current.dnsRecords.map((r, i) => (
                  <tr key={i} className="border-b border-line last:border-0 align-top">
                    <td className="px-2 py-1.5 font-mono">{r.type}</td>
                    <td className="px-2 py-1.5 font-mono break-all">{r.name}</td>
                    <td className="px-2 py-1.5 font-mono break-all">{r.value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
