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
    "research_studio",
  ]),
  enterprise: new Set([
    "custom_roles",
    "advanced_analytics",
    "ai_features",
    "automations",
    "night_audit",
    "research_studio",
  ]),
};

const FEATURE_LABELS: Record<LicenseFeature, string> = {
  custom_roles:        "Custom Roles",
  advanced_analytics:  "Advanced Analytics",
  ai_features:         "AI Intelligence",
  automations:         "Automations",
  night_audit:         "Night Audit",
  research_studio:     "Research Studio",
};

export const isPlanAllowed = (plan: string, feature: LicenseFeature): boolean => {
  const features = PLAN_FEATURES[plan] ?? PLAN_FEATURES.starter;
  return features.has(feature);
};

export const enforceLicenseFeature = async (
  tenantId: string,
  feature: LicenseFeature,
): Promise<{ ok: true } | { ok: false; error: string; requiredPlan: string }> => {
  const license = await prisma.license.findUnique({
    where: { tenantId },
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
