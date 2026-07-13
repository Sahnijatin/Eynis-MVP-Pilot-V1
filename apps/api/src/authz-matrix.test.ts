import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServer, permissionMap } from "./server";
import { prisma } from "./db/prisma";

// Authorization-matrix test (improvement plan 5.3): permissionMap is the single
// source of truth for route authorization, and this test turns it into an
// ENFORCED contract by walking every entry and asserting:
//   1. no token            → 401 (never a data response)
//   2. zero-permission user → 403 on every route that requires a permission
// A new route added to the map is covered automatically; a route that bypasses
// authorize()/canAccess shows up here as a failure.

const uid = () => "authz-" + Date.now().toString(36) + "-" + Math.random().toString(16).slice(2, 8);

// Substitute every ":param" path segment with a syntactically valid dummy id so
// the dispatcher's regex/startsWith matchers route to the real handler.
const concretize = (path: string): string =>
  path
    .split("/")
    .map((seg) => (seg.startsWith(":") ? "matrix-test-id" : seg))
    .join("/");

const createdTenants: string[] = [];

after(async () => {
  for (const id of createdTenants) await prisma.tenant.deleteMany({ where: { id } });
  await prisma.$disconnect();
});

async function setup() {
  const tenantId = uid();
  createdTenants.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, name: "Authz " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "enterprise", maxSeats: 25 } });
  // A "viewer" system role stripped to ZERO permissions: the token's roleKey
  // stays a valid enum value (custom keys don't survive verifyAuthToken), but
  // live permissions resolve from this row — i.e. none.
  const role = await prisma.role.create({
    data: { tenantId, key: "viewer", displayName: "No-Perms Viewer", permissions: "[]", isSystem: true },
  });
  const email = `nobody-${tenantId}@example.com`;
  await prisma.user.create({ data: { tenantId, fullName: "No Perms", email, role: "viewer", roleId: role.id, isActive: true } });

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

  const tokRes = await fetch(base + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, roleKey: "viewer" }),
  });
  const { token } = (await tokRes.json()) as { token: string };
  assert.ok(token, "zero-permission token issued");
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { base, token, close };
}

function requestInit(method: string, token?: string): RequestInit {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) headers.authorization = "Bearer " + token;
  // A body on write methods so handlers that parse before responding never hang.
  return method === "GET" || method === "DELETE" ? { method, headers } : { method, headers, body: "{}" };
}

test("authz matrix: every mapped route rejects unauthenticated callers with 401", async () => {
  const { base, close } = await setup();
  try {
    const failures: string[] = [];
    for (const key of Object.keys(permissionMap)) {
      const [method, path] = key.split(" ");
      const res = await fetch(base + concretize(path), requestInit(method));
      // Drain the body so sockets recycle cleanly.
      await res.arrayBuffer();
      if (res.status !== 401) failures.push(`${key} → ${res.status}`);
    }
    assert.deepEqual(failures, [], `routes that did not 401 unauthenticated:\n${failures.join("\n")}`);
  } finally {
    await close();
  }
});

test("authz matrix: every permission-gated route rejects a zero-permission user with 403", async () => {
  const { base, token, close } = await setup();
  try {
    const failures: string[] = [];
    for (const [key, permission] of Object.entries(permissionMap)) {
      if (permission === null) continue; // any-authenticated routes: nothing to assert here
      const [method, path] = key.split(" ");
      const res = await fetch(base + concretize(path), requestInit(method, token));
      await res.arrayBuffer();
      if (res.status !== 403) failures.push(`${key} → ${res.status}`);
    }
    assert.deepEqual(failures, [], `permission-gated routes that did not 403 a zero-permission user:\n${failures.join("\n")}`);
  } finally {
    await close();
  }
});
