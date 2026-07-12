import { fetchInventory } from "../../lib/data";
import { InventoryClient } from "../../components/ui/inventory-client";

export const dynamic = "force-dynamic";

// Material Yield / stock for manufacturing — real data, backed by the same
// InventoryItem store as the Inventory feature (name, category, on-hand stock, unit,
// unit cost, reorder level). Previously this page was 100% mock; it now shows the
// tenant's actual materials with cost + reorder status and full add/edit/delete.
export default async function MaterialsPage() {
  const data = await fetchInventory().catch(() => ({ ok: false, items: [] as never[] }));
  return (
    <InventoryClient
      initialItems={data.items ?? []}
      heading={{ title: "Materials", subtitle: "Live material stock · unit costs · reorder alerts" }}
    />
  );
}
