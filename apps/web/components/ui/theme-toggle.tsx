"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { THEME_COOKIE, type ThemeMode } from "../../lib/theme-mode";

// Light/dark toggle (design-system Phase 2). Flips `data-theme` on <html>,
// persists the choice in a cookie (so SSR stamps it next load with no flash),
// and broadcasts `eynis-theme-change` so the app shell re-injects the accent
// ramp for the new theme.
//
// Mounted only behind NEXT_PUBLIC_ENABLE_THEME_TOGGLE until the component color
// migration (Phase 6) completes — before then, dark mode only covers the
// var-driven shell, so it isn't shipped to end users yet.
export function ThemeToggle({ className = "" }: { className?: string }) {
  const [mode, setMode] = useState<ThemeMode>("light");

  useEffect(() => {
    const cur = document.documentElement.getAttribute("data-theme");
    setMode(cur === "dark" ? "dark" : "light");
  }, []);

  function toggle() {
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
