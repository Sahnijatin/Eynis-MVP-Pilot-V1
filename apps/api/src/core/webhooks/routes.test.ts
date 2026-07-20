import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// #164 — coverage for the extracted public-webhook router: the Vapi webhook, and
// the PMS simulate/webhook check-in paths. (/public/requests, /webhooks/resend and
// /events/service-request-created are covered by server.test.ts.)

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const tid = "wh-" + uid();
const owner = `owner-${uid()}@wh.test`;

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

let server: Server;
let base: string;
let H: Record<string, string>;

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "WH Co", timezone: "UTC" } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: owner, role: "owner", isActive: true } });
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
  await prisma.stay.deleteMany({ where: { tenantId: tid } });
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("POST /webhooks/vapi rejects invalid JSON", async () => {
  const r = await fetch(base + "/webhooks/vapi", { method: "POST", headers: { "content-type": "application/json" }, body: "{not json" });
  assert.equal(r.status, 400);
});

test("POST /webhooks/vapi processes an unrecognised payload without error", async () => {
  // An 'ignore'-kind message skips the tenant secret lookup; dev has no enforced
  // secret, so it is accepted and processed to a no-op result.
  const r = await fetch(base + "/webhooks/vapi", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ message: { type: "status-update" } }) });
  assert.equal(r.status, 200);
  const b = await r.json() as { ok: boolean };
  assert.equal(b.ok, true);
});

test("POST /connectors/pms/webhook creates a check-in (dev: no secret required)", async () => {
  const r = await fetch(base + "/connectors/pms/webhook", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, event: "guest.checkin", guest: { name: "PMS Alice", phone: "+919812340000" }, reservation: { roomNumber: "204" } }),
  });
  const b = await r.json() as { ok: boolean; event: string; stayId: string };
  assert.equal(r.status, 201);
  assert.equal(b.event, "checkin");
  const stay = await prisma.stay.findUnique({ where: { id: b.stayId }, select: { roomNumber: true, tenantId: true } });
  assert.equal(stay?.roomNumber, "204");
  assert.equal(stay?.tenantId, tid);
});

test("POST /connectors/pms/webhook requires tenantId and a known tenant", async () => {
  const noTid = await fetch(base + "/connectors/pms/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event: "guest.checkin" }) });
  assert.equal(noTid.status, 400);
  const badTid = await fetch(base + "/connectors/pms/webhook", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId: "nope-" + uid(), event: "guest.checkin" }) });
  assert.equal(badTid.status, 404);
});

test("POST /connectors/pms/simulate fabricates a stay for the authed tenant", async () => {
  const r = await fetch(base + "/connectors/pms/simulate", { method: "POST", headers: H, body: JSON.stringify({ guestName: "Sim Guy", roomNumber: "301" }) });
  const b = await r.json() as { ok: boolean; stay: { id: string; roomNumber: string } };
  assert.equal(r.status, 201);
  assert.equal(b.stay.roomNumber, "301");
  const unauth = await fetch(base + "/connectors/pms/simulate", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
  assert.equal(unauth.status, 401);
});
