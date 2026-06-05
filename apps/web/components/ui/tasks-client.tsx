"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Card, PageHeader, Badge, EmptyState, Button, useToast, tokens as t } from "../ds";
import type { TaskRow } from "../../lib/data";

export function TasksClient({ initialTasks }: { initialTasks: TaskRow[] }) {
  const router = useRouter();
  const toast = useToast();
  const [tasks, setTasks] = useState<TaskRow[]>(initialTasks);
  useEffect(() => setTasks(initialTasks), [initialTasks]);

  async function complete(task: TaskRow) {
    setTasks((prev) => prev.filter((t) => t.id !== task.id)); // optimistic
    try {
      const res = await fetch(`/api/activities/${task.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ completed: true }) });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Failed");
      toast.push("Task completed", "success");
      router.refresh();
    } catch (e) {
      toast.push(e instanceof Error ? e.message : "Failed", "error");
      setTasks((prev) => [task, ...prev]); // roll back
    }
  }

  function overdue(due: string | null): boolean {
    return !!due && new Date(due).getTime() < Date.now();
  }

  return (
    <div style={{ padding: 24 }}>
      <PageHeader title="Tasks" subtitle="Your open follow-ups across every contact and deal" />
      {tasks.length === 0 ? (
        <EmptyState title="No open tasks" description="Tasks you add on a contact show up here so nothing slips through the cracks." icon="✅" />
      ) : (
        <Card style={{ padding: 0, overflow: "hidden" }}>
          {tasks.map((task) => (
            <div key={task.id} style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px", borderTop: `1px solid ${t.color.border}` }}>
              <button onClick={() => complete(task)} title="Mark done" style={{ width: 20, height: 20, borderRadius: 5, border: `2px solid ${t.color.borderStrong}`, background: "none", cursor: "pointer", flexShrink: 0 }} />
              <div style={{ flex: 1 }}>
                <div style={{ fontWeight: 600, color: t.color.text, fontSize: t.font.sm }}>{task.title}</div>
                <div style={{ fontSize: t.font.xs, color: t.color.textMuted }}>
                  {task.contactName ? `${task.contactName} · ` : ""}{task.userName ? `assigned by ${task.userName}` : ""}
                </div>
              </div>
              {task.dueAt && (
                <Badge tone={overdue(task.dueAt) ? "danger" : "neutral"}>
                  {overdue(task.dueAt) ? "overdue · " : ""}{new Date(task.dueAt).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}
                </Badge>
              )}
              <Button variant="secondary" onClick={() => complete(task)}>Done</Button>
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}
