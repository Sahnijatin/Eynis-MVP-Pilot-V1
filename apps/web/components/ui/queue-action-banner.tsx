"use client";

import { useRouter } from "next/navigation";
import type { QueueFilterState } from "../../lib/queue-filters";

export function QueueActionBanner({
  action,
  result,
  flashMsg,
  filters
}: {
  action: string;
  result: string;
  flashMsg: string;
  filters: QueueFilterState;
}) {
  const router = useRouter();

  if (!action) return null;

  const isOk = result === "ok";
  const isError = result === "error";
  const title =
    action === "status" ? "Status update" : action === "assign" ? "Assignment" : action;

  const dismiss = () => {
    const p = new URLSearchParams();
    if (filters.status) p.set("status", filters.status);
    if (filters.slaState) p.set("slaState", filters.slaState);
    if (filters.sortBy) p.set("sortBy", filters.sortBy);
    if (filters.sortOrder) p.set("sortOrder", filters.sortOrder);
    if (filters.assignedToMe === "true") p.set("assignedToMe", "true");

    const qs = p.toString();
    router.replace(qs ? `/queue?${qs}` : "/queue");
  };

  return (
    <div
      style={{
        background: isOk ? "#dcfce7" : "#fee2e2",
        color: isOk ? "#166534" : "#991b1b",
        border: "1px solid " + (isOk ? "#86efac" : "#fecaca"),
        padding: "8px 10px",
        borderRadius: 8,
        marginBottom: 12,
        display: "flex",
        gap: 12,
        alignItems: "flex-start",
        justifyContent: "space-between"
      }}
    >
      <div style={{ minWidth: 0 }}>
        <p style={{ margin: 0, fontWeight: 600 }}>
          {title} {isOk ? "completed." : "failed."}
        </p>
        {isError && flashMsg ? (
          <p style={{ margin: "6px 0 0 0", fontSize: 14, fontWeight: 400, opacity: 0.95 }}>
            {flashMsg}
          </p>
        ) : null}
      </div>
      <button
        type="button"
        onClick={dismiss}
        style={{
          flex: "0 0 auto",
          border: "1px solid " + (isOk ? "#86efac" : "#fecaca"),
          background: isOk ? "#ffffff" : "#ffffff",
          color: isOk ? "#166534" : "#991b1b",
          borderRadius: 6,
          padding: "4px 10px",
          cursor: "pointer"
        }}
        aria-label="Dismiss message"
      >
        Dismiss
      </button>
    </div>
  );
}

