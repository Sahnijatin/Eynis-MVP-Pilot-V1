import { getUserWorkspace } from "../../lib/workspace";
import { fetchPlaces, fetchMyPermissions } from "../../lib/data";
import DiscoverClient from "../../components/ui/discover-client";

export const dynamic = "force-dynamic";

// Discover — an interactive local-discovery map of curated places with an AI
// concierge and the Golden-Pin promotion. Industry-neutral: any tenant can
// surface nearby places (partners, attractions, dining…) to its audience.
export default async function DiscoverPage() {
  const { config } = await getUserWorkspace();
  const [places, permissions] = await Promise.all([fetchPlaces(), fetchMyPermissions()]);

  return (
    <DiscoverClient
      initialPlaces={places.items}
      accent={config.accentColor}
      canManage={permissions.includes("manage_places")}
    />
  );
}
