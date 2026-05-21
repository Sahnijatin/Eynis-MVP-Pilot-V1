export function Badge({
  label,
  tone = "neutral"
}: {
  label: string;
  tone?: "neutral" | "success" | "warning" | "danger";
}) {
  const styleByTone = {
    neutral: { background: "#eef2ff", color: "#3730a3" },
    success: { background: "#dcfce7", color: "#166534" },
    warning: { background: "#fef3c7", color: "#92400e" },
    danger: { background: "#fee2e2", color: "#991b1b" }
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
