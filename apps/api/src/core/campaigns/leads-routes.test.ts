import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);

const createHotel = async (hotelId: string) => {
  await prisma.tenant.create({ data: { id: hotelId, name: "VC " + hotelId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { hotelId, plan: "growth", maxSeats: 25 } });
};
const createUser = async (hotelId: string, role: string, email: string) =>
  prisma.user.create({ data: { hotelId, fullName: "U " + role, email, role, isActive: true } });

async function startServer(): Promise<{ server: Server; base: string }> {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("bind failed");
  return { server, base: "http://127.0.0.1:" + addr.port };
}
const stop = (server: Server) => new Promise<void>((res, rej) => server.close((e) => (e ? rej(e) : res())));

const authHeaders = async (base: string, hotelId: string, email: string, role: string) => {
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ hotelId, email, role }),
  });
  const p = (await r.json()) as { token?: string };
  if (!p.token) throw new Error("no token");
  return "Bearer " + p.token;
};

const validCampaign = {
  name: "Upsell", scriptTemplate: "Hi {lead.firstName}",
  voiceA: "Rachel", voiceB: "Aria", personaA: "Enthusiastic", personaB: "Sophisticated",
};

async function createCampaign(base: string, token: string): Promise<string> {
  const r = await fetch(base + "/campaigns", {
    method: "POST", headers: { authorization: token, "content-type": "application/json" },
    body: JSON.stringify(validCampaign),
  });
  return ((await r.json()) as any).campaign.id;
}

// Build a multipart upload with FormData (Node global).
async function importCsv(base: string, token: string, campaignId: string, csv: string, columnMap: object) {
  const fd = new FormData();
  fd.append("columnMap", JSON.stringify(columnMap));
  fd.append("file", new Blob([csv], { type: "text/csv" }), "leads.csv");
  const r = await fetch(base + `/campaigns/${campaignId}/leads/import`, {
    method: "POST", headers: { authorization: token }, body: fd,
  });
  return { status: r.status, body: (await r.json()) as any };
}

after(async () => { await prisma.$disconnect(); });

test("import CSV: inserts consented leads, lists them, dedupes re-imports", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaignId = await createCampaign(base, token);
    const csv = [
      "First Name,Mobile,Company,Opted In,Tier",
      "Sarah,98765 43210,Acme,yes,gold",
      "Bob,98765 43211,Globex,yes,silver",
    ].join("\n");
    const map = { "First Name": "firstName", "Mobile": "phone", "Company": "company", "Opted In": "consent" };

    const first = await importCsv(base, token, campaignId, csv, map);
    assert.equal(first.status, 200);
    assert.equal(first.body.imported, 2);
    assert.equal(first.body.skipped, 0);

    // list
    const listRes = await fetch(base + `/campaigns/${campaignId}/leads`, { headers: { authorization: token } });
    const list = (await listRes.json()) as any;
    assert.equal(list.items.length, 2);
    assert.ok(list.items.every((l: any) => l.status === "pending" && l.consent === true));

    // re-import same file → all duplicates skipped
    const second = await importCsv(base, token, campaignId, csv, map);
    assert.equal(second.body.imported, 0);
    assert.equal(second.body.skipped, 2);
  } finally {
    await stop(server);
  }
});

test("import CSV: non-consented rows are rejected with reason", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaignId = await createCampaign(base, token);
    const csv = ["First Name,Mobile,Opted In", "Sarah,9876543210,yes", "Bob,9876543211,no"].join("\n");
    const map = { "First Name": "firstName", "Mobile": "phone", "Opted In": "consent" };
    const r = await importCsv(base, token, campaignId, csv, map);
    assert.equal(r.body.imported, 1);
    assert.ok(r.body.errors.some((e: any) => e.reason === "no_consent"));
  } finally {
    await stop(server);
  }
});

test("import CSV: scalar columnMap returns 400, not 500 (#5)", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaignId = await createCampaign(base, token);
    const fd = new FormData();
    fd.append("columnMap", "null"); // valid JSON, but not an object
    fd.append("file", new Blob(["First Name,Mobile\nSarah,9876543210"], { type: "text/csv" }), "leads.csv");
    const r = await fetch(base + `/campaigns/${campaignId}/leads/import`, { method: "POST", headers: { authorization: token }, body: fd });
    assert.equal(r.status, 400);
    assert.equal(((await r.json()) as any).ok, false);
  } finally {
    await stop(server);
  }
});

