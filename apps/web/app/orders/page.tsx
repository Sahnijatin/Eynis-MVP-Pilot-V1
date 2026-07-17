import { fetchOrders } from "../../lib/data";
import { OrdersBoard } from "../../components/ui/orders-board";

export const dynamic = "force-dynamic";

// Live Orders (Phase 7 + Wave 5). Both Manufacturing and F&B render the REAL
// fulfillment board — orders created automatically from accepted quotes
// (production runs / catering & bulk orders). The board handles the empty state,
// so a new tenant sees a real (if empty) board rather than sample data.
export default async function OrdersPage() {
  const data = await fetchOrders();
  return <OrdersBoard initialItems={data.items} initialSummary={data.summary} />;
}
