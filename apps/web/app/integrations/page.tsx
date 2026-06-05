import { CONNECTOR_CATALOG, CONNECTOR_CATEGORY_LABELS } from "@eynis/shared";
import { fetchConnectorRegistry } from "../../lib/data";
import { IntegrationsClient } from "../../components/ui/integrations-client";
import type { ConnectorRegistryItem } from "../../lib/data";

export const dynamic = "force-dynamic";

// Fallback tiles rendered straight from the shared catalog when the per-tenant
// status call is unavailable (e.g. the web tier can't mint an API token). The
// page stays useful instead of showing an empty error state.
const CATALOG_ITEMS: ConnectorRegistryItem[] = CONNECTOR_CATALOG.map((c) => ({
  key: c.key,
  category: c.category,
  categoryLabel: CONNECTOR_CATEGORY_LABELS[c.category],
  name: c.name,
  description: c.description,
  icon: c.icon,
  brandColor: c.brandColor,
  requiredFields: c.requiredFields,
  planned: c.planned,
  enabled: false,
  status: c.planned ? "planned" : "disabled",
  source: "env",
  ingestModes: c.ingestModes,
  config: {},
}));

// Integrations is its own top-level module (E-5) — promoted out of Settings.
export default async function IntegrationsPage() {
  let items = CATALOG_ITEMS;
  let statusLoaded = false;
  try {
    const data = await fetchConnectorRegistry();
    if (data.ok && data.items.length > 0) {
      items = data.items;
      statusLoaded = true;
    }
  } catch {
    // Keep the catalog fallback — the page renders the tiles regardless.
  }

  return <IntegrationsClient items={items} statusLoaded={statusLoaded} />;
}
