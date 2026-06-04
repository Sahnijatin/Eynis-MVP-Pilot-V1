import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "VC " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
const createUser = (tenantId: string, email: string) => prisma.user.create({ data: { tenantId, fullName: "U", email, role: "owner", isActive: true } });
async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));
const auth = async (base: string, tenantId: string, email: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, role: "owner" }) });
  return "Bearer " + ((await r.json()) as { token: string }).token;
};

after(async () => { await prisma.$disconnect(); });

test("templates: create → submit → approve lifecycle, list filter, isolation", async () => {
  const tenantId = "tpl-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, email);
  const { server, base } = await startServer();
  try {
    const token = await auth(base, tenantId, email);

    // create
    const created = await fetch(base + "/templates", {
      method: "POST", headers: { authorization: token, "content-type": "application/json" },
      body: JSON.stringify({ name: "Welcome", channel: "whatsapp", body: "Hi {{1}}", variables: ["{lead.firstName}"] }),
    });
    assert.equal(created.status, 201);
    const tpl = ((await created.json()) as any).template;
    assert.equal(tpl.status, "draft");
    assert.deepEqual(tpl.variables, ["{lead.firstName}"]);

    // submit (draft → submitted)
    const submitted = await fetch(base + `/templates/${tpl.id}/submit`, { method: "POST", headers: { authorization: token } });
    assert.equal(((await submitted.json()) as any).template.status, "submitted");

    // approving without a provider id fails
    const bad = await fetch(base + `/templates/${tpl.id}`, { method: "PATCH", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ status: "approved" }) });
    assert.equal(bad.status, 400);

    // approve with the Content SID
    const approved = await fetch(base + `/templates/${tpl.id}`, { method: "PATCH", headers: { authorization: token, "content-type": "application/json" }, body: JSON.stringify({ status: "approved", providerTemplateId: "HX999" }) });
    const ap = ((await approved.json()) as any).template;
    assert.equal(ap.status, "approved");
    assert.equal(ap.providerTemplateId, "HX999");

    // list filter by approved
    const list = await (await fetch(base + "/templates?status=approved", { headers: { authorization: token } })).json() as any;
    assert.equal(list.items.length, 1);

    // tenant isolation
    const otherHotel = "tpl-" + uid();
    await createHotel(otherHotel);
    const oEmail = `owner+${otherHotel}@test.local`;
    await createUser(otherHotel, oEmail);
    const oToken = await auth(base, otherHotel, oEmail);
    const leak = await fetch(base + `/templates/${tpl.id}`, { headers: { authorization: oToken } });
    assert.equal(leak.status, 404);
    assert.equal((await (await fetch(base + "/templates", { headers: { authorization: oToken } })).json() as any).items.length, 0);
  } finally {
    await stop(server);
  }
});
