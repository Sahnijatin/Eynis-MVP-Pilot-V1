"use client";

import { useEffect, useState } from "react";
import { resolveTheme, type ResolvedTheme, type TenantBranding } from "../../lib/theme";
import { getIndustryConfig, type Industry } from "../../lib/industry-config";

// Branded header for in-app reports / exports (E-9). Renders the tenant's brand
// (logo + name on the brand color) above a report so it carries the brand on
// screen and when printed to PDF. Respects the `brandReports` artifact flag and
// the white-label tier (via resolveTheme). Renders nothing until brand resolves.
export function ReportBrandHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const [state, setState] = useState<{ theme: ResolvedTheme; name: string } | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/me", { cache: "no-store" })
      .then((r) => r.json())
      .then((d: { ok?: boolean; exists?: boolean; industry?: string; propertyName?: string | null; branding?: TenantBranding | null; whitelabelTier?: string | null }) => {
        if (!alive || !d.ok || !d.exists) return;
        const branding = d.branding ?? null;
        if (branding?.brandReports === false) return; // tenant opted out of report brand chrome
        const config = getIndustryConfig((d.industry as Industry) ?? "hospitality");
        const theme = resolveTheme(branding, config, d.whitelabelTier);
        setState({ theme, name: theme.brandName ?? d.propertyName ?? "" });
      })
      .catch(() => { /* keep header hidden on failure */ });
    return () => { alive = false; };
  }, []);

  if (!state) return null;
  const { theme, name } = state;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, paddingBottom: 12, marginBottom: 16, borderBottom: `2px solid ${theme.primaryColor}` }}>
      <div style={{ width: 36, height: 36, borderRadius: 8, background: theme.primaryColor, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
        {theme.logoUrl
          ? <img src={theme.logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
          : <span style={{ color: "#fff", fontWeight: 700 }}>{(name || "•").charAt(0).toUpperCase()}</span>}
      </div>
      <div style={{ lineHeight: 1.3 }}>
        {name && <div style={{ fontWeight: 700, color: "#0f172a" }}>{name}</div>}
        <div style={{ fontSize: 12, color: "#64748b" }}>{title}{subtitle ? ` · ${subtitle}` : ""}</div>
      </div>
    </div>
  );
}
