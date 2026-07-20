import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// #164 — coverage for the extracted connector-messaging router: the unified ingest
// endpoint, the connector event log, and the outbound-send guardrails. (The inbound
// WhatsApp webhook happy-path is covered by server.test.ts.)

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const tid = "cm-" + uid();
const owner = `owner-${uid()}@cm.test`;

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
  await prisma.tenant.create({ data: { id: tid, name: "CM Co", timezone: "UTC" } });
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
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.connectorEvent.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("POST /connectors/events/ingest validates and ingests a message", async () => {
  const bad = await fetch(base + "/connectors/events/ingest", { method: "POST", headers: H, body: JSON.stringify({ connectorKey: "whatsapp_twilio" }) });
  assert.equal(bad.status, 400, "connectorKey + messageText required");

  const r = await fetch(base + "/connectors/events/ingest", {
    method: "POST", headers: H,
    body: JSON.stringify({ connectorKey: "whatsapp_twilio", guestPhone: "+919812345678", guestName: "Ingest Guy", messageText: "AC is broken", sendReply: false }),
  });
  const b = await r.json() as { ok: boolean; connectorEventId: string; serviceRequestId: string | null };
  assert.equal(r.status, 201);
  assert.ok(b.connectorEventId, "returns the connector event id");
  const ev = await prisma.connectorEvent.findUnique({ where: { id: b.connectorEventId }, select: { tenantId: true, connectorKey: true } });
  assert.equal(ev?.tenantId, tid);
  assert.equal(ev?.connectorKey, "whatsapp_twilio");
});

test("GET /connectors/events lists the tenant's events with pagination", async () => {
  const r = await fetch(base + "/connectors/events?limit=10", { headers: H });
  const b = await r.json() as { ok: boolean; items: Array<{ connectorKey: string }>; page: { total: number } };
  assert.equal(r.status, 200);
  assert.ok(b.page.total >= 1);
  assert.ok(b.items.some((i) => i.connectorKey === "whatsapp_twilio"));
});

test("GET /connectors/events?connectorKey filters", async () => {
  const r = await fetch(base + "/connectors/events?connectorKey=nonexistent_key", { headers: H });
  const b = await r.json() as { ok: boolean; page: { total: number } };
  assert.equal(r.status, 200);
  assert.equal(b.page.total, 0);
});

test("POST /connectors/whatsapp/send validates its body", async () => {
  const r = await fetch(base + "/connectors/whatsapp/send", { method: "POST", headers: H, body: JSON.stringify({ toPhone: "+919812345678" }) });
  assert.equal(r.status, 400, "toPhone + message required");
});

test("connector-messaging routes require authentication", async () => {
  assert.equal((await fetch(base + "/connectors/events")).status, 401);
  assert.equal((await fetch(base + "/connectors/events/ingest", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
  assert.equal((await fetch(base + "/connectors/whatsapp/send", { method: "POST", headers: { "content-type": "application/json" }, body: "{}" })).status, 401);
});
