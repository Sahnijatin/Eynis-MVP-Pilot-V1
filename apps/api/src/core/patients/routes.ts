// Patients domain router (Wave 5) — healthcare patient records.
import type { IncomingMessage, ServerResponse } from "node:http";
import { authorize } from "../authz";
import { prisma } from "../../db/prisma";
import { json, parseObjectBody, asTrimmedString, parseUrl } from "../../http/helpers";

const STATUSES = ["active", "due", "overdue", "lost_follow_up"];

type PatientRow = {
  id: string; name: string; phone: string | null; email: string | null;
  dateOfBirth: Date | null; condition: string | null; bloodGroup: string | null;
  insurance: string | null; status: string; notes: string | null;
};

const ageFrom = (dob: Date | null): number | null => {
  if (!dob) return null;
  const now = new Date();
  let age = now.getFullYear() - dob.getFullYear();
  const m = now.getMonth() - dob.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < dob.getDate())) age--;
  return age >= 0 && age < 200 ? age : null;
};

const serialize = (p: PatientRow) => ({
  id: p.id, name: p.name, phone: p.phone, email: p.email,
  dateOfBirth: p.dateOfBirth ? p.dateOfBirth.toISOString() : null,
  age: ageFrom(p.dateOfBirth),
  condition: p.condition, bloodGroup: p.bloodGroup, insurance: p.insurance,
  status: p.status, notes: p.notes,
});

const SELECT = { id: true, name: true, phone: true, email: true, dateOfBirth: true, condition: true, bloodGroup: true, insurance: true, status: true, notes: true };

const parseStatus = (v: unknown): string | undefined => { const s = asTrimmedString(v); return s && STATUSES.includes(s) ? s : undefined; };
const parseDate = (v: unknown): Date | null | undefined => {
  if (v === null) return null;
  const s = asTrimmedString(v); if (!s) return undefined;
  const d = new Date(s); return Number.isNaN(d.getTime()) ? undefined : d;
};

export async function handlePatientRoutes(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const routePath = parseUrl(req.url).pathname;
  if (!(routePath === "/patients" || routePath.startsWith("/patients/"))) return false;

  if (req.url === "/patients" && req.method === "GET") {
    const auth = await authorize(req, res, "GET /patients");
    if (!auth.ok) return true;
    const items = await prisma.patient.findMany({ where: { tenantId: auth.context.tenantId }, orderBy: { name: "asc" }, select: SELECT });
    json(res, 200, { ok: true, items: items.map(serialize) });
    return true;
  }

  if (req.url === "/patients" && req.method === "POST") {
    const auth = await authorize(req, res, "POST /patients");
    if (!auth.ok) return true;
    const body = await parseObjectBody(req);
    const name = asTrimmedString(body.name);
    if (!name) { json(res, 400, { ok: false, error: "name is required" }); return true; }
    const dob = parseDate(body.dateOfBirth);
    const item = await prisma.patient.create({
      data: {
        tenantId: auth.context.tenantId, name,
        phone: asTrimmedString(body.phone), email: asTrimmedString(body.email),
        dateOfBirth: dob ?? null, condition: asTrimmedString(body.condition),
        bloodGroup: asTrimmedString(body.bloodGroup), insurance: asTrimmedString(body.insurance),
        status: parseStatus(body.status) ?? "active", notes: asTrimmedString(body.notes),
      },
      select: SELECT,
    });
    json(res, 200, { ok: true, item: serialize(item) });
    return true;
  }

  const itemMatch = /^\/patients\/([^/]+)$/.exec(routePath);
  if (itemMatch && req.method === "PATCH") {
    const auth = await authorize(req, res, "PATCH /patients/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.patient.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Patient not found" }); return true; }
    const body = await parseObjectBody(req);
    const data: Record<string, unknown> = {};
    if (body.name !== undefined) { const n = asTrimmedString(body.name); if (!n) { json(res, 400, { ok: false, error: "name cannot be empty" }); return true; } data.name = n; }
    if (body.phone !== undefined) data.phone = asTrimmedString(body.phone);
    if (body.email !== undefined) data.email = asTrimmedString(body.email);
    if (body.condition !== undefined) data.condition = asTrimmedString(body.condition);
    if (body.bloodGroup !== undefined) data.bloodGroup = asTrimmedString(body.bloodGroup);
    if (body.insurance !== undefined) data.insurance = asTrimmedString(body.insurance);
    if (body.notes !== undefined) data.notes = asTrimmedString(body.notes);
    if (body.status !== undefined) { const s = parseStatus(body.status); if (!s) { json(res, 400, { ok: false, error: `status must be one of: ${STATUSES.join(", ")}` }); return true; } data.status = s; }
    if (body.dateOfBirth !== undefined) { const d = parseDate(body.dateOfBirth); if (d === undefined) { json(res, 400, { ok: false, error: "dateOfBirth is invalid" }); return true; } data.dateOfBirth = d; }
    const item = await prisma.patient.update({ where: { id }, data, select: SELECT });
    json(res, 200, { ok: true, item: serialize(item) });
    return true;
  }

  if (itemMatch && req.method === "DELETE") {
    const auth = await authorize(req, res, "DELETE /patients/:id");
    if (!auth.ok) return true;
    const id = decodeURIComponent(itemMatch[1] as string);
    const existing = await prisma.patient.findFirst({ where: { id, tenantId: auth.context.tenantId }, select: { id: true } });
    if (!existing) { json(res, 404, { ok: false, error: "Patient not found" }); return true; }
    await prisma.patient.delete({ where: { id } });
    json(res, 200, { ok: true });
    return true;
  }

  return false;
}
