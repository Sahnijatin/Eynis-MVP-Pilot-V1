import { headers } from "next/headers";
import { getIndustryConfig, type Industry } from "./industry-config";
import { resolveTheme, type TenantBranding } from "./theme";

// Server-side, pre-auth tenant theming for white-label hosts (A7). Reads the
// incoming Host header and asks the API which tenant (if any) owns it, so the
// sign-in / sign-up pages can render the tenant's brand before the user logs in.
// Always degrades to the Eynis default — on the platform host, a miss, or any
// error — so it can never break the auth pages.

const apiBase = () => process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";

export interface HostTheme {
  brandName: string;        // wordmark to show (tenant's brand, or "Eynis")
  logoUrl: string | null;
  primaryColor: string;
  isTenant: boolean;        // true when a custom-host tenant resolved
}

const DEFAULT_THEME: HostTheme = { brandName: "Eynis", logoUrl: null, primaryColor: "#0f766e", isTenant: false };

export async function resolveHostTheme(): Promise<HostTheme> {
  try {
    const host = (await headers()).get("host");
    if (!host) return DEFAULT_THEME;

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500); // never hang the auth render
    try {
      const res = await fetch(`${apiBase()}/tenant/resolve?host=${encodeURIComponent(host)}`, { cache: "no-store", signal: ctrl.signal });
      if (!res.ok) return DEFAULT_THEME;
      const data = (await res.json()) as { ok: boolean; found?: boolean; industry?: string; propertyName?: string; branding?: TenantBranding | null };
      if (!data.ok || !data.found) return DEFAULT_THEME;

      const config = getIndustryConfig((data.industry as Industry) ?? "hospitality");
      const theme = resolveTheme(data.branding ?? null, config);
      return {
        brandName: theme.brandName ?? data.propertyName ?? "Eynis",
        logoUrl: theme.logoUrl,
        primaryColor: theme.primaryColor,
        isTenant: true,
      };
    } finally {
      clearTimeout(timer);
    }
  } catch {
    return DEFAULT_THEME;
  }
}
