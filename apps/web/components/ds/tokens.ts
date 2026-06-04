// Design tokens — kept in lockstep with the CSS variables in app/globals.css
// (--color-*), so the design-system primitives share ONE palette with the rest
// of the app (dark-teal sidebar shell, stat cards, charts) — no drift.

export const tokens = {
  color: {
    bg: "#f4f6fa", // --color-bg
    surface: "#ffffff", // --color-surface
    surfaceMuted: "#f1f5f9", // slate-100 (hover/fills)
    border: "#e6eaf0", // --color-border
    borderStrong: "#cbd5e1", // slate-300 (input borders)
    text: "#0f172a", // --color-text
    textMuted: "#64748b", // --color-muted
    textFaint: "#94a3b8", // slate-400
    // Accent reads the white-label CSS var set by the app shell (resolved theme),
    // falling back to the teal default for SSR / pre-hydration. accentHover/Soft
    // stay static for now — a follow-up can derive them from the live accent.
    accent: "var(--color-accent, #0f766e)",
    accentHover: "#0e6b63",
    accentSoft: "#f0fdfa", // teal-50
    danger: "#b91c1c",
    dangerSoft: "#fef2f2",
    success: "#15803d",
    warning: "#b45309",
  },
  radius: { sm: 6, md: 8, lg: 12, pill: 999 },
  shadow: {
    sm: "0 1px 2px rgba(15,23,42,0.04), 0 1px 3px rgba(15,23,42,0.06)",
    md: "0 4px 12px rgba(15,23,42,0.08)",
    lg: "0 10px 30px rgba(15,23,42,0.12)",
  },
  font: {
    xs: 12, sm: 13, base: 14, lg: 16, xl: 20, xxl: 26,
  },
} as const;
