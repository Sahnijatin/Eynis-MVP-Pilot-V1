import { fetchTasks, fetchContacts } from "../../lib/data";
import type { TaskRow } from "../../lib/data";
import { TasksClient } from "../../components/ui/tasks-client";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  let tasks: TaskRow[] = [];
  let contacts: Array<{ id: string; fullName: string }> = [];
  try {
    const [t, c] = await Promise.all([
      fetchTasks({ status: "open" }),
      fetchContacts().catch(() => ({ ok: false, items: [] as { id: string; fullName: string }[] })),
    ]);
    if (t.ok) tasks = t.items;
    if (c.ok) contacts = c.items.map((x) => ({ id: x.id, fullName: x.fullName }));
  } catch { /* render empty */ }
  return <TasksClient initialTasks={tasks} contacts={contacts} />;
}
