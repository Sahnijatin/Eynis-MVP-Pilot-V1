// Design tokens — now thin references to the semantic CSS variables defined in
// app/globals.css (the design-system token layer, Phases 2-3). Every primitive
// and every component that reads `t.color.*` inline therefore shares ONE
// token layer with the rest of the app AND flips correctly in dark mode —
// no hardcoded hex, no drift. See docs/design-system/tokens.md.

export const tokens = {
  color: {
    bg: "var(--bg)",
    surface: "var(--surface)",
    surfaceMuted: "var(--surface-inset)",
    border: "var(--border)",
    borderStrong: "var(--border-strong)",
    text: "var(--text)",
    textMuted: "var(--text-muted)",
    textFaint: "var(--text-subtle)", // AA-safe subtle tier
    // Text colour for use ON the accent solid — the ramp computes white or dark
    // ink per hue so a coloured button label is always legible.
    onAccent: "var(--accent-contrast, #ffffff)",
    // Accent reads the generated ramp (step 9 = solid), falling back to the
    // legacy white-label var then the teal default for SSR / non-shell surfaces.
    accent: "var(--accent-solid, var(--color-accent, #0f766e))",
    accentHover: "var(--accent-solid-hover, var(--color-accent, #0f766e))",
    accentSoft: "var(--accent-bg, #f0fdfa)",
    // AA-guaranteed accent TEXT (ramp step 11) — for links/labels/badge text on a
    // light or tinted surface, where the solid (step 9) would be too low-contrast.
    accentText: "var(--accent-text, var(--color-accent, #0f766e))",
    danger: "var(--danger-text)",
    dangerSoft: "var(--danger-bg)",
    dangerSolid: "var(--danger-solid)",
    success: "var(--ok-text)",
    successSoft: "var(--ok-bg)",
    successSolid: "var(--ok-solid)",
    warning: "var(--warn-text)",
    warningSoft: "var(--warn-bg)",
    warningSolid: "var(--warn-solid)",
    info: "var(--info-text)",
    infoSoft: "var(--info-bg)",
    infoSolid: "var(--info-solid)",
  },
  radius: { sm: 6, md: 8, lg: 12, pill: 999 },
  shadow: {
    sm: "var(--shadow-1)",
    md: "var(--shadow-2)",
    lg: "var(--shadow-3)",
  },
  font: {
    xs: 12, sm: 13, base: 14, lg: 16, xl: 20, xxl: 26,
  },
} as const;
