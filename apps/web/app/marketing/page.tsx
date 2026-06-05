import { notFound } from "next/navigation";
import { getUserWorkspace } from "../../lib/workspace";
import { getModule } from "../../lib/industry-config";
import { ModuleLanding } from "../../components/ui/module-landing";

export const dynamic = "force-dynamic";

export default async function MarketingLandingPage() {
  const { config } = await getUserWorkspace();
  const mod = getModule(config, "marketing");
  if (!mod) return notFound();
  return <ModuleLanding module={mod} accentColor={config.accentColor} />;
}
