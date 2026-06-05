"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Badge, useToast } from "../ds";
import { DataGrid, type GridColumn } from "./data-grid";
import { CrmTabs } from "./crm-tabs";
import type { TaskRow } from "../../lib/data";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const isOverdue = (due: string | null) => !!due && new Date(due).getTime() < Date.now();

export function TasksClient({ initialTasks }: { initialTasks: TaskRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  useEffect(() => setTasks(initialTasks), [initialTasks]);

  // Inline status edit: setting a task to "done" marks the activity complete.
  async function editCell(row: TaskRow, key: string, value: string) {
    if (key !== "status") return;
    if (value !== "done") return;
    const res = await fetch(`/api/activities/${row.id}`, {
      method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ completed: true }),
    });
    const data = await res.json();
    if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
    toast.push("Task completed", "success");
    router.refresh();
  }

  const columns: GridColumn<TaskRow>[] = [
    { key: "status", header: "Status", type: "select", accessor: () => "Open", editAccessor: () => "open", editable: true,
      options: [{ value: "open", label: "Open" }, { value: "done", label: "Done" }], width: 90, filterable: false },
    { key: "title", header: "Task", accessor: (t) => t.title, width: 280 },
    { key: "contact", header: "Contact", accessor: (t) => t.contactName ?? "" },
    { key: "due", header: "Due", type: "date", accessor: (t) => t.dueAt ?? "",
      render: (t) => t.dueAt ? <Badge tone={isOverdue(t.dueAt) ? "danger" : "neutral"}>{isOverdue(t.dueAt) ? "overdue · " : ""}{fmtDate(t.dueAt)}</Badge> : <span>—</span> },
    { key: "type", header: "Type", accessor: (t) => t.type },
    { key: "assignedBy", header: "Assigned by", accessor: (t) => t.userName ?? "", defaultHidden: true },
  ];

  return (
    <div style={{ padding: 24 }}>
      <CrmTabs />
      <PageHeader title="Tasks" subtitle="Your open follow-ups across every contact and deal" />
      <DataGrid<TaskRow>
        rows={tasks}
        columns={columns}
        getId={(t) => t.id}
        storageKey="tasks"
        exportFilename="tasks"
        onEditCell={editCell}
        searchPlaceholder="Search tasks…"
        emptyTitle="No open tasks"
        emptyDescription="Tasks you add on a contact show up here so nothing slips through the cracks."
      />
    </div>
  );
}
