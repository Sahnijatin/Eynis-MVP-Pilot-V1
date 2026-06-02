import { fetchTeamRoles, fetchTeamLicense } from "../../../lib/data";
import { getUserWorkspace } from "../../../lib/workspace";
import RolesClient from "../../../components/ui/roles-client";

export const dynamic = "force-dynamic";

export default async function RolesPage() {
  const [rolesRes, licenseRes, ws] = await Promise.all([
    fetchTeamRoles(),
    fetchTeamLicense(),
    getUserWorkspace(),
  ]);

  return (
    <RolesClient
      initialRoles={rolesRes.roles ?? []}
      plan={licenseRes.license?.plan ?? "starter"}
      accentColor={ws.config.accentColor}
      propertyLabel={ws.config.terminology.property}
      teamLabel={ws.config.terminology.team}
    />
  );
}
