// Design tokens — a single source of truth for the modern-SaaS look.
// Neutral slate palette + one teal accent, soft borders, subtle shadows.

export const tokens = {
  color: {
    bg: "#f8fafc", // slate-50 (page background)
    surface: "#ffffff",
    surfaceMuted: "#f1f5f9", // slate-100
    border: "#e2e8f0", // slate-200
    borderStrong: "#cbd5e1", // slate-300
    text: "#0f172a", // slate-900
    textMuted: "#64748b", // slate-500
    textFaint: "#94a3b8", // slate-400
    accent: "#0f766e", // teal-700
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
