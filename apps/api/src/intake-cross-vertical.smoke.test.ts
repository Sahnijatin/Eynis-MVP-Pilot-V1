import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

// #162 — end-to-end: a non-WhatsApp tenant produces real signal via webhook / email
// / CSV, each becoming a classified ServiceRequest through the existing pipeline.

const tid = "intake-xv-" + Date.now();
const email = "owner@intake.test";
let base = "";
let server: ReturnType<typeof buildServer>;
const prevSecret = process.env.INTAKE_WEBHOOK_SECRET;

before(async () => {
  process.env.INTAKE_WEBHOOK_SECRET = "s3cr3t";
  await prisma.tenant.create({ data: { id: tid, name: "Intake Plant", timezone: "Asia/Kolkata", industry: "manufacturing" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email, role: "owner", isActive: true } });
  server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  if (prevSecret === undefined) delete process.env.INTAKE_WEBHOOK_SECRET;
  else process.env.INTAKE_WEBHOOK_SECRET = prevSecret;
  await new Promise<void>((r) => server.close(() => r()));
  await prisma.serviceRequest.deleteMany({ where: { tenantId: tid } });
  await prisma.connectorEvent.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

async function token(): Promise<string> {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email, role: "owner" }),
  });
  return ((await r.json()) as { token: string }).token;
}

test("webhook door rejects a wrong/missing secret", async () => {
  const r = await fetch(base + "/connectors/intake/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "wrong" },
    body: JSON.stringify({ tenantId: tid, message: "conveyor down" }),
  });
  assert.equal(r.status, 401);
});

test("webhook door answers 400 (not 500) on malformed JSON", async () => {
  const r = await fetch(base + "/connectors/intake/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "s3cr3t" },
    body: "{not valid json",
  });
  assert.equal(r.status, 400);
});

test("webhook door creates a ServiceRequest from a signal", async () => {
  const r = await fetch(base + "/connectors/intake/webhook", {
    method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "s3cr3t" },
    body: JSON.stringify({ tenantId: tid, message: "Line 3 conveyor motor overheating", contact: { externalId: "line-3", name: "Line 3" } }),
  });
  assert.equal(r.status, 202);
  const p = (await r.json()) as { ok: boolean; serviceRequestId: string | null };
  assert.equal(p.ok, true);
  assert.ok(p.serviceRequestId, "a service request was created");

  const sr = await prisma.serviceRequest.findUnique({ where: { id: p.serviceRequestId! }, select: { source: true } });
  assert.equal(sr?.source, "webhook");
  // Subject deduped by external id, keyed out of the real-phone space.
  const contact = await prisma.contact.findFirst({ where: { tenantId: tid, phoneE164: "ext:webhook:line-3" }, select: { fullName: true } });
  assert.equal(contact?.fullName, "Line 3");
});

test("email door creates a ServiceRequest keyed by sender", async () => {
  const r = await fetch(base + "/connectors/intake/email", {
    method: "POST", headers: { "content-type": "application/json", "x-webhook-secret": "s3cr3t" },
    body: JSON.stringify({ tenantId: tid, from: "employee@corp.com", subject: "Laptop won't boot", text: "Blue screen since morning" }),
  });
  assert.equal(r.status, 202);
  const p = (await r.json()) as { serviceRequestId: string | null };
  assert.ok(p.serviceRequestId);
  const contact = await prisma.contact.findFirst({ where: { tenantId: tid, phoneE164: "email:employee@corp.com" } });
  assert.ok(contact, "contact deduped by sender email");
});

test("CSV door imports rows into ServiceRequests (auth required)", async () => {
  const jwt = await token();
  const csv = "message,name,reference\nMachine 5 leaking coolant,Floor A,M5\nBadge reader offline at gate 2,Security,GATE2\n,NoMessage,X\n";
  const form = new FormData();
  form.append("file", new Blob([csv], { type: "text/csv" }), "signals.csv");

  const r = await fetch(base + "/connectors/intake/csv", {
    method: "POST", headers: { authorization: "Bearer " + jwt }, body: form,
  });
  assert.equal(r.status, 200);
  const p = (await r.json()) as { imported: number; failed: number; total: number };
  assert.equal(p.total, 3);
  assert.equal(p.imported, 2); // two valid rows
  assert.equal(p.failed, 1); // the empty-message row
});

test("CSV door is rejected without a token", async () => {
  const r = await fetch(base + "/connectors/intake/csv", { method: "POST", body: new FormData() });
  assert.equal(r.status, 401);
});
