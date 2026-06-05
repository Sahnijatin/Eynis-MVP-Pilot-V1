import { fetchCompanies, fetchTeamUsers } from "../../lib/data";
import type { CompanyRow } from "../../lib/data";
import { CompaniesClient } from "../../components/ui/companies-client";

export const dynamic = "force-dynamic";

export default async function CompaniesPage() {
  let companies: CompanyRow[] = [];
  let owners: Array<{ id: string; fullName: string }> = [];
  try {
    const [coRes, uRes] = await Promise.all([
      fetchCompanies(),
      fetchTeamUsers().catch(() => ({ ok: false, users: [] as Array<{ id: string; fullName: string }> })),
    ]);
    if (coRes.ok) companies = coRes.items;
    owners = (uRes.users ?? []).map((u) => ({ id: u.id, fullName: u.fullName }));
  } catch {
    /* render empty */
  }
  return <CompaniesClient initialCompanies={companies} owners={owners} />;
}
