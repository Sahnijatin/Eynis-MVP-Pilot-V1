"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_COOKIE, effectiveThemeMode, type ThemeMode } from "../../lib/theme-mode";

// Light/dark toggle (design-system Phase 2). Flips `data-theme` on <html>,
// persists the choice in a cookie (so SSR stamps it next load with no flash),
// and broadcasts `eynis-theme-change` so the app shell re-injects the accent
// ramp for the new theme.
//
// Shipped in the topbar (Phase 8) now that the colour migration (Phases 4–8) has
// tokenised the app chrome, feature screens, and inline-style neutrals — opt-in
// dark is complete across the app. The default stays light until OS-honoring is
// switched on (see lib/theme-mode.ts).
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    // Reflect the EFFECTIVE theme (data-theme may be "system" → read the OS).
    setMode(effectiveThemeMode());
    const mq = window.matchMedia?.("(prefers-color-scheme: dark)");
    const onOS = () => { if (document.documentElement.getAttribute("data-theme") === "system") setMode(effectiveThemeMode()); };
    mq?.addEventListener?.("change", onOS);
    return () => mq?.removeEventListener?.("change", onOS);
  }, []);

  function toggle() {
    // Clicking always sets an EXPLICIT choice (leaving "system"), so it wins over
    // the OS in both directions from here on.
    const next: ThemeMode = mode === "dark" ? "light" : "dark";
    document.documentElement.setAttribute("data-theme", next);
    document.cookie = `${THEME_COOKIE}=${next};path=/;max-age=31536000;samesite=lax`;
    setMode(next);
    window.dispatchEvent(new CustomEvent("eynis-theme-change", { detail: next }));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      className={`topbar-icon-btn ${className}`}
      aria-label={mode === "dark" ? "Switch to light theme" : "Switch to dark theme"}
      title={mode === "dark" ? "Light theme" : "Dark theme"}
    >
      {mode === "dark" ? <Sun className="w-4.5 h-4.5" /> : <Moon className="w-4.5 h-4.5" />}
    </button>
  );
}
