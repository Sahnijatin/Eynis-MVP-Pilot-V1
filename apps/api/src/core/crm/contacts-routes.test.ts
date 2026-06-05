import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";
import { backfillContactsFromLeads } from "./contacts";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (tenantId: string) => {
  await prisma.tenant.create({ data: { id: tenantId, name: "CRM " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
};
const createUser = async (tenantId: string, role: string, email: string) => {
  await prisma.user.create({ data: { tenantId, fullName: "U " + role, email, role, isActive: true } });
};
async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve())));
const authHeaders = async (base: string, tenantId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tenantId, email, role }) });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return { authorization: "Bearer " + p.token, "content-type": "application/json" };
};

after(async () => { await prisma.$disconnect(); });

test("contact CRUD + deal linkage and company roll-up", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const email = `owner+${tenantId}@test.local`;
  await createUser(tenantId, "owner", email);
  const { server, base } = await startServer();
  try {
    const headers = await authHeaders(base, tenantId, email, "owner");

    // Company
    const company = (await (await fetch(base + "/companies", { method: "POST", headers, body: JSON.stringify({ name: "Acme Corp", domain: "acme.com" }) })).json()) as any;
    assert.equal(company.company.name, "Acme Corp");

    // Contact linked to the company
    const created = (await (await fetch(base + "/contacts", { method: "POST", headers, body: JSON.stringify({ fullName: "Jane Doe", email: "jane@acme.com", companyId: company.company.id, lifecycleStage: "sql" }) })).json()) as any;
    assert.equal(created.contact.fullName, "Jane Doe");
    assert.equal(created.contact.companyName, "Acme Corp");
    assert.equal(created.contact.lifecycleStage, "sql");
    const contactId = created.contact.id;

    // List + lifecycle filter
    const list = (await (await fetch(base + "/contacts?lifecycleStage=sql", { headers })).json()) as any;
    assert.ok(list.items.some((c: any) => c.id === contactId));

    // A deal for this contact + company
    await fetch(base + "/pipelines", { headers }); // seed pipeline
    const deal = (await (await fetch(base + "/deals", { method: "POST", headers, body: JSON.stringify({ title: "Acme renewal", value: 50000, contactId, companyId: company.company.id }) })).json()) as any;
    assert.equal(deal.deal.contactName, "Jane Doe");
    assert.equal(deal.deal.companyName, "Acme Corp");

    // Contact detail shows the deal
    const detail = (await (await fetch(base + `/contacts/${contactId}`, { headers })).json()) as any;
    assert.equal(detail.deals.length, 1);
    assert.equal(detail.deals[0].title, "Acme renewal");

    // Company detail shows the contact + deal
    const coDetail = (await (await fetch(base + `/companies/${company.company.id}`, { headers })).json()) as any;
    assert.equal(coDetail.contacts.length, 1);
    assert.equal(coDetail.deals.length, 1);

    // PATCH lifecycle
    const patched = (await (await fetch(base + `/contacts/${contactId}`, { method: "PATCH", headers, body: JSON.stringify({ lifecycleStage: "customer", tags: ["vip"] }) })).json()) as any;
    assert.equal(patched.contact.lifecycleStage, "customer");
    assert.deepEqual(patched.contact.tags, ["vip"]);

    // DELETE
    const del = await fetch(base + `/contacts/${contactId}`, { method: "DELETE", headers });
    assert.equal(del.status, 200);
    const gone = await fetch(base + `/contacts/${contactId}`, { headers });
    assert.equal(gone.status, 404);
  } finally {
    await stop(server);
  }
});

test("backfillContactsFromLeads dedupes by phone and is idempotent", async () => {
  const tenantId = "crm-" + uid();
  await createHotel(tenantId);
  const campaign = await prisma.voiceCampaign.create({ data: { tenantId, name: "C" } });
  // Two leads share a phone; one has a unique phone; one has no phone (skipped).
  await prisma.campaignLead.createMany({
    data: [
      { campaignId: campaign.id, tenantId, firstName: "A", phone: "+919000000001", email: "a@x.com" },
      { campaignId: campaign.id, tenantId, firstName: "B", phone: "+919000000002" },
      { campaignId: campaign.id, tenantId, firstName: "C", phone: null },
    ],
  });
  // Pre-existing contact for the second phone — should be reused, not duplicated.
  await prisma.contact.create({ data: { tenantId, fullName: "Existing", phoneE164: "+919000000002" } });

  const r1 = await backfillContactsFromLeads(tenantId);
  assert.equal(r1.linked, 2); // two phoned leads linked
  assert.equal(r1.created, 1); // only the new phone created a contact (other reused existing)

  const contacts = await prisma.contact.count({ where: { tenantId } });
  assert.equal(contacts, 2); // existing + 1 created

  // Idempotent: re-running links nothing new.
  const r2 = await backfillContactsFromLeads(tenantId);
  assert.equal(r2.linked, 0);
  assert.equal(r2.created, 0);

  // The null-phone lead stays unlinked.
  const unlinked = await prisma.campaignLead.count({ where: { tenantId, contactId: null } });
  assert.equal(unlinked, 1);
});

test("tenant isolation: a tenant cannot read another tenant's contact or company", async () => {
  const tenantA = "crm-" + uid();
  const tenantB = "crm-" + uid();
  await createHotel(tenantA);
  await createHotel(tenantB);
  const emailA = `owner+${tenantA}@test.local`;
  const emailB = `owner+${tenantB}@test.local`;
  await createUser(tenantA, "owner", emailA);
  await createUser(tenantB, "owner", emailB);
  const { server, base } = await startServer();
  try {
    const headersA = await authHeaders(base, tenantA, emailA, "owner");
    const headersB = await authHeaders(base, tenantB, emailB, "owner");
    const contact = (await (await fetch(base + "/contacts", { method: "POST", headers: headersA, body: JSON.stringify({ fullName: "Secret" }) })).json()) as any;
    const company = (await (await fetch(base + "/companies", { method: "POST", headers: headersA, body: JSON.stringify({ name: "SecretCo" }) })).json()) as any;

    assert.equal((await fetch(base + `/contacts/${contact.contact.id}`, { headers: headersB })).status, 404);
    assert.equal((await fetch(base + `/companies/${company.company.id}`, { headers: headersB })).status, 404);
  } finally {
    await stop(server);
  }
});
