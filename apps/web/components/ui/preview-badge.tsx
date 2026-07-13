import type { ReactNode } from "react";

// Shared "this is sample data" signposting (improvement plan 3.3). Every surface
// that renders hardcoded/demo content must carry one of these so a pilot tenant
// can always tell a preview from their live records. Remove per surface as each
// vertical gets wired to real data.

const CHIP_STYLE = { background: "#fef3c7", color: "#b45309" } as const;

export function PreviewBadge({ label = "Preview" }: { label?: string }) {
  return (
    <span className="badge" style={CHIP_STYLE} title="Sample data — not yet connected to your live records">
      {label}
    </span>
  );
}

export function PreviewBanner({ children }: { children?: ReactNode }) {
  return (
    <div
      className="mb-4 px-3 py-2 rounded-lg text-sm flex items-center gap-2"
      style={{ background: "#fffbeb", border: "1px solid #fde68a", color: "#92400e" }}
    >
      <span className="badge shrink-0" style={CHIP_STYLE}>Preview</span>
      <span>{children ?? "This page shows sample data. It is not yet connected to your live records."}</span>
    </div>
  );
}
