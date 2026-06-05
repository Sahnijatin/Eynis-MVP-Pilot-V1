import { resolveUserContext } from "./user-context";
import { getIndustryConfig, type Industry, type IndustryConfig } from "./industry-config";
import type { TenantBranding } from "./theme";

export async function getUserWorkspace(): Promise<{
  industry: Industry | null;
  config: IndustryConfig;
  onboardingCompleted: boolean;
  branding: TenantBranding | null;
}> {
  try {
    const ctx = await resolveUserContext();
    const industry = (ctx.industry as Industry) ?? null;
    return {
      industry,
      config: getIndustryConfig(industry),
      onboardingCompleted: ctx.exists,
      branding: ctx.branding ?? null,
    };
  } catch {
    return { industry: "hospitality", config: getIndustryConfig("hospitality"), onboardingCompleted: true, branding: null };
  }
}
