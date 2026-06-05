import { fetchConnectorRegistry } from "../../lib/data";
import { IntegrationsClient } from "../../components/ui/integrations-client";
import type { ConnectorRegistryItem } from "../../lib/data";

export const dynamic = "force-dynamic";

// Integrations is its own top-level module (E-5) — promoted out of Settings.
export default async function IntegrationsPage() {
  let items: ConnectorRegistryItem[] = [];
  let error = "";
  try {
    const data = await fetchConnectorRegistry();
    if (data.ok) items = data.items;
  } catch (e) {
    error = e instanceof Error ? e.message : "Failed to load integrations";
  }

  return (
    <div>
      {error && <div className="mb-4 p-3 bg-red-50 text-red-600 rounded-lg text-sm">{error}</div>}
      <IntegrationsClient items={items} />
    </div>
  );
}
