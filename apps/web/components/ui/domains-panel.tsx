"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardTitle, Field, Input, Badge, useToast, tokens as t } from "../ds";

// Settings → Domains (A7): set the white-label subdomain (slug) and/or a fully
// custom domain. Resolution + theming of the sign-in page happens off these.
const PLATFORM = "eynis.com";

export function DomainsPanel() {
  const toast = useToast();
  const [slug, setSlug] = useState("");
  const [customDomain, setCustomDomain] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tenant/domains", { cache: "no-store" });
        const d = await res.json();
        if (alive && d.ok) { setSlug(d.slug ?? ""); setCustomDomain(d.customDomain ?? ""); }
      } finally { if (alive) setLoading(false); }
    })();
    return () => { alive = false; };
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/tenant/domains", {
        method: "PUT", headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug: slug.trim() || null, customDomain: customDomain.trim() || null }),
      });
      const d = await res.json();
      if (!res.ok || !d.ok) { toast.push(d.error ?? "Save failed", "error"); return; }
      setSlug(d.slug ?? ""); setCustomDomain(d.customDomain ?? "");
      toast.push("Domains saved", "success");
    } finally { setSaving(false); }
  }

  if (loading) return <Card style={{ maxWidth: 640 }}><span style={{ color: t.color.textMuted }}>Loading…</span></Card>;

  return (
    <Card style={{ maxWidth: 640 }}>
      <CardTitle>Custom domain</CardTitle>
      <p style={{ color: t.color.textMuted, fontSize: t.font.sm, marginTop: -6, marginBottom: 16 }}>
        Run the app on your own URL. Your team signs in on a page branded as you — not Eynis.
      </p>

      <Field label="Workspace subdomain" hint="No setup needed — works instantly.">
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Input value={slug} onChange={(e) => setSlug(e.target.value)} placeholder="tempus" style={{ maxWidth: 200 }} />
          <span style={{ color: t.color.textMuted, fontSize: t.font.sm }}>.{PLATFORM}</span>
        </div>
      </Field>
      {slug.trim() && <div style={{ marginBottom: 14 }}><Badge tone="accent">https://{slug.trim()}.{PLATFORM}</Badge></div>}

      <Field label="Your own domain" hint={<>Point it at us with a DNS record: <code>{(customDomain.trim() || "app.tempus.com")} CNAME cname.{PLATFORM}</code>, then we provision HTTPS automatically.</>}>
        <Input value={customDomain} onChange={(e) => setCustomDomain(e.target.value)} placeholder="app.tempus.com" />
      </Field>
      {customDomain.trim() && <div style={{ marginBottom: 14 }}><Badge tone="accent">https://{customDomain.trim()}</Badge></div>}

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save domains"}</Button>
    </Card>
  );
}
