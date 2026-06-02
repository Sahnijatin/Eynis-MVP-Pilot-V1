import { fetchTeamUsers, fetchTeamRoles } from "../../../lib/data";
import { getUserWorkspace } from "../../../lib/workspace";
import TeamClient from "../../../components/ui/team-client";

export const dynamic = "force-dynamic";

export default async function TeamPage() {
  const [usersRes, rolesRes, ws] = await Promise.all([
    fetchTeamUsers(),
    fetchTeamRoles(),
    getUserWorkspace(),
  ]);

  return (
    <TeamClient
      initialUsers={usersRes.users ?? []}
      usedSeats={usersRes.usedSeats ?? 0}
      maxSeats={usersRes.maxSeats ?? 5}
      roles={rolesRes.roles ?? []}
      accentColor={ws.config.accentColor}
      propertyLabel={ws.config.terminology.property}
      teamLabel={ws.config.terminology.team}
      industryName={ws.config.name}
    />
  );
}
