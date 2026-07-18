// Light/dark theme resolution (design-system Phase 2 — Adaptive Dual-Tone).
// The app stamps an explicit `data-theme` on <html> server-side from this cookie,
// so there's no flash and no hydration mismatch.

export const THEME_COOKIE = "eynis_theme";
export type ThemeMode = "light" | "dark";

/**
 * Resolve the theme to stamp on <html> from the cookie value.
 *
 * Deliberately defaults to **light** until the component color migration (Phase 6)
 * is complete: most feature surfaces still use hardcoded light colors, so honoring
 * an OS dark preference now would render a half-migrated, broken dark UI. Only an
 * explicit `dark` choice (via the gated toggle) opts in. Phase 6 will switch the
 * default to honor `prefers-color-scheme`.
 */
export function resolveThemeMode(cookieValue: string | undefined | null): ThemeMode {
  return cookieValue === "dark" ? "dark" : "light";
}
