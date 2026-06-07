"use client";

import { useEffect, useState } from "react";
import { Button, Card, CardTitle, Field, Input, useToast, tokens as t } from "../ds";
import type { TenantBranding } from "../../lib/theme";

// Settings → Branding: edit per-tenant white-label overrides. Anything left
// blank falls back to the industry default, so this is purely additive.
const EMPTY: TenantBranding = {
  brandName: "", tagline: "", logoUrl: "", faviconUrl: "", primaryColor: "", accentColor: "",
  sidebarColor: "", fontFamily: "", supportEmail: "", hidePoweredBy: false, brandEmails: true, brandReports: true,
};

// True for direct image links / data URLs. Page links (e.g. freeimage.host/i/…)
// return false — they serve HTML, not an image, so <img> can't render them.
const looksLikeImage = (u?: string | null) =>
  !u || /^data:image\//i.test(u) || /\.(png|jpe?g|svg|webp|gif|ico|avif)(\?.*)?$/i.test(u.trim());

export function BrandingPanel() {
  const toast = useToast();
  const [form, setForm] = useState<TenantBranding>(EMPTY);
  const [tier, setTier] = useState<string>("standard");
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
        if (alive && data.ok) {
          if (data.branding) setForm({ ...EMPTY, ...data.branding });
          if (data.whitelabelTier) setTier(data.whitelabelTier);
        }
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, []);

  // The white-label TIER (set by us via the provisioning console) gates the deep
  // overrides — custom font, sidebar color, and hiding "powered by" (E-9).
  const fullWl = tier === "white_label";

  const set = (patch: Partial<TenantBranding>) => setForm((f) => ({ ...f, ...patch }));
  const colorInvalid = (v: string | null | undefined) => Boolean(v && !/^#[0-9a-fA-F]{6}$/.test(v));

  async function save() {
    if (colorInvalid(form.primaryColor) || colorInvalid(form.accentColor) || colorInvalid(form.sidebarColor)) {
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
        Make the product your own. Anything you leave blank falls back to your industry defaults.
      </p>

      {/* Live preview of the sidebar brand block */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: 12, borderRadius: t.radius.md, background: t.color.bg, border: `1px solid ${t.color.border}`, marginBottom: 16 }}>
        <div style={{ width: 32, height: 32, borderRadius: 8, background: logoUrl && !logoBroken ? "transparent" : primary, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {logoUrl && !logoBroken
            ? <img src={logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} onError={() => setLogoBroken(true)} onLoad={() => setLogoBroken(false)} />
            : <span style={{ color: "#fff", fontWeight: 700, fontSize: 13 }}>{(form.brandName || "B").charAt(0).toUpperCase()}</span>}
        </div>
        <div style={{ lineHeight: 1.2 }}>
          <div style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: 1, color: "#5a7a9a", fontWeight: 600 }}>{form.brandName || "Your brand"}</div>
          <div style={{ fontSize: 12, color: t.color.textMuted }}>{form.tagline || "your industry tagline"}</div>
        </div>
      </div>

      <Field label="Brand name" hint="Replaces the platform wordmark in the sidebar."><Input value={form.brandName ?? ""} onChange={(e) => set({ brandName: e.target.value })} placeholder="Acme Cloud" /></Field>
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
      <Field label="Support email" hint="Shown on your branded emails and reports."><Input value={form.supportEmail ?? ""} onChange={(e) => set({ supportEmail: e.target.value })} placeholder="support@acme.com" /></Field>

      {/* Artifact-branding flags (E-9): carry the brand onto emails / reports. */}
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: t.font.sm, fontWeight: 600, margin: "4px 0 8px" }}>
        <input type="checkbox" checked={form.brandEmails !== false} onChange={(e) => set({ brandEmails: e.target.checked })} />
        Brand outbound emails (header + colors)
      </label>
      <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: t.font.sm, fontWeight: 600, margin: "0 0 16px" }}>
        <input type="checkbox" checked={form.brandReports !== false} onChange={(e) => set({ brandReports: e.target.checked })} />
        Brand reports &amp; exports (header + colors)
      </label>

      {/* Deep white-label — gated to the white_label tier (set by us). */}
      <div style={{ borderTop: `1px solid ${t.color.border}`, paddingTop: 16, marginTop: 4 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: fullWl ? 12 : 4 }}>
          <span style={{ fontSize: t.font.sm, fontWeight: 700 }}>Full white-label</span>
          <span style={{ fontSize: t.font.xs, fontWeight: 700, padding: "2px 8px", borderRadius: 999, background: fullWl ? "#0f766e18" : t.color.bg, color: fullWl ? "#0f766e" : t.color.textMuted, border: `1px solid ${t.color.border}` }}>
            {fullWl ? "Enabled" : "White-label tier"}
          </span>
        </div>
        {!fullWl && (
          <p style={{ color: t.color.textMuted, fontSize: t.font.xs, marginTop: 0, marginBottom: 12 }}>
            Custom font, sidebar color, and hiding the “powered by” line are part of the white-label tier. Contact support to upgrade.
          </p>
        )}
        <div style={{ opacity: fullWl ? 1 : 0.55, pointerEvents: fullWl ? "auto" : "none" }}>
          <Field label="Sidebar color" hint="Hex, e.g. #142032. Defaults to the platform sidebar.">
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input type="color" disabled={!fullWl} value={!colorInvalid(form.sidebarColor) && form.sidebarColor ? form.sidebarColor : "#142032"} onChange={(e) => set({ sidebarColor: e.target.value })} style={{ width: 38, height: 38, padding: 0, border: `1px solid ${t.color.border}`, borderRadius: 8, background: "none" }} />
              <Input value={form.sidebarColor ?? ""} onChange={(e) => set({ sidebarColor: e.target.value })} placeholder="(optional)" style={colorInvalid(form.sidebarColor) ? { borderColor: t.color.danger } : undefined} />
            </div>
          </Field>
          <Field label="Font family" hint="A CSS font stack, e.g. Poppins, system-ui, sans-serif. Letters/quotes/commas only.">
            <Input value={form.fontFamily ?? ""} onChange={(e) => set({ fontFamily: e.target.value })} placeholder="Inter, system-ui, sans-serif" />
          </Field>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: t.font.sm, fontWeight: 600, margin: "4px 0 4px" }}>
            <input type="checkbox" disabled={!fullWl} checked={form.hidePoweredBy === true} onChange={(e) => set({ hidePoweredBy: e.target.checked })} />
            Hide the platform “powered by” wordmark
          </label>
        </div>
      </div>

      <Button onClick={save} disabled={saving} style={{ marginTop: 16 }}>{saving ? "Saving…" : "Save branding"}</Button>
    </Card>
  );
}
