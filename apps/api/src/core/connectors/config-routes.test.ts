import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import type { Server } from "node:http";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

// #164 — coverage for the extracted connector-config router: the live-key test
// endpoint, unknown-key 404s, and the secret mask/preserve round-trip that the
// e2e suite doesn't exercise.

const uid = () => Date.now().toString(36) + Math.random().toString(16).slice(2, 8);
const tid = "cfg-" + uid();
const email = `owner-${uid()}@cfg.test`;

const listen = async (s: Server): Promise<string> => {
  await new Promise<void>((r) => s.listen(0, r));
  const a = s.address(); if (!a || typeof a === "string") throw new Error("bind");
  return "http://127.0.0.1:" + a.port;
};
const close = (s: Server) => new Promise<void>((res, rej) => s.close((e) => (e ? rej(e) : res())));

let server: Server;
let base: string;
let headers: Record<string, string>;

before(async () => {
  await prisma.tenant.create({ data: { id: tid, name: "Cfg Co", timezone: "Asia/Kolkata" } });
  await prisma.user.create({ data: { tenantId: tid, fullName: "Owner", email, role: "owner", isActive: true } });
  server = buildServer();
  base = await listen(server);
  const r = await fetch(base + "/auth/token", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId: tid, email, role: "owner" }),
  });
  const { token } = await r.json() as { token: string };
  headers = { authorization: "Bearer " + token, "content-type": "application/json" };
});

after(async () => {
  await close(server);
  await prisma.connectorConfig.deleteMany({ where: { tenantId: tid } });
  await prisma.auditLog.deleteMany({ where: { tenantId: tid } });
  await prisma.user.deleteMany({ where: { tenantId: tid } });
  await prisma.tenant.deleteMany({ where: { id: tid } });
  await prisma.$disconnect();
});

test("PUT persists config, masks the secret on read, and preserves it when the mask is re-sent", async () => {
  const put = await fetch(base + "/connectors/configs/whatsapp_twilio", {
    method: "PUT", headers,
    body: JSON.stringify({ enabled: true, config: { accountSid: "AC123", authToken: "super-secret-token" } }),
  });
  const pj = await put.json() as { ok: boolean; item: { enabled: boolean; config: Record<string, string> } };
  assert.equal(put.status, 200);
  assert.equal(pj.item.enabled, true);
  assert.equal(pj.item.config.accountSid, "AC123");
  assert.equal(pj.item.config.authToken, "***", "secret is masked on the way out");

  // Re-save echoing the mask back must NOT clobber the stored secret.
  const resave = await fetch(base + "/connectors/configs/whatsapp_twilio", {
    method: "PUT", headers,
    body: JSON.stringify({ enabled: true, config: { accountSid: "AC123", authToken: "***" } }),
  });
  assert.equal(resave.status, 200);
  const row = await prisma.connectorConfig.findUnique({
    where: { tenantId_connectorKey: { tenantId: tid, connectorKey: "whatsapp_twilio" } },
    select: { configJson: true },
  });
  const stored = JSON.parse(row!.configJson) as Record<string, string>;
  assert.equal(stored.authToken, "super-secret-token", "the real secret survives a masked re-save");

  // The registry overlay reflects the persisted, masked config.
  const reg = await fetch(base + "/connectors/registry", { headers });
  const rj = await reg.json() as { items: Array<{ key: string; enabled: boolean; status: string; config: Record<string, string> }> };
  const twilio = rj.items.find((i) => i.key === "whatsapp_twilio");
  assert.ok(twilio);
  assert.equal(twilio!.enabled, true);
  assert.equal(twilio!.config.authToken, "***");
});

test("POST /connectors/configs/:key/test reports non-testable connectors gracefully", async () => {
  // pms_hotelogix has no live checker → testable:false, no network call.
  const r = await fetch(base + "/connectors/configs/pms_hotelogix/test", { method: "POST", headers });
  const j = await r.json() as { ok: boolean; testable: boolean };
  assert.equal(r.status, 200);
  assert.equal(j.ok, true);
  assert.equal(j.testable, false);
});

test("unknown connector keys are rejected with 404 on test and PUT", async () => {
  const t = await fetch(base + "/connectors/configs/not_a_connector/test", { method: "POST", headers });
  assert.equal(t.status, 404);

  const p = await fetch(base + "/connectors/configs/not_a_connector", {
    method: "PUT", headers, body: JSON.stringify({ enabled: true, config: {} }),
  });
  assert.equal(p.status, 404);
});

test("DELETE removes a persisted config", async () => {
  await fetch(base + "/connectors/configs/email_resend", {
    method: "PUT", headers, body: JSON.stringify({ enabled: true, config: { apiKey: "re_abc" } }),
  });
  const del = await fetch(base + "/connectors/configs/email_resend", { method: "DELETE", headers });
  assert.equal(del.status, 200);
  const row = await prisma.connectorConfig.findUnique({
    where: { tenantId_connectorKey: { tenantId: tid, connectorKey: "email_resend" } },
  });
  assert.equal(row, null);
});

test("the config routes require authentication", async () => {
  const reg = await fetch(base + "/connectors/registry");
  assert.equal(reg.status, 401);
  const put = await fetch(base + "/connectors/configs/whatsapp_twilio", {
    method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: true }),
  });
  assert.equal(put.status, 401);
});
