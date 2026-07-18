export function Badge({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const styleByTone = {
    neutral: { background: "var(--info-bg)", color: "#3730a3" },
    success: { background: "var(--ok-bg)", color: "var(--ok-text)" },
    warning: { background: "var(--warn-bg)", color: "var(--warn-text)" },
    danger: { background: "var(--danger-bg)", color: "var(--danger-text)" }
  } as const;

  const toneStyle = styleByTone[tone];
  return (
    <span
      style={{
        display: "inline-block",
        padding: "2px 8px",
        borderRadius: 999,
        fontSize: 12,
        fontWeight: 600,
        ...toneStyle
      }}
    >
      {label}
    </span>
  );
}
