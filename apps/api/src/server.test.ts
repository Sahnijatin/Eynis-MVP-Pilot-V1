import test, { after } from "node:test";
import assert from "node:assert/strict";
import { buildServer } from "./server";
import { prisma } from "./db/prisma";

const uniqueHotelId = () => "test-hotel-" + Date.now() + "-" + Math.random().toString(16).slice(2);

const createHotel = async (hotelId: string) => {
  await prisma.hotel.create({
    data: {
      id: hotelId,
      name: "Test Hotel " + hotelId.slice(-4),
      timezone: "Asia/Kolkata"
    }
  });
  // Give the test hotel a Growth license so the plan-gated endpoints (advanced
  // analytics, AI, automations, night audit) are exercised rather than 403'd.
  await prisma.license.create({
    data: { hotelId, plan: "growth", maxSeats: 25 }
  });
};

const createUser = async (
  hotelId: string,
  role: "owner" | "front_desk" | "housekeeping" | "fnb_manager",
  email: string
) => {
  await prisma.user.create({
    data: {
      hotelId,
      fullName: "Test User " + role,
      email,
      role,
      isActive: true
    }
  });
};

const getAuthHeaders = async (
  base: string,
  hotelId: string,
  email: string,
  role: "owner" | "front_desk" | "housekeeping" | "fnb_manager"
) => {
  const response = await fetch(base + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ hotelId, email, role })
  });
  const payload = (await response.json()) as { ok: boolean; token?: string };
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  if (!payload.token) {
    throw new Error("Token was not returned");
  }
  return { authorization: "Bearer " + payload.token };
};

after(async () => {
  await prisma.$disconnect();
});

