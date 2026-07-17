"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardTitle, Field, Input, Badge, useToast, tokens as t } from "../ds";

// Settings → Domains (A7 / E-10): customers self-serve their white-label
// subdomain (slug), but the custom CNAME domain is provider-managed — we set up
// DNS/SSL for it. So the custom domain here is read-only status + a request path;
// staff fulfil the request from the internal provisioning console.
const PLATFORM = "eynis.com";

export function DomainsPanel() {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [customDomain, setCustomDomain] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  // Custom-domain request flow.
  const [requesting, setRequesting] = useState(false);
  const [requested, setRequested] = useState(false);
  const [desiredDomain, setDesiredDomain] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tenant/domains", { cache: "no-store" });
        const d = await res.json();
        if (alive && d.ok) { setSlug(d.slug ?? ""); setCustomDomain(d.customDomain ?? null); }
      } catch {
        if (alive) toast.push("Couldn't load your domain settings — please reload.", "error");
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function saveSlug() {
    setSaving(true);
    try {
      const res = await fetch("/api/tenant/domains", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slug.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { toast.push(d.error ?? "Save failed", "error"); return; }
      setSlug(d.slug ?? "");
      toast.push("Subdomain saved", "success");
    } catch { toast.push("Network error — the subdomain was not saved.", "error"); }
    finally { setSaving(false); }
  }

  async function submitRequest() {
    setSending(true);
    try {
      const res = await fetch("/api/tenant/domains/request", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ desiredDomain: desiredDomain.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { toast.push(d.error ?? "Request failed", "error"); return; }
      setRequested(true);
      setRequesting(false);
      toast.push("Request received — our team will set this up", "success");
    } catch { toast.push("Network error — the request was not sent.", "error"); }
    finally { setSending(false); }
  }

  if (loading) return <Card style={{ maxWidth: 640 }}><span style={{ color: t.color.textMuted }}>Loading…</span></Card>;

  return (
    <Card style={{ maxWidth: 640 }}>
      <CardTitle>Custom domain</CardTitle>
      <p style={{ color: t.color.textMuted, fontSize: t.font.sm, marginTop: -6, marginBottom: 16 }}>
        Run the app on your own URL. Your team signs in on a page branded as you.
      </p>

      <Field label="Workspace subdomain" hint="No setup needed — works instantly.">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="tempus" style={{ maxWidth: 200 }} />
          <span style={{ color: t.color.textMuted, fontSize: t.font.sm }}>.{PLATFORM}</span>
        </div>
      </Field>
      {slug.trim() && <div style={{ marginBottom: 14 }}><Badge tone="accent">https://{slug.trim()}.{PLATFORM}</Badge></div>}

      <div style={{ marginBottom: 14 }}>
        <Button onClick={saveSlug} disabled={saving}>{saving ? "Saving…" : "Save subdomain"}</Button>
      </div>

      <hr style={{ border: "none", borderTop: `1px solid ${t.color.border}`, margin: "18px 0" }} />

      {/* Custom CNAME domain — read-only status; provisioned by us (E-10). */}
      <Field
        label="Your own domain"
        hint="Custom domains are set up by our team — we handle DNS and HTTPS for you."
      >
        {customDomain ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Badge tone="accent">https://{customDomain}</Badge>
            <span style={{ color: t.color.textMuted, fontSize: t.font.sm }}>Active</span>
          </div>
        ) : requested ? (
          <span style={{ color: t.color.textMuted, fontSize: t.font.sm }}>
            Request received — our team will reach out to set this up.
          </span>
        ) : requesting ? (
          <div style={{ display: "grid", gap: 8 }}>
            <Input
              value={desiredDomain}
              onChange={(e) => setDesiredDomain(e.target.value)}
              placeholder="app.yourcompany.com"
              style={{ maxWidth: 280 }}
            />
            <div style={{ display: "flex", gap: 8 }}>
              <Button onClick={submitRequest} disabled={sending}>{sending ? "Sending…" : "Send request"}</Button>
              <Button variant="ghost" onClick={() => setRequesting(false)} disabled={sending}>Cancel</Button>
            </div>
          </div>
        ) : (
          <Button variant="ghost" onClick={() => setRequesting(true)}>Request a custom domain</Button>
        )}
      </Field>
    </Card>
  );
}
