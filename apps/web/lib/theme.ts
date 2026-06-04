// White-label theming. A tenant's branding overrides its industry defaults,
// which in turn override the Eynis fallback. Keep this a pure function so the
// precedence is testable and identical wherever a theme is resolved.
//
//   tenant branding  ▶  industry default  ▶  Eynis fallback

import type { IndustryConfig } from "./industry-config";

export interface TenantBranding {
  brandName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  supportEmail?: string | null;
  hidePoweredBy?: boolean | null;
}

export interface ResolvedTheme {
  /** Platform/white-label wordmark override (the small label above the title).
   *  null → caller shows "Eynis" unless `hidePoweredBy`. */
  brandName: string | null;
  /** Sidebar subtitle. */
  subtitle: string;
  /** Tenant logo image, or null to fall back to the industry glyph. */
  logoUrl: string | null;
  /** Browser-tab favicon; falls back to the logo, then null. */
  faviconUrl: string | null;
  /** Primary brand color (buttons, accents). */
  primaryColor: string;
  /** Secondary accent; defaults to primaryColor. */
  accentColor: string;
  hidePoweredBy: boolean;
}

export function resolveTheme(
  branding: TenantBranding | null | undefined,
  industry: Pick<IndustryConfig, "accentColor" | "tagline">,
): ResolvedTheme {
  const b = branding ?? {};
  const primaryColor = b.primaryColor || industry.accentColor;
  return {
    brandName: b.brandName ?? null,
    subtitle: b.tagline || industry.tagline,
    logoUrl: b.logoUrl ?? null,
    faviconUrl: b.faviconUrl || b.logoUrl || null,
    primaryColor,
    accentColor: b.accentColor || primaryColor,
    hidePoweredBy: b.hidePoweredBy === true,
  };
}
