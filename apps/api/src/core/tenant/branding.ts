// Tenant branding helpers (#164) — the white-label column select and the inbound
// payload sanitiser, shared by the tenant-settings router (PUT /tenant/branding)
// and the public tenant-resolution / identify routes in server.ts. Extracted so
// both sides use one definition.
import { sanitizeCustomCss } from "../css-sanitize";

export const BRANDING_SELECT = {
  brandName: true, tagline: true, logoUrl: true, faviconUrl: true,
  primaryColor: true, accentColor: true, sidebarColor: true, fontFamily: true,
  customCss: true, supportEmail: true, hidePoweredBy: true, brandEmails: true, brandReports: true,
} as const;

// Coerce/validate an inbound branding payload into the writable columns. Strings
// are trimmed; blanks become null (so clearing a field resets to industry default).
export const sanitizeBranding = (body: Record<string, unknown>) => {
  const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
  const color = (v: unknown): string | null => {
    const s = str(v);
    return s && /^#[0-9a-fA-F]{6}$/.test(s) ? s : null; // only accept #rrggbb
  };
  // Font-family stack: a conservative whitelist so it can be safely dropped into a
  // CSS variable. Letters/digits/space/comma/hyphen and quotes only — no ; { } < >
  // ( ) so it can't break out of the declaration or smuggle url()/expression().
  const font = (v: unknown): string | null => {
    const s = str(v);
    return s && s.length <= 200 && /^[a-zA-Z0-9 ,"'\-]+$/.test(s) ? s : null;
  };
  const bool = (v: unknown, dflt: boolean): boolean => (typeof v === "boolean" ? v : dflt);
  return {
    brandName: str(body.brandName),
    tagline: str(body.tagline),
    logoUrl: str(body.logoUrl),
    faviconUrl: str(body.faviconUrl),
    primaryColor: color(body.primaryColor),
    accentColor: color(body.accentColor),
    sidebarColor: color(body.sidebarColor),
    fontFamily: font(body.fontFamily),
    customCss: sanitizeCustomCss(body.customCss),
    supportEmail: str(body.supportEmail),
    hidePoweredBy: body.hidePoweredBy === true,
    brandEmails: bool(body.brandEmails, true),
    brandReports: bool(body.brandReports, true),
  };
};
