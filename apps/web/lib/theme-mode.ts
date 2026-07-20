// Light/dark theme resolution (design-system Phase 2 — Adaptive Dual-Tone).
// The app stamps an explicit `data-theme` on <html> server-side from this cookie,
// so there's no flash and no hydration mismatch.

export const THEME_COOKIE = "eynis_theme";
export type ThemeMode = "light" | "dark";
// What gets stamped on <html data-theme>: an explicit choice, or "system" to let
// the CSS `@media (prefers-color-scheme)` block in globals.css drive it.
export type ThemeChoice = ThemeMode | "system";

/**
 * Resolve the value to stamp on `<html data-theme>` from the cookie.
 *
 * With no explicit cookie the app now **honours the OS** — it stamps `"system"`,
 * and the `:root[data-theme="system"]` `@media (prefers-color-scheme: dark)` block
 * in globals.css applies the dark tokens when the OS is dark (and falls through to
 * the light `:root` defaults otherwise). This is SSR-safe: the stamp is
 * deterministic, and the OS resolution happens in CSS with no flash and no
 * hydration mismatch. An explicit `light`/`dark` choice (via the toggle) always
 * wins over the OS in both directions.
 *
 * Enabled once the whole colour migration landed (Phases 4–9 + the categorical
 * tint tail): every surface — Tailwind utilities, inline neutrals, and the
 * segment/status chip tints — has validated dark steps, so honouring OS-dark no
 * longer surfaces un-migrated light chips on a dark canvas.
 */
export function resolveThemeMode(cookieValue: string | undefined | null): ThemeChoice {
  if (cookieValue === "dark") return "dark";
  if (cookieValue === "light") return "light";
  return "system";
}

/**
 * Resolve the concrete light/dark theme on the client — `data-theme` may be
 * `"system"`, in which case we read the OS preference. Used by the accent-ramp
 * injector and the toggle, which need a concrete theme, not the stamp.
 */
export function effectiveThemeMode(): ThemeMode {
  if (typeof document !== "undefined") {
    const attr = document.documentElement.getAttribute("data-theme");
    if (attr === "dark") return "dark";
    if (attr === "light") return "light";
  }
  if (typeof window !== "undefined" && typeof window.matchMedia === "function") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  return "light";
}
