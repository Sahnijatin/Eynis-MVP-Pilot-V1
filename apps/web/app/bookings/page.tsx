import { fetchBookings } from "../../lib/data";
import { BookingsClient } from "../../components/ui/bookings-client";

export const dynamic = "force-dynamic";

// Booking Pipeline (Wave 5) — real bookings backed by the Booking model.
export default async function BookingsPage() {
  const data = await fetchBookings();
  return <BookingsClient initialItems={data.items} />;
}
