import { fetchGuests } from "../../lib/data";
import { GuestDatabaseClient, type GuestRow } from "../../components/ui/guest-database-client";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 20;

export default async function GuestDatabasePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const q = searchParams ? await searchParams : {};
  const search = typeof q.search === "string" ? q.search : undefined;
  const rawOffset = typeof q.offset === "string" ? parseInt(q.offset, 10) : 0;
  const offset = Number.isFinite(rawOffset) && rawOffset > 0 ? rawOffset : 0;

  let items: GuestRow[] = [];
  let total = 0;
  try {
    const guests = await fetchGuests({ search, limit: PAGE_SIZE, offset });
    items = (guests?.items ?? []) as GuestRow[];
    total = guests?.page?.total ?? 0;
  } catch { }

  return (
    <GuestDatabaseClient
      items={items}
      total={total}
      search={search}
      offset={offset}
      pageSize={PAGE_SIZE}
    />
  );
}
