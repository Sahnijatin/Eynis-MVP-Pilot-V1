import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const tid = "healthcare-smoke-" + Date.now();

async function auth(base: string) {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email: "owner@hc.test", role: "owner" }),
  });
  const p = (await r.json()) as { token?: string };
  return { authorization: "Bearer " + p.token };
}

after(async () => {
  await prisma.appointment.deleteMany({ where: { tenantId: tid } });
  await prisma.patient.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.license.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("patients + appointments CRUD, date filter, tenant scoping", async () => {
  await prisma.tenant.create({ data: { id: tid, name: "HC Smoke", timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId: tid, plan: "growth", maxSeats: 25 } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email: "owner@hc.test", role: "owner", isActive: true } });

  const server = buildServer();
  await new Promise<void>((r) => server.listen(0, r));
  const a = server.address();
  const base = "http://127.0.0.1:" + (typeof a === "object" && a ? a.port : 0);

  try {
    const headers = { ...(await auth(base)), "content-type": "application/json" };

    // Create a patient with DOB → derived age present.
    const pRes = await fetch(base + "/patients", { method: "POST", headers, body: JSON.stringify({ name: "Rahul Sharma", dateOfBirth: "1990-01-01", condition: "Hypertension", status: "overdue", bloodGroup: "B+" }) });
    assert.equal(pRes.status, 200);
    const patient = (await pRes.json()) as { item: { id: string; age: number | null; status: string } };
    assert.ok(patient.item.age && patient.item.age >= 30, "age should be derived from DOB");
    assert.equal(patient.item.status, "overdue");
    const patientId = patient.item.id;

    // Bad patient status → 400.
    assert.equal((await fetch(base + "/patients/" + patientId, { method: "PATCH", headers, body: JSON.stringify({ status: "nope" }) })).status, 400);

    // Create a linked appointment today.
    const today = new Date().toISOString().slice(0, 10);
    const apptRes = await fetch(base + "/appointments", { method: "POST", headers, body: JSON.stringify({ patientId, patientName: "Rahul Sharma", provider: "Dr. Patel", type: "Consultation", scheduledAt: `${today}T09:30:00`, durationMin: 30 }) });
    assert.equal(apptRes.status, 200);
    const appt = (await apptRes.json()) as { item: { id: string; patientId: string | null; status: string } };
    assert.equal(appt.item.patientId, patientId);
    assert.equal(appt.item.status, "scheduled");
    const apptId = appt.item.id;

    // Unknown patientId on create → 400.
    assert.equal((await fetch(base + "/appointments", { method: "POST", headers, body: JSON.stringify({ patientName: "X", scheduledAt: `${today}T10:00:00`, patientId: "nope" }) })).status, 400);

    // Date filter: today returns 1, a far-past date returns 0.
    const todayList = (await (await fetch(base + `/appointments?date=${today}`, { headers })).json()) as { items: unknown[] };
    assert.equal(todayList.items.length, 1);
    const pastList = (await (await fetch(base + "/appointments?date=2000-01-01", { headers })).json()) as { items: unknown[] };
    assert.equal(pastList.items.length, 0);

    // Status change → checked_in.
    assert.equal((await fetch(base + "/appointments/" + apptId, { method: "PATCH", headers, body: JSON.stringify({ status: "checked_in" }) })).status, 200);

    // Deleting the patient nulls the appointment's patientId (SetNull).
    assert.equal((await fetch(base + "/patients/" + patientId, { method: "DELETE", headers })).status, 200);
    assert.equal((await prisma.appointment.findUnique({ where: { id: apptId } }))?.patientId, null);

    // Unknown ids → 404.
    assert.equal((await fetch(base + "/appointments/nope", { method: "DELETE", headers })).status, 404);
    assert.equal((await fetch(base + "/patients/nope", { method: "DELETE", headers })).status, 404);
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
  }
});
