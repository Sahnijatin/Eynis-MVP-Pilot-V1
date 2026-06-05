import { fetchContacts, fetchCompanies, fetchTeamUsers } from "../../lib/data";
import type { ContactRow, CompanyRow } from "../../lib/data";
import { ContactsClient } from "../../components/ui/contacts-client";

export const dynamic = "force-dynamic";

export default async function ContactsPage() {
  let contacts: ContactRow[] = [];
  let companies: CompanyRow[] = [];
  let owners: Array<{ id: string; fullName: string }> = [];
  try {
    const [cRes, coRes, uRes] = await Promise.all([
      fetchContacts(),
      fetchCompanies().catch(() => ({ ok: false, items: [] as CompanyRow[] })),
      fetchTeamUsers().catch(() => ({ ok: false, users: [] as Array<{ id: string; fullName: string }> })),
    ]);
    if (cRes.ok) contacts = cRes.items;
    if (coRes.ok) companies = coRes.items;
    owners = (uRes.users ?? []).map((u) => ({ id: u.id, fullName: u.fullName }));
  } catch {
    /* render empty */
  }
  return <ContactsClient initialContacts={contacts} companies={companies} owners={owners} />;
}
