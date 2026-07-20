// Light/dark theme resolution (design-system Phase 2 — Adaptive Dual-Tone).
// The app stamps an explicit `data-theme` on <html> server-side from this cookie,
// so there's no flash and no hydration mismatch.

export const THEME_COOKIE = "eynis_theme";
export type ThemeMode = "light" | "dark";

/**
 * Resolve the theme to stamp on <html> from the cookie value.
 *
 * Defaults to **light**; only an explicit `dark` choice (via the now-shipped
 * toggle, Phase 8) opts in. The colour migration (Phases 4–8) tokenised the
 * Tailwind-utility surfaces and the inline-style neutrals, so opt-in dark is
 * complete across the app. Honoring `prefers-color-scheme` by DEFAULT is held
 * back one more step: the categorical / segment tints (coloured chips in the CRM
 * and industry dashboards) don't yet have dark steps, so forcing OS-dark on every
 * user would surface those light-tint chips on a dark canvas. Flip this to honor
 * the OS once those land.
 */
export function resolveThemeMode(cookieValue: string | undefined | null): ThemeMode {
  return cookieValue === "dark" ? "dark" : "light";
}
