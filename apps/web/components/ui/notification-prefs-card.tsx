"use client";

import { useEffect, useState } from "react";
import { useToast } from "../ds";

const BRAND = "var(--color-primary, #0f766e)";

type Prefs = { escalations: boolean; inventory: boolean; quotes: boolean };

const ROWS: { key: keyof Prefs; label: string }[] = [
  { key: "escalations", label: "Escalations & SLA breaches" },
  { key: "inventory", label: "Inventory alerts" },
  { key: "quotes", label: "Quote reminders" },
];

// Controls which categories appear in the top-bar notification bell for THIS
// user. Each toggle saves immediately and is honoured by GET /notifications.
export function NotificationPrefsCard() {
  const toast = useToast();
  const [prefs, setPrefs] = useState<Prefs>({ escalations: true, inventory: true, quotes: true });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<keyof Prefs | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/me/notifications", { cache: "no-store" })
      .then(r => r.json())
      .then((data: { ok?: boolean; prefs?: Prefs }) => {
        if (cancelled) return;
        if (data.ok && data.prefs) setPrefs(data.prefs);
        setLoaded(true);
      })
      .catch(() => { if (!cancelled) setLoaded(true); });
    return () => { cancelled = true; };
  }, []);

  async function toggle(key: keyof Prefs) {
    const next = !prefs[key];
    setBusy(key);
    setPrefs(p => ({ ...p, [key]: next })); // optimistic
    try {
      const res = await fetch("/api/me/notifications", {
        method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: next }),
      });
      const data = (await res.json().catch(() => ({ ok: false }))) as { ok: boolean; prefs?: Prefs };
      if (!res.ok || !data.ok) {
        setPrefs(p => ({ ...p, [key]: !next })); // revert
        toast.push("Couldn't update notification settings", "error");
        return;
      }
      if (data.prefs) setPrefs(data.prefs);
    } catch {
      setPrefs(p => ({ ...p, [key]: !next })); // revert
      toast.push("Couldn't update notification settings", "error");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card">
      <h3 className="card-title">Notifications</h3>
      <p className="text-xs text-slate-500 mb-3 -mt-1">Choose which alerts show in your notification bell.</p>
      <div className="space-y-3">
        {ROWS.map(row => {
          const on = prefs[row.key];
          return (
            <div key={row.key} className="flex items-center justify-between">
              <span className="text-sm text-slate-700">{row.label}</span>
              <button
                onClick={() => toggle(row.key)}
                disabled={!loaded || busy === row.key}
                className={`w-10 h-5 rounded-full transition-colors flex items-center ${on ? "justify-end" : "justify-start"} ${!loaded || busy === row.key ? "opacity-60" : ""}`}
                style={{ background: on ? BRAND : "#e2e8f0", padding: "2px" }}
                aria-pressed={on}
                aria-label={`${row.label}: ${on ? "on" : "off"}`}
              >
                <span className="w-4 h-4 rounded-full bg-white shadow-sm block" />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
