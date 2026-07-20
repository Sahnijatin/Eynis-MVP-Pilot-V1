// PMS provider adapters (#169). Each maps a provider's webhook payload into a
// CanonicalPmsEvent. The eZee/Hotelogix field mappings follow those vendors'
// published reservation-API field shapes and are intentionally defensive
// (multi-key, case-insensitive) so minor API-version differences don't break
// ingestion — they should still be validated against a live sandbox account
// before a production pilot (that's the one thing this repo can't do without
// vendor credentials).

import {
  type PmsAdapter, type CanonicalPmsEvent,
  lowerKeyMap, pickString, pickDate, classifyEvent,
} from "./types";

const DEFAULT_STAY_MS = 2 * 24 * 60 * 60 * 1000;

// Assemble a canonical event from already-extracted fields, applying the shared
// fallbacks (a check-in with no arrival time = now; check-out defaults 2 days out).
function build(
  type: CanonicalPmsEvent["type"],
  name: string | null,
  phone: string | null,
  roomNumber: string | null,
  checkIn: Date | null,
  checkOut: Date | null,
  confirmationId: string | null,
  sourceEvent: string | null,
): CanonicalPmsEvent {
  const checkInAt = checkIn ?? new Date();
  return {
    type,
    guest: { name: name ?? "PMS Guest", phone },
    roomNumber: roomNumber ?? "—",
    checkInAt,
    checkOutAt: checkOut ?? new Date(checkInAt.getTime() + DEFAULT_STAY_MS),
    confirmationId,
    sourceEvent,
  };
}

// ── Generic adapter — the pre-existing { event, guest:{name,phone}, reservation }
// shape. Kept so existing integrations and the demo webhook keep working. ───────
export const genericAdapter: PmsAdapter = {
  provider: "generic",
  normalize(raw) {
    const map = lowerKeyMap(raw);
    const guest = (map.get("guest") ?? {}) as Record<string, unknown>;
    const reservation = (map.get("reservation") ?? {}) as Record<string, unknown>;
    const gm = lowerKeyMap(guest);
    const rm = lowerKeyMap(reservation);
    const sourceEvent = pickString(map, "event", "eventType", "status");
    // Legacy default: a payload with no explicit event is treated as a check-in.
    const type = sourceEvent ? classifyEvent(sourceEvent.replace(/^guest\./, "")) : "checkin";
    return build(
      type,
      pickString(gm, "name", "fullName"),
      pickString(gm, "phone", "mobile"),
      pickString(rm, "roomNumber", "roomNo", "room"),
      pickDate(rm, "checkIn", "checkInAt", "arrival"),
      pickDate(rm, "checkOut", "checkOutAt", "departure"),
      pickString(rm, "confirmationId", "reservationId", "bookingId"),
      sourceEvent,
    );
  },
};

// ── eZee (eZee Absolute / eZee Reservation) ────────────────────────────────────
// Flat payload; names split across First/Last; dates as Arrival/Departure.
export const ezeeAdapter: PmsAdapter = {
  provider: "ezee",
  normalize(raw) {
    const m = lowerKeyMap(raw);
    const first = pickString(m, "firstname", "first_name", "fname");
    const last = pickString(m, "lastname", "last_name", "lname");
    const name = pickString(m, "guestname", "name") ?? ([first, last].filter(Boolean).join(" ").trim() || null);
    const status = pickString(m, "status", "bookingstatus", "reservationstatus", "event");
    return build(
      classifyEvent(status),
      name,
      pickString(m, "mobile", "mobileno", "phone", "contact", "contactno"),
      pickString(m, "roomno", "roomname", "room", "roomnumber"),
      pickDate(m, "arrivaldate", "arrival", "checkindate", "checkin"),
      pickDate(m, "departuredate", "departure", "checkoutdate", "checkout"),
      pickString(m, "reservationno", "bookingid", "bookingno", "confirmationno"),
      status,
    );
  },
};

// ── Hotelogix (PMS API) ────────────────────────────────────────────────────────
// camelCase payload; explicit check-in/out dates; CHECK_IN/CHECK_OUT statuses.
export const hotelogixAdapter: PmsAdapter = {
  provider: "hotelogix",
  normalize(raw) {
    const m = lowerKeyMap(raw);
    const first = pickString(m, "firstname", "fname");
    const last = pickString(m, "lastname", "lname");
    const name = pickString(m, "guestname", "name") ?? ([first, last].filter(Boolean).join(" ").trim() || null);
    const status = pickString(m, "eventtype", "status", "bookingstatus", "reservationstatus");
    return build(
      classifyEvent(status),
      name,
      pickString(m, "mobile", "phone", "contactno", "mobileno"),
      pickString(m, "roomno", "roomnumber", "room"),
      pickDate(m, "arrivaldate", "checkindate", "checkin", "arrival"),
      pickDate(m, "departuredate", "checkoutdate", "checkout", "departure"),
      pickString(m, "reservationid", "bookingid", "folioid", "confirmationno"),
      status,
    );
  },
};

const ADAPTERS: Record<string, PmsAdapter> = {
  generic: genericAdapter,
  ezee: ezeeAdapter,
  hotelogix: hotelogixAdapter,
};

// Resolve an adapter from a `?provider=` value or a connector key like
// "pms_ezee" / "pms_hotelogix". Unknown / absent → the generic adapter, so a
// plain payload (and the existing demo/webhook) keeps working.
export function selectPmsAdapter(providerOrKey: string | null | undefined): PmsAdapter {
  if (!providerOrKey) return genericAdapter;
  const p = providerOrKey.toLowerCase().replace(/^pms_/, "").trim();
  return ADAPTERS[p] ?? genericAdapter;
}

export const PMS_PROVIDERS = Object.keys(ADAPTERS);
