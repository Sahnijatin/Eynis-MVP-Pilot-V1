import test, { after, before } from "node:test";
import assert from "node:assert/strict";

// Force the offline (no-key) path deterministically — domains.ts reads the env at
// call time, so this holds regardless of import order.
const savedKey = process.env.RESEND_API_KEY;
const savedFrom = process.env.EMAIL_FROM_ADDRESS;
before(() => { process.env.RESEND_API_KEY = ""; process.env.EMAIL_FROM_ADDRESS = ""; });
after(() => { process.env.RESEND_API_KEY = savedKey; process.env.EMAIL_FROM_ADDRESS = savedFrom; });

import { prisma } from "../../db/prisma";
import { provisionSendingDomain, refreshSendingDomain, isValidSendingDomain, isValidLocalPart } from "./domains";
import { resolveResendCredentials } from "./resend";

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
after(async () => { await prisma.$disconnect(); });

test("isValidSendingDomain accepts real hostnames, rejects junk", () => {
  for (const d of ["mail.acme.com", "send.sub.acme.co.uk", "acme.io"]) assert.equal(isValidSendingDomain(d), true, d);
  for (const d of ["acme", "http://acme.com", "-acme.com", "acme.c", "a b.com", ""]) assert.equal(isValidSendingDomain(d), false, d);
});

test("isValidLocalPart accepts local parts, rejects spaces/empties", () => {
  for (const l of ["campaigns", "no-reply", "a.b_c"]) assert.equal(isValidLocalPart(l), true, l);
  for (const l of ["bad part", "", "@x"]) assert.equal(isValidLocalPart(l), false, l);
});

test("provisionSendingDomain (offline) returns a pending DNS template, no provider call", async () => {
  const r = await provisionSendingDomain("mail.acme.com");
  assert.equal(r.live, false);
  assert.equal(r.status, "pending");
  assert.equal(r.resendDomainId, null);
  assert.ok(r.dnsRecords.length >= 3);
  assert.ok(r.dnsRecords.some((d) => /spf1/.test(d.value)));        // SPF
  assert.ok(r.dnsRecords.some((d) => /_dmarc\./.test(d.name)));     // DMARC
});

test("refreshSendingDomain (offline / no id) is a safe no-op", async () => {
  assert.deepEqual(await refreshSendingDomain(null, "mail.acme.com"), { status: "pending", live: false });
  assert.deepEqual(await refreshSendingDomain("dom_x", "mail.acme.com"), { status: "pending", live: false });
});

test("resolveResendCredentials uses a VERIFIED sending domain, ignores a pending one", async () => {
  const verified = "sd-" + uid();
  await prisma.tenant.create({ data: { id: verified, name: "V " + verified.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.sendingDomain.create({ data: { tenantId: verified, domain: "mail.acme.com", fromLocalPart: "campaigns", fromName: "Acme Co", status: "verified" } });
  const c1 = await resolveResendCredentials(verified);
  assert.equal(c1.fromAddress, "campaigns@mail.acme.com");
  assert.equal(c1.fromName, "Acme Co");

  const pending = "sd-" + uid();
  await prisma.tenant.create({ data: { id: pending, name: "P " + pending.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.sendingDomain.create({ data: { tenantId: pending, domain: "mail.pending.com", fromLocalPart: "hi", status: "pending" } });
  const c2 = await resolveResendCredentials(pending);
  assert.notEqual(c2.fromAddress, "hi@mail.pending.com"); // never send from an unverified domain
});
