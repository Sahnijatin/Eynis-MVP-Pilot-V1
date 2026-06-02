import { fetchGuests } from "../../lib/data";
import { GuestDatabaseClient, type GuestRow } from "../../components/ui/guest-database-client";

export const dynamic = "force-dynamic";

export default async function GuestDatabasePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = searchParams ? await searchParams : {};
  const search = typeof q.search === "string" ? q.search : undefined;

  let items: GuestRow[] = [];
  let total = 0;
  try {
    const guests = await fetchGuests({ search, limit: 20 });
    items = (guests?.items ?? []) as GuestRow[];
    total = guests?.page?.total ?? 0;
  } catch { }

  return <GuestDatabaseClient items={items} total={total} search={search} />;
}
