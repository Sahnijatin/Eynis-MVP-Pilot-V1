"use client";

import { useMemo, useState } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import { Calendar, X } from "lucide-react";

// Reusable date-range filter for analytics/report pages (E-15). Presets (Today /
// 7d / 30d / 90d) plus a custom range. State lives in the URL (?from&to) so the
// server component re-renders with the new window — shareable and back-button
// friendly. `defaultPreset` is highlighted when no params are set.

const DAY_MS = 86_400_000;
// Format in the user's LOCAL calendar date. toISOString() is UTC — for an IST
// user before 05:30 it made "Today" mean yesterday and shifted every preset
// window by a day (invisibly, since the active-preset highlight used the same
// skewed math).
const ymd = (d: Date) => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

const PRESETS: Array<{ key: string; label: string; days: number }> = [
  { key: "today", label: "Today", days: 0 },
  { key: "7d", label: "7 days", days: 6 },
  { key: "30d", label: "30 days", days: 29 },
  { key: "90d", label: "90 days", days: 89 },
];

export function DateRangeControl({ defaultPreset = "30d" }: { defaultPreset?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const from = sp.get("from");
  const to = sp.get("to");

  const [showCustom, setShowCustom] = useState(false);
  const [cFrom, setCFrom] = useState(from ?? "");
  const [cTo, setCTo] = useState(to ?? "");

  // Which preset (if any) the current ?from&to matches, for active styling.
  const active = useMemo(() => {
    if (!from && !to) return defaultPreset;
    const today = ymd(new Date());
    if (to === today) {
      for (const p of PRESETS) {
        if (from === ymd(new Date(Date.now() - p.days * DAY_MS))) return p.key;
      }
    }
    return "custom";
  }, [from, to, defaultPreset]);

  function push(f: string, t: string) {
    const params = new URLSearchParams(sp.toString());
    params.set("from", f);
    params.set("to", t);
    router.push(`${pathname}?${params.toString()}`);
  }

  function applyPreset(days: number) {
    const today = new Date();
    push(ymd(new Date(today.getTime() - days * DAY_MS)), ymd(today));
    setShowCustom(false);
  }

  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex items-center gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.days)}
            className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors"
            style={active === p.key && !showCustom
              ? { background: "var(--color-primary, #0f766e)", color: "#fff" }
              : { border: "1px solid #e2e8f0", color: "#475569" }}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom((v) => !v)}
          className="px-3 py-1.5 text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
          style={active === "custom" || showCustom
            ? { background: "var(--color-primary, #0f766e)", color: "#fff" }
            : { border: "1px solid #e2e8f0", color: "#475569" }}
        >
          <Calendar className="w-3.5 h-3.5" /> Custom
        </button>
      </div>

      {showCustom && (
        <div className="flex items-center gap-3 p-3 bg-surface-inset rounded-xl border border-line">
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-fg-muted">From</label>
            <input type="date" value={cFrom} max={cTo || undefined} onChange={(e) => setCFrom(e.target.value)}
              className="border border-line rounded-lg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent-border" />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs font-semibold text-fg-muted">To</label>
            <input type="date" value={cTo} min={cFrom || undefined} onChange={(e) => setCTo(e.target.value)}
              className="border border-line rounded-lg px-3 py-1.5 text-sm text-fg outline-none focus:border-accent-border" />
          </div>
          <button
            onClick={() => { push(cFrom, cTo); setShowCustom(false); }}
            disabled={!cFrom || !cTo}
            className="px-4 py-1.5 rounded-lg text-sm font-semibold text-white disabled:opacity-40 transition-opacity"
            style={{ background: "var(--color-primary, #0f766e)" }}
          >
            Apply
          </button>
          <button onClick={() => setShowCustom(false)} className="text-fg-muted hover:text-fg-muted">
            <X className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );
}
