import { fetchMenuItems } from "../../lib/data";
import { MenuClient } from "../../components/ui/menu-client";

export const dynamic = "force-dynamic";

// Menu & Pricing (Wave 5) — real menu catalogue backed by the MenuItem model.
export default async function MenuPage() {
  const data = await fetchMenuItems();
  return <MenuClient initialItems={data.items} />;
}