test("DELETE lead: pending removable, non-pending blocked (409)", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaignId = await createCampaign(base, token);
    const pending = await prisma.campaignLead.create({ data: { campaignId, hotelId, firstName: "P", phone: "+9190000001", consent: true } });
    const called = await prisma.campaignLead.create({ data: { campaignId, hotelId, firstName: "C", phone: "+9190000002", consent: true, status: "called" } });

    const okDel = await fetch(base + `/campaigns/${campaignId}/leads/${pending.id}`, { method: "DELETE", headers: { authorization: token } });
    assert.equal(okDel.status, 200);

    const blocked = await fetch(base + `/campaigns/${campaignId}/leads/${called.id}`, { method: "DELETE", headers: { authorization: token } });
    assert.equal(blocked.status, 409);
  } finally {
    await stop(server);
  }
});

test("import CSV with a UTF-8 BOM + messy country code imports correctly (regression)", async () => {
  // Reproduces the real-world failure: Excel saves CSVs as UTF-8-with-BOM, and a
  // campaign whose defaultCountryCode had a stray space ("+91 ") used to reject
  // every row as "missing or invalid phone".
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    // campaign with a space-padded country code
    const c = await prisma.voiceCampaign.create({
      data: { hotelId, name: "BOM", status: "draft", channels: JSON.stringify(["whatsapp"]), whatsappContentSid: "HX", defaultCountryCode: "+91 " },
    });
    const csv = "﻿" + ["First Name,Last Name,Phone,Email,Consent", "Jatin,Sahni,9997497006,j@x.com,Yes", "Sanyam,Pahwa,8384826232,s@x.com,Yes"].join("\n");
    const map = { "First Name": "firstName", "Last Name": "lastName", "Phone": "phone", "Email": "email", "Consent": "consent" };
    const r = await importCsv(base, token, c.id, csv, map);
    assert.equal(r.status, 200);
    assert.equal(r.body.imported, 2);
    assert.equal(r.body.errors.length, 0);
    const phones = (await prisma.campaignLead.findMany({ where: { campaignId: c.id }, select: { phone: true } })).map((l) => l.phone).sort();
    assert.deepEqual(phones, ["+918384826232", "+919997497006"]);
  } finally {
    await stop(server);
  }
});

test("durable suppression (#3): opt-out survives campaign deletion and blocks re-import", async () => {
  const { suppressContact } = await import("./csv-import");
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");

    // A lead opts out on campaign A, then campaign A is deleted entirely.
    const campA = await createCampaign(base, token);
    const phone = "+919" + uid().replace(/[^0-9]/g, "").padEnd(9, "0").slice(0, 9);
    await prisma.campaignLead.create({ data: { campaignId: campA, hotelId, firstName: "X", phone, consent: true } });
    await suppressContact(hotelId, phone, "opt_out");
    await prisma.voiceCampaign.delete({ where: { id: campA } }); // lead row gone via cascade

    // Re-import the same phone into a brand-new campaign — must be suppressed.
    const campB = await createCampaign(base, token);
    const national = phone.replace("+91", "");
    const csv = ["First Name,Mobile,Opted In", `Sarah,${national},yes`].join("\n");
    const map = { "First Name": "firstName", "Mobile": "phone", "Opted In": "consent" };
    const r = await importCsv(base, token, campB, csv, map);
    assert.equal(r.body.imported, 0);
    assert.ok(r.body.errors.some((e: any) => e.reason === "opted_out"));
  } finally {
    await stop(server);
  }
});

test("import CSV: tenant-wide opted-out phone is skipped", async () => {
  const hotelId = "vc-" + uid();
  await createHotel(hotelId);
  const email = `owner+${hotelId}@test.local`;
  await createUser(hotelId, "owner", email);
  const { server, base } = await startServer();
  try {
    const token = await authHeaders(base, hotelId, email, "owner");
    const campaignId = await createCampaign(base, token);
    // a different campaign already opted this phone out for the tenant
    const otherCampaignId = await createCampaign(base, token);
    await prisma.campaignLead.create({ data: { campaignId: otherCampaignId, hotelId, firstName: "X", phone: "+919999900000", consent: true, optedOut: true, status: "opted_out" } });

    const csv = ["First Name,Mobile,Opted In", "Sarah,9999900000,yes", "Bob,9999900001,yes"].join("\n");
    const map = { "First Name": "firstName", "Mobile": "phone", "Opted In": "consent" };
    const r = await importCsv(base, token, campaignId, csv, map);
    assert.equal(r.body.imported, 1); // only Bob
    assert.ok(r.body.errors.some((e: any) => e.reason === "opted_out"));
  } finally {
    await stop(server);
  }
});
