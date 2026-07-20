import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../../server";
import { prisma } from "../../../db/prisma";
import { ezeeAdapter, hotelogixAdapter, genericAdapter, selectPmsAdapter } from "./adapters";

// #169 — pluggable PMS adapter framework: provider payload → canonical event →
// end-to-end ingestion (Contact + Stay) via the webhook.

test("selectPmsAdapter resolves by provider name and connector key, falling back to generic", () => {
  assert.equal(selectPmsAdapter("ezee").provider, "ezee");
  assert.equal(selectPmsAdapter("pms_hotelogix").provider, "hotelogix");
  assert.equal(selectPmsAdapter("PMS_EZEE").provider, "ezee");
  assert.equal(selectPmsAdapter(null).provider, "generic");
  assert.equal(selectPmsAdapter("unknown_pms").provider, "generic");
});

test("ezeeAdapter normalizes a flat check-in payload (split name, Arrival/Departure)", () => {
  const ev = ezeeAdapter.normalize({
    Status: "CheckIn", FirstName: "Ravi", LastName: "Kumar", Mobile: "+919812345670",
    RoomNo: "305", ArrivalDate: "2026-07-20T14:00:00Z", DepartureDate: "2026-07-22T11:00:00Z", ReservationNo: "EZ-9001",
  })!;
  assert.equal(ev.type, "checkin");
  assert.equal(ev.guest.name, "Ravi Kumar");
  assert.equal(ev.guest.phone, "+919812345670");
  assert.equal(ev.roomNumber, "305");
  assert.equal(ev.confirmationId, "EZ-9001");
  assert.equal(ev.checkOutAt?.toISOString(), "2026-07-22T11:00:00.000Z");
});

test("ezeeAdapter classifies a departure as checkout", () => {
  const ev = ezeeAdapter.normalize({ Status: "CheckOut", GuestName: "A B", RoomNo: "1" })!;
  assert.equal(ev.type, "checkout");
});

test("hotelogixAdapter normalizes a CHECK_IN payload", () => {
  const ev = hotelogixAdapter.normalize({
    eventType: "CHECK_IN", guestName: "Meera Iyer", mobile: "+919812345671",
    roomNo: "12A", checkInDate: "2026-07-20T13:00:00Z", checkOutDate: "2026-07-21T11:00:00Z", reservationId: "HX-5501",
  })!;
  assert.equal(ev.type, "checkin");
  assert.equal(ev.guest.name, "Meera Iyer");
  assert.equal(ev.roomNumber, "12A");
  assert.equal(ev.confirmationId, "HX-5501");
});

test("genericAdapter keeps the legacy { event, guest, reservation } shape working", () => {
  const ev = genericAdapter.normalize({ event: "guest.checkin", guest: { name: "G", phone: "+911" }, reservation: { roomNumber: "9" } })!;
  assert.equal(ev.type, "checkin");
  assert.equal(ev.guest.name, "G");
  assert.equal(ev.roomNumber, "9");
});

// ── End-to-end through the webhook ───────────────────────────────────────────
const tid = "pms-" + Date.now().toString(36) + Math.random().toString(16).slice(2, 6);
let server: Server;
let base: string;

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "PMS Co", timezone: "Asia/Kolkata", industry: "hospitality" } });
  server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address(); if (!a || typeof a === "string") throw new Error("bind");
  base = "http://127.0.0.1:" + a.port;
});
after(async () => {
  await new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
  await prisma.stay.deleteMany({ where: { tenantId: tid } });
  await prisma.contact.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("POST /connectors/pms/webhook?provider=ezee ingests a real-shaped check-in end-to-end", async () => {
  const r = await fetch(`${base}/connectors/pms/webhook?provider=ezee&tenantId=${tid}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ Status: "CheckIn", FirstName: "Ravi", LastName: "Kumar", Mobile: "+919800000305", RoomNo: "305", ArrivalDate: "2026-07-20T14:00:00Z", ReservationNo: "EZ-1" }),
  });
  const b = await r.json() as { ok: boolean; event: string; stayId: string; provider: string };
  assert.equal(r.status, 201);
  assert.equal(b.event, "checkin");
  assert.equal(b.provider, "ezee");
  const stay = await prisma.stay.findUnique({ where: { id: b.stayId }, select: { roomNumber: true, tenantId: true, guest: { select: { fullName: true } } } });
  assert.equal(stay?.roomNumber, "305");
  assert.equal(stay?.tenantId, tid);
  assert.equal(stay?.guest?.fullName, "Ravi Kumar");
});

test("POST /connectors/pms/webhook?provider=hotelogix ingests a real-shaped check-in end-to-end", async () => {
  const r = await fetch(`${base}/connectors/pms/webhook?provider=pms_hotelogix&tenantId=${tid}`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ eventType: "CHECK_IN", guestName: "Meera Iyer", mobile: "+919800000012", roomNo: "12A", checkInDate: "2026-07-20T13:00:00Z" }),
  });
  const b = await r.json() as { ok: boolean; event: string; stayId: string; provider: string };
  assert.equal(r.status, 201);
  assert.equal(b.provider, "hotelogix");
  const stay = await prisma.stay.findUnique({ where: { id: b.stayId }, select: { roomNumber: true, guest: { select: { fullName: true } } } });
  assert.equal(stay?.roomNumber, "12A");
  assert.equal(stay?.guest?.fullName, "Meera Iyer");
});

test("webhook still requires a resolvable tenant", async () => {
  const noTid = await fetch(`${base}/connectors/pms/webhook?provider=ezee`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Status: "CheckIn", RoomNo: "1" }),
  });
  assert.equal(noTid.status, 400);
  const badTid = await fetch(`${base}/connectors/pms/webhook?provider=ezee&tenantId=nope-${tid}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ Status: "CheckIn", RoomNo: "1" }),
  });
  assert.equal(badTid.status, 404);
});
