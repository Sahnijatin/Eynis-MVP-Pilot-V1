// Branded email chrome (E-9). Wraps a rendered email body in a minimal,
// inline-styled shell carrying the tenant's brand (logo/name + color), an optional
// support-contact line, and a "powered by" footer that is dropped for white_label
// tenants. Email clients strip <style>/external CSS, so everything is inline.

import { prisma } from "../../db/prisma";
import { allowsFullWhiteLabel } from "../whitelabel";

// The platform's own identity. Overridable so the platform itself can be resold.
const PLATFORM_NAME = process.env.PLATFORM_BRAND_NAME?.trim() || "Eynis";
const PLATFORM_COLOR = "#0f766e";

export interface EmailBrand {
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  supportEmail: string | null;
  showPoweredBy: boolean; // false for white_label tenants
}

// Resolves the brand for a tenant's outbound email, or null when the tenant has
// opted out of brand chrome (brandEmails = false) — in which case the raw body is
// sent as-is. Honors the white-label tier: only white_label hides "powered by".
export async function loadEmailBrand(tenantId: string): Promise<EmailBrand | null> {
  const tenant = await prisma.tenant
    .findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        whitelabelTier: true,
        branding: { select: { brandName: true, primaryColor: true, logoUrl: true, supportEmail: true, brandEmails: true } }
      }
    })
    .catch(() => null);
  if (!tenant) return null;
  const b = tenant.branding;
  if (b && b.brandEmails === false) return null; // tenant disabled email brand chrome
  return {
    brandName: b?.brandName || tenant.name || PLATFORM_NAME,
    primaryColor: b?.primaryColor || PLATFORM_COLOR,
    logoUrl: b?.logoUrl ?? null,
    supportEmail: b?.supportEmail ?? null,
    showPoweredBy: !allowsFullWhiteLabel(tenant.whitelabelTier)
  };
}

const esc = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function wrapBrandedEmail(bodyHtml: string, brand: EmailBrand): string {
  const header = brand.logoUrl
    ? `<img src="${esc(brand.logoUrl)}" alt="${esc(brand.brandName)}" style="height:32px;max-width:180px;object-fit:contain" />`
    : `<span style="font-size:18px;font-weight:700;color:#ffffff">${esc(brand.brandName)}</span>`;
  const support = brand.supportEmail
    ? `<div style="padding:0 24px 16px;color:#94a3b8;font-size:12px;text-align:center">Questions? <a href="mailto:${esc(brand.supportEmail)}" style="color:${esc(brand.primaryColor)}">${esc(brand.supportEmail)}</a></div>`
    : "";
  const footer = brand.showPoweredBy
    ? `<div style="padding:16px 24px;color:#94a3b8;font-size:12px;text-align:center">Powered by ${esc(PLATFORM_NAME)}</div>`
    : "";
  return [
    `<div style="margin:0;padding:0;background:#f1f5f9">`,
    `<div style="max-width:600px;margin:0 auto;background:#ffffff;border-radius:12px;overflow:hidden;font-family:Inter,system-ui,Segoe UI,Arial,sans-serif">`,
    `<div style="padding:20px 24px;background:${esc(brand.primaryColor)}">${header}</div>`,
    `<div style="padding:24px;color:#0f172a;font-size:14px;line-height:1.6">${bodyHtml}</div>`,
    support,
    footer,
    `</div></div>`
  ].join("");
}
