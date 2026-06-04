"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardTitle, Field, Input, useToast, tokens as t } from "../ds";
import type { TenantBranding } from "../../lib/theme";

// Settings → Branding: edit per-tenant white-label overrides. Anything left
// blank falls back to the industry default, so this is purely additive.
const EMPTY: TenantBranding = {
  brandName: "", tagline: "", logoUrl: "", faviconUrl: "", primaryColor: "", accentColor: "", supportEmail: "", hidePoweredBy: false,
};

// True for direct image links / data URLs. Page links (e.g. freeimage.host/i/…)
// return false — they serve HTML, not an image, so <img> can't render them.
const looksLikeImage = (u?: string | null) =>
  !u || /^data:image\//i.test(u) || /\.(png|jpe?g|svg|webp|gif|ico|avif)(\?.*)?$/i.test(u.trim());

export function BrandingPanel() {
  const toast = useToast();
  const [form, setForm] = useState<TenantBranding>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [logoBroken, setLogoBroken] = useState(false);
  const [faviconBroken, setFaviconBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const res = await fetch("/api/tenant/branding", { cache: "no-store" });
        const data = await res.json();
        if (alive && data.ok && data.branding) setForm({ ...EMPTY, ...data.branding });
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  const set = (patch: Partial<TenantBranding>) => setForm((f) => ({ ...f, ...patch }));
  const colorInvalid = (v: string | null | undefined) => Boolean(v && !/^#[0-9a-fA-F]{6}$/.test(v));

  async function save() {
    if (colorInvalid(form.primaryColor) || colorInvalid(form.accentColor)) {
      toast.push("Colors must be a hex value like #0f766e", "error");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/tenant/branding", {
        method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) { toast.push(data.error ?? "Save failed", "error"); return; }
      setForm({ ...EMPTY, ...data.branding });
      toast.push("Branding saved — reload to see it everywhere", "success");
    } finally { setSaving(false); }
  }

  if (loading) return <Card style={{ maxWidth: 640 }}><span style={{ color: t.color.textMuted }}>Loading…</span></Card>;

  const primary = form.primaryColor && !colorInvalid(form.primaryColor) ? form.primaryColor : t.color.accent;
  const logoUrl = form.logoUrl?.trim() || "";
  const warn = (msg: string) => <span style={{ color: t.color.warning, fontSize: t.font.xs }}>⚠ {msg}</span>;

  return (
    <Card style={{ maxWidth: 640 }}>
      <CardTitle>White-label branding</CardTitle>
      <p style={{ color: t.color.textMuted, fontSize: t.font.sm, marginTop: -6, marginBottom: 16 }}>
        Make Eynis your own. Anything you leave blank falls back to your industry defaults.
      </p>

      {/* Live preview of the sidebar brand block */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: t.radius.md, background: t.color.bg, border: `1px solid ${t.color.border}`, marginBottom: 16 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: logoUrl && !logoBroken ? "transparent" : primary, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {logoUrl && !logoBroken
            ? <img src={logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={() => setLogoBroken(true)} onLoad={() => setLogoBroken(false)} />
            : <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{(form.brandName || "E").charAt(0).toUpperCase()}</span>}
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#5a7a9a", fontWeight: 600 }}>{form.brandName || "Eynis"}</div>
          <div style={{ fontSize: 12, color: t.color.textMuted }}>{form.tagline || "your industry tagline"}</div>
        </div>
      </div>

      <Field label="Brand name" hint="Replaces the “Eynis” wordmark in the sidebar."><Input value={form.brandName ?? ""} onChange={(e) => set({ brandName: e.target.value })} placeholder="Acme Cloud" /></Field>
      <Field label="Tagline" hint="Sidebar subtitle."><Input value={form.tagline ?? ""} onChange={(e) => set({ tagline: e.target.value })} placeholder="Operations, intelligently" /></Field>

      <Field
        label="Logo URL"
        hint={
          logoUrl && !looksLikeImage(logoUrl)
            ? warn("That looks like a page link, not an image. Use the host's “Direct link” (ends in .png/.jpg/.svg) — e.g. https://iili.io/xxxx.png, not …/i/xxxx.")
            : logoBroken
              ? warn("Couldn't load that image — check the URL is public and a direct link.")
              : "Direct image link, square works best (PNG/SVG). Right-click the image → “Copy image address”."
        }
      >
        <Input value={form.logoUrl ?? ""} onChange={(e) => { setLogoBroken(false); set({ logoUrl: e.target.value }); }} placeholder="https://cdn.acme.com/logo.png"
          style={(logoUrl && !looksLikeImage(logoUrl)) || logoBroken ? { borderColor: t.color.warning } : undefined} />
      </Field>

      <Field
        label="Favicon URL"
        hint={
          form.faviconUrl?.trim() && !looksLikeImage(form.faviconUrl)
            ? warn("Use a direct image link (.png/.ico/.svg).")
            : faviconBroken
              ? warn("Couldn't load that favicon — check the URL.")
              : "Browser-tab icon (.ico/.png/.svg). Falls back to your logo if blank."
        }
      >
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          {(form.faviconUrl?.trim() || logoUrl) && !faviconBroken && (
            <img src={form.faviconUrl?.trim() || logoUrl} alt="" width={20} height={20} style={{ objectFit: "contain", flexShrink: 0 }} onError={() => setFaviconBroken(true)} />
          )}
          <Input value={form.faviconUrl ?? ""} onChange={(e) => { setFaviconBroken(false); set({ faviconUrl: e.target.value }); }} placeholder="https://cdn.acme.com/favicon.png" />
        </div>
      </Field>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Primary color" hint="Hex, e.g. #0f766e">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="color" value={!colorInvalid(form.primaryColor) && form.primaryColor ? form.primaryColor : "#0f766e"} onChange={(e) => set({ primaryColor: e.target.value })} style={{ width: 38, height: 38, padding: 0, border: `1px solid ${t.color.border}`, borderRadius: 8, background: "none" }} />
            <Input value={form.primaryColor ?? ""} onChange={(e) => set({ primaryColor: e.target.value })} placeholder="#0f766e" style={colorInvalid(form.primaryColor) ? { borderColor: t.color.danger } : undefined} />
          </div>
        </Field>
        <Field label="Accent color" hint="Defaults to primary if blank.">
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="color" value={!colorInvalid(form.accentColor) && form.accentColor ? form.accentColor : "#0f766e"} onChange={(e) => set({ accentColor: e.target.value })} style={{ width: 38, height: 38, padding: 0, border: `1px solid ${t.color.border}`, borderRadius: 8, background: "none" }} />
            <Input value={form.accentColor ?? ""} onChange={(e) => set({ accentColor: e.target.value })} placeholder="(optional)" style={colorInvalid(form.accentColor) ? { borderColor: t.color.danger } : undefined} />
          </div>
        </Field>
      </div>
      <Field label="Support email" hint="Shown to your customers on outbound messaging (later)."><Input value={form.supportEmail ?? ""} onChange={(e) => set({ supportEmail: e.target.value })} placeholder="support@acme.com" /></Field>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: t.font.sm, fontWeight: 600, margin: "4px 0 16px" }}>
        <input type="checkbox" checked={form.hidePoweredBy === true} onChange={(e) => set({ hidePoweredBy: e.target.checked })} />
        Hide the “Eynis” wordmark (full white-label)
      </label>

      <Button onClick={save} disabled={saving}>{saving ? "Saving…" : "Save branding"}</Button>
    </Card>
  );
}
