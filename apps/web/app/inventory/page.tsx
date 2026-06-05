import { fetchInventory } from "../../lib/data";
import { InventoryClient } from "../../components/ui/inventory-client";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  const data = await fetchInventory();
  return <InventoryClient initialItems={data.items ?? []} />;
}
