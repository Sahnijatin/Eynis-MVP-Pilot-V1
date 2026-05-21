"use client";

import type { CSSProperties, ReactNode } from "react";
import { createContext, useContext, useState } from "react";

/** Pending state for the enclosing `PendingForm` (must not pass function children from RSC). */
const PendingContext = createContext(false);

export function PendingForm({
  action,
  method = "POST",
  children
}: {
  action: string;
  method?: "GET" | "POST";
  children: ReactNode;
}) {
  const [pending, setPending] = useState(false);
  return (
    <PendingContext.Provider value={pending}>
      <form action={action} method={method} onSubmit={() => setPending(true)}>
        {children}
      </form>
    </PendingContext.Provider>
  );
}

const primary: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #2563eb",
  background: "#2563eb",
  color: "#fff"
};

const secondary: CSSProperties = {
  padding: "6px 12px",
  borderRadius: 6,
  border: "1px solid #cbd5e1",
  background: "#fff",
  color: "#334155"
};

export function PendingSubmitButton({
  label,
  pendingLabel,
  variant = "primary"
}: {
  label: string;
  pendingLabel?: string;
  variant?: "primary" | "secondary";
}) {
  const pending = useContext(PendingContext);
  const base = variant === "primary" ? primary : secondary;
  return (
    <button
      type="submit"
      disabled={pending}
      style={{
        ...base,
        opacity: pending ? 0.7 : 1,
        cursor: pending ? "wait" : "pointer"
      }}
    >
      {pending ? (pendingLabel ?? "Working…") : label}
    </button>
  );
}
