// Shared JSON coercion helpers for campaign fields persisted as JSON strings.
// Previously redeclared independently in dispatch / worker / sequence-runner /
// service / followup (F-33) — centralised here so the five copies can't drift.

export function safeArray(json: string): string[] {
  try {
    const v: unknown = JSON.parse(json);
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

export function safeObject<T = unknown>(json: string): Record<string, T> {
  try {
    const v: unknown = JSON.parse(json);
    return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, T>) : {};
  } catch {
    return {};
  }
}

// A provider error string carries a 5xx → treat as a transient outage worth an
// auto-pause/backoff rather than a per-lead failure. Shared by the voice dialler
// (worker) and the messaging dispatcher (F-30).
export function isServerError(msg: string | undefined | null): boolean {
  return Boolean(msg) && /error 5\d\d/i.test(msg as string);
}
