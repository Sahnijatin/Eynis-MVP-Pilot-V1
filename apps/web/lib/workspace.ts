import { resolveUserContext } from "./user-context";
import { getIndustryConfig, type Industry, type IndustryConfig } from "./industry-config";

export async function getUserWorkspace(): Promise<{
  industry: Industry | null;
  config: IndustryConfig;
  onboardingCompleted: boolean;
}> {
  try {
    const ctx = await resolveUserContext();
    const industry = (ctx.industry as Industry) ?? null;
    return {
      industry,
      config: getIndustryConfig(industry),
      onboardingCompleted: ctx.exists,
    };
  } catch {
    return { industry: "hospitality", config: getIndustryConfig("hospitality"), onboardingCompleted: true };
  }
}