test("GET /health returns ok payload", async () => {
  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  const response = await fetch("http://127.0.0.1:" + address.port + "/health");
  const payload = (await response.json()) as { ok: boolean; service: string };

  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);
  assert.equal(payload.service, "eynis-api");

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("GET /context validates bearer token context", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);
  await createUser(hotelId, "owner", "owner+" + hotelId + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  const base = "http://127.0.0.1:" + address.port;
  const headers = await getAuthHeaders(
    base,
    hotelId,
    "owner+" + hotelId + "@test.local",
    "owner"
  );

  const response = await fetch(base + "/context", { headers });
  const payload = (await response.json()) as { ok: boolean };
  assert.equal(response.status, 200);
  assert.equal(payload.ok, true);

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("POST event and read audit trail", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);
  await createUser(hotelId, "owner", "owner+" + hotelId + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }

  const base = "http://127.0.0.1:" + address.port;
  const headers = await getAuthHeaders(
    base,
    hotelId,
    "owner+" + hotelId + "@test.local",
    "owner"
  );

  const eventResponse = await fetch(base + "/events/service-request-created", {
    method: "POST",
    headers
  });
  assert.equal(eventResponse.status, 202);

  const auditResponse = await fetch(base + "/audit", { headers });
  const auditPayload = (await auditResponse.json()) as {
    ok: boolean;
    items: Array<{ action: string }>;
  };
  assert.equal(auditResponse.status, 200);
  assert.equal(auditPayload.ok, true);
  assert.equal(auditPayload.items[0]?.action, "service_request.created");

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("service requests are tenant scoped by hotel", async () => {
  const hotelA = uniqueHotelId();
  const hotelB = uniqueHotelId();
  await createHotel(hotelA);
  await createHotel(hotelB);
  await createUser(hotelA, "front_desk", "fd+" + hotelA + "@test.local");
  await createUser(hotelA, "owner", "owner+" + hotelA + "@test.local");
  await createUser(hotelB, "front_desk", "fd+" + hotelB + "@test.local");
  await createUser(hotelB, "owner", "owner+" + hotelB + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;
  const hotelAFrontDeskHeaders = await getAuthHeaders(
    base,
    hotelA,
    "fd+" + hotelA + "@test.local",
    "front_desk"
  );
  const hotelBFrontDeskHeaders = await getAuthHeaders(
    base,
    hotelB,
    "fd+" + hotelB + "@test.local",
    "front_desk"
  );
  const hotelAOwnerHeaders = await getAuthHeaders(
    base,
    hotelA,
    "owner+" + hotelA + "@test.local",
    "owner"
  );

  const createForA = await fetch(base + "/service-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...hotelAFrontDeskHeaders
    },
    body: JSON.stringify({
      guestName: "Guest A",
      guestPhone: "+919999000001",
      category: "housekeeping",
      summary: "Need extra towels"
    })
  });
  assert.equal(createForA.status, 201);

  const createForB = await fetch(base + "/service-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...hotelBFrontDeskHeaders
    },
    body: JSON.stringify({
      guestName: "Guest B",
      guestPhone: "+919999000002",
      category: "maintenance",
      summary: "AC not cooling"
    })
  });
  assert.equal(createForB.status, 201);

  const listAResponse = await fetch(base + "/service-requests", { headers: hotelAOwnerHeaders });
  const listA = (await listAResponse.json()) as {
    ok: boolean;
    items: Array<{ hotelId: string }>;
  };
  assert.equal(listAResponse.status, 200);
  assert.equal(listA.ok, true);
  assert.equal(listA.items.length, 1);
  assert.equal(listA.items[0]?.hotelId, hotelA);

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("PATCH service request status updates and writes audit", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);
  await createUser(hotelId, "front_desk", "fd+" + hotelId + "@test.local");
  await createUser(hotelId, "housekeeping", "hk+" + hotelId + "@test.local");
  await createUser(hotelId, "owner", "owner+" + hotelId + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;
  const frontDeskHeaders = await getAuthHeaders(
    base,
    hotelId,
    "fd+" + hotelId + "@test.local",
    "front_desk"
  );
  const houseKeepingHeaders = await getAuthHeaders(
    base,
    hotelId,
    "hk+" + hotelId + "@test.local",
    "housekeeping"
  );
  const ownerHeaders = await getAuthHeaders(
    base,
    hotelId,
    "owner+" + hotelId + "@test.local",
    "owner"
  );

  const createResponse = await fetch(base + "/service-requests", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...frontDeskHeaders
    },
    body: JSON.stringify({
      guestName: "Guest C",
      guestPhone: "+919999000003",
      category: "housekeeping",
      summary: "Need extra blanket"
    })
  });
  const created = (await createResponse.json()) as { item: { id: string } };
  assert.equal(createResponse.status, 201);

  const patchResponse = await fetch(
    base + "/service-requests/" + created.item.id + "/status",
    {
      method: "PATCH",
      headers: {
        "content-type": "application/json",
        ...houseKeepingHeaders
      },
      body: JSON.stringify({ status: "resolved" })
    }
  );
  const patched = (await patchResponse.json()) as { ok: boolean; item: { status: string } };
  assert.equal(patchResponse.status, 200);
  assert.equal(patched.ok, true);
  assert.equal(patched.item.status, "resolved");

  const auditResponse = await fetch(base + "/audit", { headers: ownerHeaders });
  const audit = (await auditResponse.json()) as {
    items: Array<{ action: string }>;
  };
  assert.equal(auditResponse.status, 200);
  assert.equal(
    audit.items.some((x) => x.action === "service_request.status_changed"),
    true
  );

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("assign endpoint updates assignee and transition history is readable", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);
  await createUser(hotelId, "front_desk", "fd+" + hotelId + "@test.local");
  await createUser(hotelId, "housekeeping", "hk+" + hotelId + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;
  const frontDeskHeaders = await getAuthHeaders(
    base,
    hotelId,
    "fd+" + hotelId + "@test.local",
    "front_desk"
  );

  try {
    const createdResponse = await fetch(base + "/service-requests", {
      method: "POST",
      headers: { "content-type": "application/json", ...frontDeskHeaders },
      body: JSON.stringify({
        guestName: "Guest Assign",
        guestPhone: "+919999001111",
        category: "housekeeping",
        summary: "Need water bottles"
      })
    });
    const createdPayload = (await createdResponse.json()) as { item: { id: string } };
    assert.equal(createdResponse.status, 201);

    const assignResponse = await fetch(
      base + "/service-requests/" + createdPayload.item.id + "/assign",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", ...frontDeskHeaders },
        body: JSON.stringify({ assigneeEmail: "hk+" + hotelId + "@test.local" })
      }
    );
    assert.equal(assignResponse.status, 200);

    const statusResponse = await fetch(
      base + "/service-requests/" + createdPayload.item.id + "/status",
      {
        method: "PATCH",
        headers: { "content-type": "application/json", ...frontDeskHeaders },
        body: JSON.stringify({ status: "accepted" })
      }
    );
    assert.equal(statusResponse.status, 200);

    const transitionsResponse = await fetch(
      base + "/service-requests/" + createdPayload.item.id + "/transitions",
      { headers: frontDeskHeaders }
    );
    const transitionsPayload = (await transitionsResponse.json()) as {
      ok: boolean;
      items: Array<{ toStatus: string }>;
    };
    assert.equal(transitionsResponse.status, 200);
    assert.equal(transitionsPayload.ok, true);
    assert.equal(Array.isArray(transitionsPayload.items), true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((err) => (err ? reject(err) : resolve()))
    );
  }
});

