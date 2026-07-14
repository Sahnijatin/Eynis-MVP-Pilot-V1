import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServer } from "../server";
import { prisma } from "../db/prisma";
import { assertTokenExchangeConfigured } from "./auth";

// Phase 9 / C1: /auth/token and /auth/identify are the identity boundary — with
// the shared web<->API secret configured, only the web tier can use them.

const uid = () => "texch-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
const createdTenants: string[] = [];

after(async () => {
  for (const id of createdTenants) await prisma.tenant.deleteMany({ where: { id } });
  await prisma.$disconnect();
});

async function setup() {
  const tenantId = uid();
  createdTenants.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, name: "Texch " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  const email = `owner-${tenantId}@example.com`;
  await prisma.user.create({ data: { tenantId, fullName: "Owner", email, role: "owner", isActive: true } });
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { tenantId, email, base, close };
}

test("with the secret configured, /auth/token and /auth/identify reject callers without it", async () => {
  const { tenantId, email, base, close } = await setup();
  process.env.EYNIS_TOKEN_EXCHANGE_SECRET = "shhh-web-tier-only";
  try {
    const tokenBody = JSON.stringify({ tenantId, email, role: "owner" });

    // No header → 401. Wrong header → 401. No token minted either way.
    const bare = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json" }, body: tokenBody });
    assert.equal(bare.status, 401);
    const wrong = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-token-exchange-secret": "guess" }, body: tokenBody });
    assert.equal(wrong.status, 401);

    // Correct header → token issued as before.
    const good = await fetch(base + "/auth/token", { method: "POST", headers: { "content-type": "application/json", "x-token-exchange-secret": "shhh-web-tier-only" }, body: tokenBody });
    assert.equal(good.status, 200);
    assert.ok(((await good.json()) as { token?: string }).token);

    // /auth/identify: same boundary — no tenantId/roleKey oracle without the secret.
    const idBare = await fetch(base + `/auth/identify?email=${encodeURIComponent(email)}`);
    assert.equal(idBare.status, 401);
    const idGood = await fetch(base + `/auth/identify?email=${encodeURIComponent(email)}`, { headers: { "x-token-exchange-secret": "shhh-web-tier-only" } });
    assert.equal(idGood.status, 200);
    assert.equal(((await idGood.json()) as { exists: boolean }).exists, true);
  } finally {
    delete process.env.EYNIS_TOKEN_EXCHANGE_SECRET;
    await close();
  }
});

test("without the secret configured (dev), both endpoints stay open — and prod boot asserts", async () => {
  const { tenantId, email, base, close } = await setup();
  try {
    delete process.env.EYNIS_TOKEN_EXCHANGE_SECRET;
    const open = await fetch(base + "/auth/token", {
      method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, email, role: "owner" }),
    });
    assert.equal(open.status, 200, "dev stays open when unconfigured");

    // Startup assertion matrix (injectable, like the other prod asserts).
    assert.throws(() => assertTokenExchangeConfigured({ isProduction: true, configured: false }), /EYNIS_TOKEN_EXCHANGE_SECRET/);
    assert.doesNotThrow(() => assertTokenExchangeConfigured({ isProduction: true, configured: true }));
    assert.doesNotThrow(() => assertTokenExchangeConfigured({ isProduction: false, configured: false }));
  } finally {
    await close();
  }
});
