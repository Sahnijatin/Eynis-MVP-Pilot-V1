// Brand resolution for generated reports / exports (E-9). Parallel to the email
// branding loader but keyed off the `brandReports` artifact flag. Unlike email
// (which sends raw when the tenant opts out), a report always has a header — when
// `brandReports` is false we just fall back to a neutral platform header.

import { prisma } from "../../db/prisma";
import { allowsFullWhiteLabel } from "../whitelabel";

const PLATFORM_NAME = process.env.PLATFORM_BRAND_NAME?.trim() || "Eynis";
const PLATFORM_COLOR = "#0f766e";

export interface ReportBrand {
  brandName: string;
  primaryColor: string;
  logoUrl: string | null;
  supportEmail: string | null;
  showPoweredBy: boolean; // false for white_label tenants
  platformName: string;
}

export async function loadReportBrand(tenantId: string): Promise<ReportBrand> {
  const tenant = await prisma.tenant
    .findUnique({
      where: { id: tenantId },
      select: {
        name: true,
        whitelabelTier: true,
        branding: { select: { brandName: true, primaryColor: true, logoUrl: true, supportEmail: true, brandReports: true } }
      }
    })
    .catch(() => null);

  const b = tenant?.branding;
  const branded = !!b && b.brandReports !== false;
  return {
    brandName: (branded && b?.brandName) || tenant?.name || PLATFORM_NAME,
    primaryColor: (branded && b?.primaryColor) || PLATFORM_COLOR,
    logoUrl: branded ? b?.logoUrl ?? null : null,
    supportEmail: branded ? b?.supportEmail ?? null : null,
    showPoweredBy: !allowsFullWhiteLabel(tenant?.whitelabelTier),
    platformName: PLATFORM_NAME
  };
}
