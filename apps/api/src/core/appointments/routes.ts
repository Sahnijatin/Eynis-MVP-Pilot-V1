// Appointments domain router (Wave 5) — healthcare scheduling.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "../authz";
import { prisma } from "../../db/prisma";
import { json, parseObjectBody, asTrimmedString, parseUrl } from "../../http/helpers";

const STATUSES = ["scheduled", "checked_in", "waiting", "in_progress", "completed", "no_show", "cancelled"];

type ApptRow = {
  id: string; patientId: string | null; patientName: string; provider: string;
  type: string | null; scheduledAt: Date; durationMin: number; status: string; notes: string | null;
};

const serialize = (a: ApptRow) => ({
  id: a.id, patientId: a.patientId, patientName: a.patientName, provider: a.provider,
  type: a.type, scheduledAt: a.scheduledAt.toISOString(), durationMin: a.durationMin,
  status: a.status, notes: a.notes,
});

const SELECT = { id: true, patientId: true, patientName: true, provider: true, type: true, scheduledAt: true, durationMin: true, status: true, notes: true };

const parseStatus = (v: unknown): string | undefined => { const s = asTrimmedString(v); return s && STATUSES.includes(s) ? s : undefined; };
const parseDate = (v: unknown): Date | undefined => {
  const s = asTrimmedString(v); if (!s) return undefined;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? undefined : d;
};

export async function handleAppointmentRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/appointments" || routePath.startsWith("/appointments/"))) return false;

  // GET /appointments[?date=YYYY-MM-DD] — all, or a single day's schedule.
  if (routePath === "/appointments" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /appointments");
    if (!auth.ok) return true;
    const dateStr = parseUrl(req.url).searchParams.get("date");
    let where: Record<string, unknown> = { tenantId: auth.context.tenantId };
    if (dateStr) {
      const start = new Date(dateStr + "T00:00:00");
      if (!Number.isNaN(start.getTime())) {
        const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
        where = { ...where, scheduledAt: { gte: start, lt: end } };
      }
    }
    const items = await prisma.appointment.findMany({ where, orderBy: { scheduledAt: "asc" }, select: SELECT });
    json(res, 200, { ok: true, items: items.map(serialize) });
    return true;
  }

  if (routePath === "/appointments" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /appointments");
    if (!auth.ok) return true;
    const body = await parseObjectBody(req);
    const patientName = asTrimmedString(body.patientName);
    if (!patientName) { json(res, 400, { ok: false, error: "patientName is required" }); return true; }
    const scheduledAt = parseDate(body.scheduledAt);
    if (!scheduledAt) { json(res, 400, { ok: false, error: "scheduledAt (date-time) is required" }); return true; }
    // Verify an explicit patientId belongs to this tenant.
    let patientId: string | null = null;
    const pid = asTrimmedString(body.patientId);
    if (pid) {
      const p = await prisma.patient.findFirst({ where: { id: pid, tenantId: auth.context.tenantId }, select: { id: true } });
      if (!p) { json(res, 400, { ok: false, error: "patientId not found" }); return true; }
      patientId = pid;
    }
    const item = await prisma.appointment.create({
      data: {
        tenantId: auth.context.tenantId, patientId, patientName,
        provider: asTrimmedString(body.provider) ?? "", type: asTrimmedString(body.type),
        scheduledAt, durationMin: Number.isFinite(Number(body.durationMin)) ? Math.max(5, Math.round(Number(body.durationMin))) : 30,
        status: parseStatus(body.status) ?? "scheduled", notes: asTrimmedString(body.notes),
      },
      select: SELECT,
    });
    json(res, 200, { ok: true, item: serialize(item) });
    return true;
  }

  const itemMatch = /^\/appointments\/([^/]+)$/.exec(routePath);
  if (itemMatch && req.method === "PATCH") {
    const auth = await authorize(req, res, "PATCH /appointments/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.appointment.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Appointment not found" }); return true; }
    const body = await parseObjectBody(req);
    const data: Record<string, unknown> = {};
    if (body.patientName !== undefined) { const n = asTrimmedString(body.patientName); if (!n) { json(res, 400, { ok: false, error: "patientName cannot be empty" }); return true; } data.patientName = n; }
    if (body.provider !== undefined) data.provider = asTrimmedString(body.provider) ?? "";
    if (body.type !== undefined) data.type = asTrimmedString(body.type);
    if (body.notes !== undefined) data.notes = asTrimmedString(body.notes);
    if (body.durationMin !== undefined && Number.isFinite(Number(body.durationMin))) data.durationMin = Math.max(5, Math.round(Number(body.durationMin)));
    if (body.status !== undefined) { const s = parseStatus(body.status); if (!s) { json(res, 400, { ok: false, error: `status must be one of: ${STATUSES.join(", ")}` }); return true; } data.status = s; }
    if (body.scheduledAt !== undefined) { const d = parseDate(body.scheduledAt); if (!d) { json(res, 400, { ok: false, error: "scheduledAt is invalid" }); return true; } data.scheduledAt = d; }
    const item = await prisma.appointment.update({ where: { id }, data, select: SELECT });
    json(res, 200, { ok: true, item: serialize(item) });
    return true;
  }

  if (itemMatch && req.method === "DELETE") {
    const auth = await authorize(req, res, "DELETE /appointments/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.appointment.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Appointment not found" }); return true; }
    await prisma.appointment.delete({ where: { id } });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
