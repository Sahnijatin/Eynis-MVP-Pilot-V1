// Bookings domain router (Wave 5) — travel bookings with real persistence.
// Returns true when the request was handled. Auth goes through the shared
// authorize()/permissionMap contract like every other route.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "../authz";
import { prisma } from "../../db/prisma";
import { json, parseObjectBody, asTrimmedString, parseUrl } from "../../http/helpers";

const STATUSES = ["in_progress", "confirmed", "pending_visa", "urgent", "completed", "cancelled"];

type BookingRow = {
  id: string; number: string; clientName: string; destination: string;
  departureDate: Date | null; pax: number; status: string;
  valuePaise: number; paidPaise: number; notes: string | null;
};

const serialize = (b: BookingRow) => ({
  id: b.id, number: b.number, clientName: b.clientName, destination: b.destination,
  departureDate: b.departureDate ? b.departureDate.toISOString() : null,
  pax: b.pax, status: b.status, notes: b.notes,
  valuePaise: b.valuePaise, valueInr: b.valuePaise / 100,
  paidPaise: b.paidPaise, paidInr: b.paidPaise / 100,
  paidPct: b.valuePaise > 0 ? Math.round((b.paidPaise / b.valuePaise) * 100) : 0,
});

const SELECT = { id: true, number: true, clientName: true, destination: true, departureDate: true, pax: true, status: true, valuePaise: true, paidPaise: true, notes: true };

const toPaise = (paise: unknown, inr: unknown): number | undefined => {
  if (paise != null && Number.isFinite(Number(paise))) return Math.max(0, Math.round(Number(paise)));
  if (inr != null && Number.isFinite(Number(inr))) return Math.max(0, Math.round(Number(inr) * 100));
  return undefined;
};

const parseStatus = (v: unknown): string | undefined => {
  const s = asTrimmedString(v);
  return s && STATUSES.includes(s) ? s : undefined;
};

const parseDate = (v: unknown): Date | null | undefined => {
  if (v === null) return null;
  const s = asTrimmedString(v);
  if (!s) return undefined;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

export async function handleBookingRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/bookings" || routePath.startsWith("/bookings/"))) return false;

  // GET /bookings — the tenant's bookings, soonest departures first.
  if (req.url === "/bookings" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /bookings");
    if (!auth.ok) return true;
    const items = await prisma.booking.findMany({
      where: { tenantId: auth.context.tenantId },
      orderBy: [{ departureDate: "asc" }, { createdAt: "desc" }],
      select: SELECT,
    });
    json(res, 200, { ok: true, items: items.map(serialize) });
    return true;
  }

  // POST /bookings — create a booking (generates a display reference).
  if (req.url === "/bookings" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /bookings");
    if (!auth.ok) return true;
    const body = await parseObjectBody(req);
    const clientName = asTrimmedString(body.clientName);
    if (!clientName) { json(res, 400, { ok: false, error: "clientName is required" }); return true; }
    const count = await prisma.booking.count({ where: { tenantId: auth.context.tenantId } });
    const dep = parseDate(body.departureDate);
    const item = await prisma.booking.create({
      data: {
        tenantId: auth.context.tenantId,
        number: `BKG-${1001 + count}`,
        clientName,
        destination: asTrimmedString(body.destination) ?? "",
        departureDate: dep ?? null,
        pax: Number.isFinite(Number(body.pax)) ? Math.max(1, Math.round(Number(body.pax))) : 1,
        status: parseStatus(body.status) ?? "in_progress",
        valuePaise: toPaise(body.valuePaise, body.valueInr) ?? 0,
        paidPaise: toPaise(body.paidPaise, body.paidInr) ?? 0,
        notes: asTrimmedString(body.notes),
      },
      select: SELECT,
    });
    json(res, 200, { ok: true, item: serialize(item) });
    return true;
  }

  const itemMatch = /^\/bookings\/([^/]+)$/.exec(routePath);

  // PATCH /bookings/:id
  if (itemMatch && req.method === "PATCH") {
    const auth = await authorize(req, res, "PATCH /bookings/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.booking.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Booking not found" }); return true; }
    const body = await parseObjectBody(req);
    const data: Record<string, unknown> = {};
    if (body.clientName !== undefined) { const n = asTrimmedString(body.clientName); if (!n) { json(res, 400, { ok: false, error: "clientName cannot be empty" }); return true; } data.clientName = n; }
    if (body.destination !== undefined) data.destination = asTrimmedString(body.destination) ?? "";
    if (body.notes !== undefined) data.notes = asTrimmedString(body.notes);
    if (body.pax !== undefined && Number.isFinite(Number(body.pax))) data.pax = Math.max(1, Math.round(Number(body.pax)));
    if (body.status !== undefined) { const s = parseStatus(body.status); if (!s) { json(res, 400, { ok: false, error: `status must be one of: ${STATUSES.join(", ")}` }); return true; } data.status = s; }
    if (body.departureDate !== undefined) { const d = parseDate(body.departureDate); if (d === undefined) { json(res, 400, { ok: false, error: "departureDate is invalid" }); return true; } data.departureDate = d; }
    const v = toPaise(body.valuePaise, body.valueInr); if (v !== undefined) data.valuePaise = v;
    const p = toPaise(body.paidPaise, body.paidInr); if (p !== undefined) data.paidPaise = p;
    const item = await prisma.booking.update({ where: { id }, data, select: SELECT });
    json(res, 200, { ok: true, item: serialize(item) });
    return true;
  }

  // DELETE /bookings/:id
  if (itemMatch && req.method === "DELETE") {
    const auth = await authorize(req, res, "DELETE /bookings/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.booking.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Booking not found" }); return true; }
    await prisma.booking.delete({ where: { id } });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
