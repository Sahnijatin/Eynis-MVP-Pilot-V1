import { fetchPatients } from "../../lib/data";
import { PatientsClient } from "../../components/ui/patients-client";

export const dynamic = "force-dynamic";

// Patient Records (Wave 5) — real records backed by the Patient model.
export default async function PatientsPage() {
  const data = await fetchPatients();
  return <PatientsClient initialItems={data.items} />;
}