test("queue filters, SLA refresh, and dashboard overview work", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);
  await createUser(hotelId, "front_desk", "fd+" + hotelId + "@test.local");
  await createUser(hotelId, "owner", "owner+" + hotelId + "@test.local");
  await createUser(hotelId, "fnb_manager", "fnb+" + hotelId + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;
  const frontDeskHeaders = await getAuthHeaders(
    base,
    hotelId,
    "fd+" + hotelId + "@test.local",
    "front_desk"
  );
  const ownerHeaders = await getAuthHeaders(
    base,
    hotelId,
    "owner+" + hotelId + "@test.local",
    "owner"
  );
  const fnbHeaders = await getAuthHeaders(
    base,
    hotelId,
    "fnb+" + hotelId + "@test.local",
    "fnb_manager"
  );

  const createResponse = await fetch(base + "/service-requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...frontDeskHeaders },
    body: JSON.stringify({
      guestName: "SLA Guest",
      guestPhone: "+919999001212",
      category: "front_desk",
      summary: "Need wake-up call",
      priority: "high",
      slaMinutes: 1
    })
  });
  const created = (await createResponse.json()) as { item: { id: string } };
  assert.equal(createResponse.status, 201);

  await prisma.serviceRequest.update({
    where: { id: created.item.id },
    data: { slaDueAt: new Date(Date.now() - 60_000) }
  });

  const refreshResponse = await fetch(base + "/service-requests/sla/refresh", {
    method: "POST",
    headers: ownerHeaders
  });
  const refreshPayload = (await refreshResponse.json()) as { ok: boolean; breachedMarked: number };
  assert.equal(refreshResponse.status, 200);
  assert.equal(refreshPayload.ok, true);
  assert.equal(refreshPayload.breachedMarked >= 1, true);

  const breachedListResponse = await fetch(
    base + "/service-requests?slaState=breached&assignedToMe=true",
    { headers: frontDeskHeaders }
  );
  const breachedList = (await breachedListResponse.json()) as {
    ok: boolean;
    items: Array<{ id: string }>;
    page: { total: number };
  };
  assert.equal(breachedListResponse.status, 200);
  assert.equal(breachedList.ok, true);
  assert.equal(breachedList.items.some((x) => x.id === created.item.id), true);
  assert.equal(breachedList.page.total >= 1, true);

  const dashboardResponse = await fetch(base + "/dashboard/overview", { headers: fnbHeaders });
  const dashboard = (await dashboardResponse.json()) as {
    ok: boolean;
    metrics: { openCount: number; slaBreachedOpenCount: number };
  };
  assert.equal(dashboardResponse.status, 200);
  assert.equal(dashboard.ok, true);
  assert.equal(dashboard.metrics.openCount >= 1, true);
  assert.equal(dashboard.metrics.slaBreachedOpenCount >= 1, true);

  const trendsResponse = await fetch(base + "/dashboard/trends?days=7", { headers: ownerHeaders });
  const trends = (await trendsResponse.json()) as {
    ok: boolean;
    days: number;
    series: Array<{ date: string; created: number; resolved: number }>;
  };
  assert.equal(trendsResponse.status, 200);
  assert.equal(trends.ok, true);
  assert.equal(trends.days, 7);
  assert.equal(trends.series.length, 7);

  const queueSummaryResponse = await fetch(base + "/dashboard/queue-summary", {
    headers: ownerHeaders
  });
  const queueSummary = (await queueSummaryResponse.json()) as {
    ok: boolean;
    totalOpen: number;
    byPriority: Record<string, number>;
  };
  assert.equal(queueSummaryResponse.status, 200);
  assert.equal(queueSummary.ok, true);
  assert.equal(queueSummary.totalOpen >= 1, true);
  assert.equal((queueSummary.byPriority.high ?? 0) >= 1, true);

  const usersResponse = await fetch(base + "/users?isActive=true&limit=10", {
    headers: ownerHeaders
  });
  const usersPayload = (await usersResponse.json()) as {
    ok: boolean;
    items: Array<{ email: string }>;
    page: { total: number };
  };
  assert.equal(usersResponse.status, 200);
  assert.equal(usersPayload.ok, true);
  assert.equal(usersPayload.page.total >= 3, true);
  assert.equal(usersPayload.items.some((u) => u.email === "fd+" + hotelId + "@test.local"), true);

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("public QR request intake creates service request", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;

  const createResponse = await fetch(base + "/public/requests", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hotelId,
      guestName: "QR Guest",
      guestPhone: "+919999009999",
      category: "housekeeping",
      summary: "Need extra pillows"
    })
  });
  const created = (await createResponse.json()) as {
    ok: boolean;
    item: { source: string; category: string; summary: string };
  };
  assert.equal(createResponse.status, 201);
  assert.equal(created.ok, true);
  assert.equal(created.item.source, "qr");
  assert.equal(created.item.category, "housekeeping");
  assert.equal(created.item.summary, "Need extra pillows");

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("whatsapp webhook skeleton creates request and returns ack", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;

  const webhookResponse = await fetch(base + "/integrations/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hotelId,
      fromPhone: "+919100000111",
      guestName: "WhatsApp Guest",
      message: "AC not working urgent"
    })
  });
  const webhookPayload = (await webhookResponse.json()) as {
    ok: boolean;
    connectorEventId: string;
    requestId: string | null;
    classification: { category: string; priority: string } | null;
    replySent: boolean;
  };
  assert.equal(webhookResponse.status, 202);
  assert.equal(webhookPayload.ok, true);
  assert.equal(typeof webhookPayload.connectorEventId, "string");
  assert.equal(typeof webhookPayload.classification?.category, "string");

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("whatsapp webhook normalization supports twilio payload", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;

  const webhookResponse = await fetch(base + "/integrations/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "twilio",
      hotelId,
      From: "whatsapp:+919100000222",
      Body: "Need fresh towels",
      ProfileName: "Twilio Guest"
    })
  });
  const payload = (await webhookResponse.json()) as { ok: boolean; connectorEventId: string; classification: { category: string } | null };
  assert.equal(webhookResponse.status, 202);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.connectorEventId, "string");

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("whatsapp webhook normalization supports interakt payload", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;

  const webhookResponse = await fetch(base + "/integrations/whatsapp/webhook", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      provider: "interakt",
      data: {
        hotelId,
        phone_number: "+919100000333",
        message: "AC issue in room 308",
        customer_name: "Interakt Guest"
      }
    })
  });
  const payload = (await webhookResponse.json()) as { ok: boolean; connectorEventId: string; classification: { category: string } | null };
  assert.equal(webhookResponse.status, 202);
  assert.equal(payload.ok, true);
  assert.equal(typeof payload.connectorEventId, "string");

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("analytics endpoints and connector registry return real payloads", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);
  await createUser(hotelId, "owner", "owner+" + hotelId + "@test.local");
  await createUser(hotelId, "front_desk", "fd+" + hotelId + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;
  const ownerHeaders = await getAuthHeaders(
    base,
    hotelId,
    "owner+" + hotelId + "@test.local",
    "owner"
  );
  const frontDeskHeaders = await getAuthHeaders(
    base,
    hotelId,
    "fd+" + hotelId + "@test.local",
    "front_desk"
  );

  await fetch(base + "/service-requests", {
    method: "POST",
    headers: { "content-type": "application/json", ...frontDeskHeaders },
    body: JSON.stringify({
      guestName: "Analytics Guest",
      guestPhone: "+919111111111",
      category: "housekeeping",
      summary: "Need drinking water"
    })
  });

  const revenueRes = await fetch(base + "/analytics/revenue-intelligence", { headers: ownerHeaders });
  const revenue = (await revenueRes.json()) as {
    ok: boolean;
    totals: { sentOffers: number };
    funnel: { sent: number };
  };
  assert.equal(revenueRes.status, 200);
  assert.equal(revenue.ok, true);
  assert.equal(typeof revenue.totals.sentOffers, "number");
  assert.equal(typeof revenue.funnel.sent, "number");

  const staffRes = await fetch(base + "/analytics/staff-performance", { headers: ownerHeaders });
  const staff = (await staffRes.json()) as {
    ok: boolean;
    summary: { completionRate: number };
    leaderboard: Array<{ fullName: string }>;
  };
  assert.equal(staffRes.status, 200);
  assert.equal(staff.ok, true);
  assert.equal(typeof staff.summary.completionRate, "number");
  assert.equal(Array.isArray(staff.leaderboard), true);

  const connectorsRes = await fetch(base + "/connectors/registry", { headers: ownerHeaders });
  const connectors = (await connectorsRes.json()) as {
    ok: boolean;
    items: Array<{ key: string; status: string }>;
  };
  assert.equal(connectorsRes.status, 200);
  assert.equal(connectors.ok, true);
  assert.equal(connectors.items.length > 0, true);

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});

