// White-label theming. A tenant's branding overrides its industry defaults,
// which in turn override the Eynis fallback. Keep this a pure function so the
// precedence is testable and identical wherever a theme is resolved.
//
//   tenant branding  ▶  industry default  ▶  Eynis fallback
//
// White-label TIER (E-9) gates the "deep" overrides: hiding "powered by", a
// custom font, and the extended sidebar token are honored only on the
// `white_label` tier. Logo / name / tagline / colors are available to every tier.

import type { IndustryConfig } from "./industry-config";

export interface TenantBranding {
  brandName?: string | null;
  tagline?: string | null;
  logoUrl?: string | null;
  faviconUrl?: string | null;
  primaryColor?: string | null;
  accentColor?: string | null;
  sidebarColor?: string | null;
  fontFamily?: string | null;
  customCss?: string | null;
  supportEmail?: string | null;
  hidePoweredBy?: boolean | null;
  brandEmails?: boolean | null;
  brandReports?: boolean | null;
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
  /** Extended token: sidebar background (white_label tier). null → default chrome. */
  sidebarColor: string | null;
  /** Typography override (white_label tier). null → default font stack. */
  fontFamily: string | null;
  /** Sanitised custom CSS (white_label tier). null → none injected. */
  customCss: string | null;
  hidePoweredBy: boolean;
}

// Only the `white_label` tier unlocks the deep overrides. Kept in sync with the
// API's core/whitelabel.ts.
export const isFullWhiteLabel = (tier: string | null | undefined): boolean => tier === "white_label";

export function resolveTheme(
  branding: TenantBranding | null | undefined,
  industry: Pick<IndustryConfig, "accentColor" | "tagline">,
  tier?: string | null,
): ResolvedTheme {
  const b = branding ?? {};
  const fullWl = isFullWhiteLabel(tier);
  const primaryColor = b.primaryColor || industry.accentColor;
  return {
    brandName: b.brandName ?? null,
    subtitle: b.tagline || industry.tagline,
    logoUrl: b.logoUrl ?? null,
    faviconUrl: b.faviconUrl || b.logoUrl || null,
    primaryColor,
    accentColor: b.accentColor || primaryColor,
    // Deep overrides — gated to the white_label tier.
    sidebarColor: fullWl ? (b.sidebarColor ?? null) : null,
    fontFamily: fullWl ? (b.fontFamily ?? null) : null,
    customCss: fullWl ? (b.customCss ?? null) : null,
    hidePoweredBy: fullWl && b.hidePoweredBy === true,
  };
}
