import { getUserWorkspace } from "../../lib/workspace";
import { fetchOrders } from "../../lib/data";
import { OrdersBoard } from "../../components/ui/orders-board";
import { OrdersFnbMock } from "../../components/ui/orders-fnb-mock";

export const dynamic = "force-dynamic";

// Live Orders (Phase 7). Manufacturing renders the REAL fulfillment pipeline
// (orders created from accepted quotes); F&B keeps its Preview until its
// restaurant-order flow is wired.
export default async function OrdersPage() {
  const { industry } = await getUserWorkspace();
  if (industry === "manufacturing") {
    const data = await fetchOrders();
    return <OrdersBoard initialItems={data.items} initialSummary={data.summary} />;
  }
  return <OrdersFnbMock />;
}
