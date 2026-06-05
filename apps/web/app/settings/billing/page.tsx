import { fetchTeamLicense } from "../../../lib/data";
import { getUserWorkspace } from "../../../lib/workspace";
import { getIndustryConfig } from "../../../lib/industry-config";
import BillingClient from "../../../components/ui/billing-client";

export const dynamic = "force-dynamic";

export default async function BillingPage() {
  const licenseRes = await fetchTeamLicense();

  let industry = "hospitality";
  let supportEmail: string | null = null;
  try {
    const ws = await getUserWorkspace();
    industry = ws.industry ?? getIndustryConfig(null).id;
    supportEmail = ws.branding?.supportEmail ?? null;
  } catch { }

  return (
    <BillingClient license={licenseRes.license ?? null} industry={industry} supportEmail={supportEmail} />
  );
}
