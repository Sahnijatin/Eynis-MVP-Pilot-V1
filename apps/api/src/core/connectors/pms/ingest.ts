// Shared PMS ingest (#169) — writes a CanonicalPmsEvent to the DB, provider-
// agnostic. Used by the /connectors/pms/webhook endpoint after an adapter has
// normalized the provider payload. A check-in upserts the contact, bumps its
// visit count, creates a Stay, and broadcasts an SSE event; a check-out
// broadcasts a checkout event (no stay row is closed today — parity with the
// original webhook behaviour).

import { prisma } from "../../../db/prisma";
import { upsertContactByPhone } from "../../crm/upsert-contact";
import { broadcastSSEEvent } from "../../../sse/clients";
import type { CanonicalPmsEvent } from "./types";

export interface PmsIngestResult {
  event: "checkin" | "checkout" | "ignored";
  guestId: string;
  stayId?: string;
}

// A phone is optional in some provider payloads; synthesize a stable-enough
// placeholder so the contact upsert (keyed on phone) still works, matching the
// original webhook's behaviour.
function ensurePhone(phone: string | null): string {
  return phone ?? `+9199${Math.floor(Math.random() * 90000000) + 10000000}`;
}

export async function ingestPmsEvent(tenantId: string, ev: CanonicalPmsEvent): Promise<PmsIngestResult> {
  const guestPhone = ensurePhone(ev.guest.phone);
  const guestId = await upsertContactByPhone(tenantId, ev.guest.name, guestPhone);

  if (ev.type === "checkin") {
    await prisma.contact.update({ where: { id: guestId }, data: { visitCount: { increment: 1 } } });
    const stay = await prisma.stay.create({
      data: { tenantId, guestId, roomNumber: ev.roomNumber, checkInAt: ev.checkInAt, checkOutAt: ev.checkOutAt ?? new Date(ev.checkInAt.getTime() + 2 * 24 * 60 * 60 * 1000) },
    });
    broadcastSSEEvent(tenantId, {
      type: "checkin_event",
      data: { stayId: stay.id, guestId, guestName: ev.guest.name, roomNumber: ev.roomNumber, checkInAt: ev.checkInAt },
    });
    return { event: "checkin", guestId, stayId: stay.id };
  }

  if (ev.type === "checkout") {
    broadcastSSEEvent(tenantId, {
      type: "checkout_event",
      data: { guestId, guestName: ev.guest.name, roomNumber: ev.roomNumber, checkOutAt: ev.checkOutAt },
    });
    return { event: "checkout", guestId };
  }

  return { event: "ignored", guestId };
}
