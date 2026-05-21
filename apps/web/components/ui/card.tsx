import type { ReactNode } from "react";

export function Card({
  title,
  value,
  hint
}: {
  title: string;
  value: ReactNode;
  hint?: string;
}) {
  return (
    <div style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, background: "#fff" }}>
      <strong>{title}</strong>
      <div style={{ fontSize: 22, marginTop: 6 }}>{value}</div>
      {hint ? <p style={{ margin: "6px 0 0 0", color: "#666", fontSize: 12 }}>{hint}</p> : null}
    </div>
  );
}
