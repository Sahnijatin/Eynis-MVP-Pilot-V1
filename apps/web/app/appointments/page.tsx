import { fetchAppointments } from "../../lib/data";
import { AppointmentsClient } from "../../components/ui/appointments-client";

export const dynamic = "force-dynamic";

// Appointments (Wave 5) — today's real schedule from the Appointment model.
export default async function AppointmentsPage() {
  const today = new Date().toISOString().slice(0, 10);
  const data = await fetchAppointments(today);
  return <AppointmentsClient initialItems={data.items} dateLabel="Today" />;
}
