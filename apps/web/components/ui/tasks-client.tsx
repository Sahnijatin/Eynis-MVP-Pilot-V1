"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { PageHeader, Badge, Button, Modal, Field, Input, Select, Textarea, Spinner, useToast, tokens as t } from "../ds";
import { DataGrid, type GridColumn } from "./data-grid";
import { CrmTabs } from "./crm-tabs";
import type { TaskRow } from "../../lib/data";

const fmtDate = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-IN", { day: "numeric", month: "short" }) : "");
const isOverdue = (due: string | null) => !!due && new Date(due).getTime() < Date.now();

type ContactLite = { id: string; fullName: string };

export function TasksClient({ initialTasks, contacts = [] }: { initialTasks: TaskRow[]; contacts?: ContactLite[] }) {
  const router = useRouter();
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  const [creating, setCreating] = useState(false);
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
      <PageHeader
        title="Tasks"
        subtitle="Your open follow-ups across every contact and deal"
        actions={<Button onClick={() => setCreating(true)}>+ New Task</Button>}
      />
      <DataGrid<TaskRow>
        rows={tasks}
        columns={columns}
        getId={(t) => t.id}
        storageKey="tasks"
        exportFilename="tasks"
        onEditCell={editCell}
        searchPlaceholder="Search tasks…"
        emptyTitle="No open tasks"
        emptyDescription="Tasks you add here — or on a contact — show up in this list so nothing slips through the cracks."
      />
      {creating && (
        <CreateTaskModal contacts={contacts} onClose={() => setCreating(false)} onCreated={() => { setCreating(false); router.refresh(); }} />
      )}
    </div>
  );
}

function CreateTaskModal({ contacts, onClose, onCreated }: { contacts: ContactLite[]; onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [dueAt, setDueAt] = useState("");
  const [contactId, setContactId] = useState("");
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    if (!title.trim()) { setError("Task is required"); return; }
    if (!dueAt) { setError("Due date is required"); return; }
    setBusy(true); setError(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ title: title.trim(), dueAt, contactId: contactId || undefined, body: notes.trim() || undefined }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not create task");
      toast.push("Task created", "success");
      onCreated();
    } catch (e) { setError(e instanceof Error ? e.message : "Could not create task"); }
    finally { setBusy(false); }
  }

  return (
    <Modal title="New Task" onClose={onClose} footer={<><Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button><Button onClick={submit} disabled={busy}>{busy ? <Spinner size={14} /> : "Create task"}</Button></>}>
      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        <Field label="Task"><Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Follow up about…" autoFocus /></Field>
        <Field label="Due date"><Input type="date" value={dueAt} onChange={(e) => setDueAt(e.target.value)} /></Field>
        {contacts.length > 0 && (
          <Field label="Contact" hint="optional — link this task to a contact">
            <Select value={contactId} onChange={(e) => setContactId(e.target.value)}>
              <option value="">None</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>{c.fullName}</option>)}
            </Select>
          </Field>
        )}
        <Field label="Notes" hint="optional"><Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} /></Field>
        {error && <div style={{ color: t.color.danger, fontSize: t.font.sm }}>{error}</div>}
      </div>
    </Modal>
  );
}
