import { currentUser } from "@clerk/nextjs/server";
import { getIndustryConfig, type Industry, type IndustryConfig } from "./industry-config";

export async function getUserWorkspace(): Promise<{
  industry: Industry | null;
  config: IndustryConfig;
  onboardingCompleted: boolean;
}> {
  try {
    const user = await currentUser();
    if (!user) {
      return { industry: null, config: getIndustryConfig(null), onboardingCompleted: false };
    }
    const industry = (user.unsafeMetadata?.industry as Industry) ?? null;
    const onboardingCompleted = Boolean(user.unsafeMetadata?.onboardingCompleted);
    return {
      industry,
      config: getIndustryConfig(industry),
      onboardingCompleted
    };
  } catch {
    // Fallback when Clerk is not configured
    return { industry: "hospitality", config: getIndustryConfig("hospitality"), onboardingCompleted: true };
  }
}
