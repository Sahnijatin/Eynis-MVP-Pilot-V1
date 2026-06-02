import { fetchQueueData } from "../../lib/data";
import { filtersToSearchString } from "../../lib/queue-filters";
import { QueueClient } from "../../components/ui/queue-client";

export const dynamic = "force-dynamic";

export default async function QueuePage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = searchParams ? await searchParams : {};
  const filters = {
    status:      typeof query.status      === "string" ? query.status      : "",
    slaState:    typeof query.slaState    === "string" ? query.slaState    : "",
    assignedToMe:typeof query.assignedToMe=== "string" ? query.assignedToMe: "",
    sortBy:      typeof query.sortBy      === "string" ? query.sortBy      : "",
    sortOrder:   typeof query.sortOrder   === "string" ? query.sortOrder   : ""
  };
  const action   = typeof query.action === "string" ? query.action  : "";
  const result   = typeof query.result === "string" ? query.result  : "";
  const flashMsg = typeof query.msg    === "string" ? query.msg     : "";
  const returnSearch = filtersToSearchString(filters);

  let items:  NonNullable<Awaited<ReturnType<typeof fetchQueueData>>["queue"]["items"]>  = [];
  let users:  NonNullable<Awaited<ReturnType<typeof fetchQueueData>>["users"]["items"]>  = [];

  try {
    const response = await fetchQueueData(filters);
    items = (response.queue.items ?? []) as typeof items;
    users = response.users.items ?? [];
  } catch { }

  return (
    <QueueClient
      items={items as any}
      users={users}
      filters={filters}
      action={action}
      result={result}
      flashMsg={flashMsg}
      returnSearch={returnSearch}
    />
  );
}
