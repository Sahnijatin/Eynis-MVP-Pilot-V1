import { prisma } from "../db/prisma";
import type { LicenseFeature } from "@eynis/shared";

// Features available per plan. Starter gets none of the gated features.
const PLAN_FEATURES: Record<string, Set<LicenseFeature>> = {
  starter: new Set(),
  growth: new Set([
    "custom_roles",
    "advanced_analytics",
    "ai_features",
    "automations",
    "night_audit",
  ]),
  enterprise: new Set([
    "custom_roles",
    "advanced_analytics",
    "ai_features",
    "automations",
    "night_audit",
  ]),
};

const FEATURE_LABELS: Record<LicenseFeature, string> = {
  custom_roles:        "Custom Roles",
  advanced_analytics:  "Advanced Analytics",
  ai_features:         "AI Intelligence",
  automations:         "Automations",
  night_audit:         "Night Audit",
};

export const isPlanAllowed = (plan: string, feature: LicenseFeature): boolean => {
  const features = PLAN_FEATURES[plan] ?? PLAN_FEATURES.starter;
  return features.has(feature);
};

export const enforceLicenseFeature = async (
  hotelId: string,
  feature: LicenseFeature,
): Promise<{ ok: true } | { ok: false; error: string; requiredPlan: string }> => {
  const license = await prisma.license.findUnique({
    where: { hotelId },
    select: { plan: true },
  });
  const plan = license?.plan ?? "starter";
  if (!isPlanAllowed(plan, feature)) {
    return {
      ok: false,
      error: `${FEATURE_LABELS[feature]} requires the Growth plan or above. Your current plan is ${plan}.`,
      requiredPlan: "growth",
    };
  }
  return { ok: true };
};
