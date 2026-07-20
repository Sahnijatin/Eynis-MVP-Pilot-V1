import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// #164 — full-lifecycle coverage for the extracted service-requests router: create,
// status transition (+ transition-history + attribution side effects), assign,
// transitions list, CSV export, and SLA refresh. Locks this high-risk core-spine
// extraction with behavioural assertions the e2e suite didn't fully cover.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const tid = "sr-" + uid();
const owner = `owner-${uid()}@sr.test`;
const agent = `agent-${uid()}@sr.test`;

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

let server: Server;
let base: string;
let H: Record<string, string>;
let contactId = "";

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "SR Co", timezone: "UTC" } }); // industry defaults to hospitality
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: owner, role: "owner", isActive: true } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Agent", email: agent, role: "housekeeping", isActive: true } });
  const c = await prisma.contact.create({ data: { tenantId: tid, fullName: "Guest A", phoneE164: "+9199" + uid().slice(-8) } });
  contactId = c.id;
  server = buildServer();
  base = await listen(server);
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: owner, role: "owner" }),
  });
  const { token } = await r.json() as { token: string };
  H = { authorization: "Bearer " + token, "content-type": "application/json" };
});

after(async () => {
  await close(server);
  await prisma.valueEvent.deleteMany({ where: { tenantId: tid } });
  await prisma.serviceRequestTransition.deleteMany({ where: { tenantId: tid } });
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

async function createSR(over: Record<string, unknown> = {}): Promise<string> {
  const r = await fetch(base + "/service-requests", {
    method: "POST", headers: H,
    body: JSON.stringify({ guestId: contactId, category: "housekeeping", summary: "Towels please", ...over }),
  });
  const b = await r.json() as { ok: boolean; item: { id: string } };
  assert.equal(r.status, 201, "create returns 201");
  return b.item.id;
}

test("POST /service-requests validates and creates", async () => {
  const bad = await fetch(base + "/service-requests", { method: "POST", headers: H, body: JSON.stringify({ guestId: contactId }) });
  assert.equal(bad.status, 400, "category+summary required");
  const id = await createSR();
  const row = await prisma.serviceRequest.findUnique({ where: { id }, select: { status: true, tenantId: true } });
  assert.equal(row?.status, "open");
  assert.equal(row?.tenantId, tid);
});

test("PATCH status transitions, records a transition + attribution, and blocks re-transition", async () => {
  const id = await createSR();
  const acc = await fetch(base + `/service-requests/${id}/status`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "accepted" }) });
  assert.equal(acc.status, 200);

  const res = await fetch(base + `/service-requests/${id}/status`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "resolved" }) });
  assert.equal(res.status, 200);

  // A resolved request cannot transition again.
  const again = await fetch(base + `/service-requests/${id}/status`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "accepted" }) });
  assert.equal(again.status, 409);

  // Bad status value is rejected.
  const bad = await fetch(base + `/service-requests/${id}/status`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "banana" }) });
  assert.equal(bad.status, 400);

  // Two transition rows recorded (open→accepted, accepted→resolved).
  const trans = await prisma.serviceRequestTransition.count({ where: { tenantId: tid, serviceRequestId: id } });
  assert.equal(trans, 2);

  // Attribution: the resolve wrote a ValueEvent (idempotent by source).
  const ve = await prisma.valueEvent.findFirst({ where: { tenantId: tid, sourceId: id, outcome: "resolved" } });
  assert.ok(ve, "a resolved request records a ValueEvent (#167)");
});

test("GET /service-requests/:id/transitions lists history", async () => {
  const id = await createSR();
  await fetch(base + `/service-requests/${id}/status`, { method: "PATCH", headers: H, body: JSON.stringify({ status: "accepted" }) });
  const r = await fetch(base + `/service-requests/${id}/transitions`, { headers: H });
  const b = await r.json() as { ok: boolean; items: Array<{ toStatus: string }>; page: { total: number } };
  assert.equal(r.status, 200);
  assert.equal(b.page.total, 1);
  assert.equal(b.items[0]!.toStatus, "accepted");
});

test("PATCH assign sets the assignee and 404s for unknown assignee", async () => {
  const id = await createSR();
  const ok = await fetch(base + `/service-requests/${id}/assign`, { method: "PATCH", headers: H, body: JSON.stringify({ assigneeEmail: agent }) });
  assert.equal(ok.status, 200);
  const row = await prisma.serviceRequest.findUnique({ where: { id }, select: { assignedToUserId: true } });
  assert.ok(row?.assignedToUserId, "assignee is set");

  const bad = await fetch(base + `/service-requests/${id}/assign`, { method: "PATCH", headers: H, body: JSON.stringify({ assigneeEmail: "ghost@nope.test" }) });
  assert.equal(bad.status, 404);
});

test("GET /service-requests/export returns branded CSV", async () => {
  const id = await createSR({ summary: "Export me" });
  const r = await fetch(base + "/service-requests/export?format=csv", { headers: H });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type") ?? "", /text\/csv/);
  const body = await r.text();
  assert.ok(body.includes(id), "the CSV lists the created request");
});

test("POST /service-requests/sla/refresh marks overdue open requests breached", async () => {
  await prisma.serviceRequest.create({
    data: { tenantId: tid, guestId: contactId, category: "housekeeping", summary: "overdue", priority: "high",
      source: "whatsapp", status: "open", slaDueAt: new Date(Date.now() - 60_000) },
  });
  const r = await fetch(base + "/service-requests/sla/refresh", { method: "POST", headers: H });
  const b = await r.json() as { ok: boolean; breachedMarked: number };
  assert.equal(r.status, 200);
  assert.ok(b.breachedMarked >= 1);
});

test("service-request routes require authentication", async () => {
  assert.equal((await fetch(base + "/service-requests")).status, 401);
  assert.equal((await fetch(base + "/service-requests/export?format=csv")).status, 401);
});
