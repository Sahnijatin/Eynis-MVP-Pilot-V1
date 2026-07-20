// PMS connector framework (#169) — canonical event shape + per-provider adapter
// contract. Real PMS products (eZee, Hotelogix, …) each POST their own webhook
// payload shape; an adapter normalizes that provider payload into one canonical
// check-in / check-out event that the shared ingest path writes to the DB.
//
// This replaces the simulate-only integration: the webhook endpoint selects the
// adapter by connector key / `?provider=` and every provider funnels through the
// same normalize → ingest pipeline.

export type PmsEventType = "checkin" | "checkout" | "other";

/** A provider-agnostic check-in/out event, ready for the shared ingest path. */
export interface CanonicalPmsEvent {
  type: PmsEventType;
  guest: { name: string; phone: string | null };
  roomNumber: string;
  checkInAt: Date;
  checkOutAt: Date | null;
  confirmationId: string | null;
  /** The provider's original event/status label, kept for the audit trail. */
  sourceEvent: string | null;
}

export interface PmsAdapter {
  /** Stable provider id, also the `?provider=` value and connector-key suffix. */
  provider: string;
  /**
   * Map a raw provider webhook payload into a canonical event. Returns null when
   * the payload isn't a reservation event this adapter recognises (so the caller
   * can 400/no-op rather than fabricate a stay).
   */
  normalize(raw: Record<string, unknown>): CanonicalPmsEvent | null;
}

// ── Shared, defensive payload helpers ────────────────────────────────────────
// Provider payloads vary in casing and field naming even across a single vendor's
// API versions, so adapters read fields through these case-insensitive, multi-key
// helpers rather than hard-coding one exact key.

/** Build a lower-cased key map once so lookups are O(1) and case-insensitive. */
export function lowerKeyMap(obj: Record<string, unknown>): Map<string, unknown> {
  const m = new Map<string, unknown>();
  for (const [k, v] of Object.entries(obj)) m.set(k.toLowerCase(), v);
  return m;
}

/** First non-empty string found among the candidate keys (case-insensitive). */
export function pickString(map: Map<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const v = map.get(k.toLowerCase());
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return null;
}

/** Parse a date from the candidate keys; returns null when absent/invalid. */
export function pickDate(map: Map<string, unknown>, ...keys: string[]): Date | null {
  const s = pickString(map, ...keys);
  if (!s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Classify a provider status/event label into a canonical event type. Recognises
 * the common check-in / check-out spellings across eZee/Hotelogix-style APIs.
 */
export function classifyEvent(label: string | null): PmsEventType {
  if (!label) return "other";
  const s = label.toLowerCase().replace(/[\s_-]/g, "");
  if (["checkin", "checkedin", "arrival", "arrived", "guestcheckin", "inhouse"].includes(s)) return "checkin";
  if (["checkout", "checkedout", "departure", "departed", "guestcheckout"].includes(s)) return "checkout";
  return "other";
}