test("connector configs are persisted per hotel and reflected in registry", async () => {
  const hotelId = uniqueHotelId();
  await createHotel(hotelId);
  await createUser(hotelId, "owner", "owner+" + hotelId + "@test.local");

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind test server");
  }
  const base = "http://127.0.0.1:" + address.port;
  const ownerHeaders = await getAuthHeaders(
    base,
    hotelId,
    "owner+" + hotelId + "@test.local",
    "owner"
  );

  const putResponse = await fetch(base + "/connectors/configs/whatsapp_twilio", {
    method: "PUT",
    headers: { "content-type": "application/json", ...ownerHeaders },
    body: JSON.stringify({
      enabled: true,
      config: {
        accountSid: "AC123",
        authToken: "secret-token-value",
        webhookPath: "/integrations/whatsapp/webhook"
      }
    })
  });
  const putPayload = (await putResponse.json()) as {
    ok: boolean;
    item: { enabled: boolean; config: { authToken: string } };
  };
  assert.equal(putResponse.status, 200);
  assert.equal(putPayload.ok, true);
  assert.equal(putPayload.item.enabled, true);
  assert.equal(putPayload.item.config.authToken, "***");

  const listResponse = await fetch(base + "/connectors/configs", { headers: ownerHeaders });
  const listPayload = (await listResponse.json()) as {
    ok: boolean;
    items: Array<{ key: string; enabled: boolean }>;
  };
  assert.equal(listResponse.status, 200);
  assert.equal(listPayload.ok, true);
  assert.equal(listPayload.items.some((x) => x.key === "whatsapp_twilio" && x.enabled), true);

  const registryResponse = await fetch(base + "/connectors/registry", { headers: ownerHeaders });
  const registryPayload = (await registryResponse.json()) as {
    ok: boolean;
    items: Array<{ key: string; enabled: boolean; source: string }>;
  };
  assert.equal(registryResponse.status, 200);
  assert.equal(registryPayload.ok, true);
  assert.equal(
    registryPayload.items.some(
      (x) => x.key === "whatsapp_twilio" && x.enabled === true && x.source === "hotel_config"
    ),
    true
  );

  const deleteResponse = await fetch(base + "/connectors/configs/whatsapp_twilio", {
    method: "DELETE",
    headers: ownerHeaders
  });
  const deletePayload = (await deleteResponse.json()) as { ok: boolean };
  assert.equal(deleteResponse.status, 200);
  assert.equal(deletePayload.ok, true);

  await new Promise<void>((resolve, reject) =>
    server.close((err) => (err ? reject(err) : resolve()))
  );
});
