import { fetchTasks } from "../../lib/data";
import type { TaskRow } from "../../lib/data";
import { TasksClient } from "../../components/ui/tasks-client";

export const dynamic = "force-dynamic";

export default async function TasksPage() {
  let tasks: TaskRow[] = [];
  try {
    const r = await fetchTasks({ status: "open" });
    if (r.ok) tasks = r.items;
  } catch { /* render empty */ }
  return <TasksClient initialTasks={tasks} />;
}
