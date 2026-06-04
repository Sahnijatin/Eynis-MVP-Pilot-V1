// Campaign send-window / quiet-hours scheduling (Tier-1 improvement).
//
// Pure, dependency-free so the time logic is unit-testable. Decides whether a
// campaign may contact leads *right now*, honouring:
//   • scheduledStartAt — don't start before this instant
//   • a daily send window [startMin, endMin) in the campaign's local timezone
//     (supports overnight windows where start > end)
//   • allowed weekdays (0=Sun … 6=Sat); empty = every day
// This enforces compliance quiet-hours (TRAI 9–9, TCPA 8am–9pm) and lets
// operators schedule campaigns ahead of time.

export interface SendSchedule {
  scheduledStartAt?: Date | null;
  windowStartMin?: number | null;
  windowEndMin?: number | null;
  days?: number[]; // allowed weekdays; empty/undefined = all
  timeZone: string; // IANA, e.g. "Asia/Kolkata"
}

export type ScheduleReason = "not_started" | "off_day" | "outside_window";
export interface ScheduleDecision { ok: boolean; reason?: ScheduleReason }

// Local weekday (0=Sun) + minute-of-day for an instant in a given IANA zone,
// computed via Intl so no tz database dependency is needed.
export function localParts(now: Date, timeZone: string): { weekday: number; minuteOfDay: number } {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone, hourCycle: "h23", weekday: "short", hour: "2-digit", minute: "2-digit",
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const WD: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const weekday = WD[get("weekday")] ?? 0;
  const hour = Number(get("hour"));
  const minute = Number(get("minute"));
  return { weekday, minuteOfDay: hour * 60 + minute };
}

export function isWithinSendWindow(now: Date, s: SendSchedule): ScheduleDecision {
  if (s.scheduledStartAt && now.getTime() < s.scheduledStartAt.getTime()) {
    return { ok: false, reason: "not_started" };
  }

  const hasWindow = s.windowStartMin != null && s.windowEndMin != null && s.windowStartMin !== s.windowEndMin;
  const days = s.days ?? [];
  if (!hasWindow && days.length === 0) return { ok: true }; // nothing constrains the time of day

  const { weekday, minuteOfDay } = localParts(now, s.timeZone);

  if (days.length > 0 && !days.includes(weekday)) return { ok: false, reason: "off_day" };

  if (hasWindow) {
    const start = s.windowStartMin as number;
    const end = s.windowEndMin as number;
    const inside = start < end
      ? minuteOfDay >= start && minuteOfDay < end       // same-day window
      : minuteOfDay >= start || minuteOfDay < end;       // overnight window (wraps midnight)
    if (!inside) return { ok: false, reason: "outside_window" };
  }
  return { ok: true };
}

// Parse the JSON-stored allowed-weekday list into a clean int[] (0–6, deduped).
export function parseSendDays(raw: unknown): number[] {
  let arr: unknown = raw;
  if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.map(Number).filter((n) => Number.isInteger(n) && n >= 0 && n <= 6)));
}

// Validate a minute-of-day value (0–1439) or return null.
export function asMinuteOfDay(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 1439) return null;
  return v;
}
