import "dotenv/config";
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const HOTEL_ID = "eynis-riviera-1";

// Permission sets per role key
const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    "invite_users","manage_users","manage_roles","create_custom_roles","manage_billing",
    "manage_settings","view_reports","manage_requests","view_requests","manage_automations",
    "view_guests","manage_guests","night_audit","manage_connectors","manage_campaigns",
    "manage_inventory","view_crm","manage_crm"
  ],
  manager: [
    "invite_users","view_reports","manage_requests","view_requests","manage_automations",
    "view_guests","manage_guests","night_audit","manage_connectors","manage_campaigns","manage_settings",
    "manage_inventory","view_crm","manage_crm"
  ],
  supervisor: ["view_reports","manage_requests","view_requests","view_guests","manage_guests","manage_campaigns","view_crm","manage_crm"],
  agent:  ["view_requests","manage_requests","view_guests","view_crm","manage_crm"],
  viewer: ["view_reports","view_requests","view_guests","view_crm"],
};

// Old UserRole → new Role.key (for mapping staff users)
const LEGACY_TO_KEY: Record<string, string> = {
  owner: "admin", front_desk: "manager", fnb_manager: "supervisor", housekeeping: "agent"
};

// ── Demo IT / Tech Corporate help desk (#166) ────────────────────────────────
// A demo tenant that exercises the IT_HELPDESK pack end-to-end with REAL tickets
// (ServiceRequests) across incident/access/hardware/software/facilities/hr_ops,
// plus the email/webhook ConnectorEvents that produced them.
const ITDESK_ID = "eynis-northwind-1";

async function seedItDesk() {
  await prisma.serviceRequest.deleteMany({ where: { tenantId: ITDESK_ID } });
  await prisma.connectorEvent.deleteMany({ where: { tenantId: ITDESK_ID } });
  await prisma.automationRule.deleteMany({ where: { tenantId: ITDESK_ID } });
  await prisma.contact.deleteMany({ where: { tenantId: ITDESK_ID } });
  await prisma.user.deleteMany({ where: { tenantId: ITDESK_ID } });
  await prisma.role.deleteMany({ where: { tenantId: ITDESK_ID } });
  await prisma.license.deleteMany({ where: { tenantId: ITDESK_ID } });

  await prisma.tenant.upsert({
    where: { id: ITDESK_ID },
    update: { name: "Northwind Corp", industry: "it_services", timezone: "Asia/Kolkata" },
    create: { id: ITDESK_ID, name: "Northwind Corp", industry: "it_services", timezone: "Asia/Kolkata" },
  });
  await prisma.license.create({ data: { tenantId: ITDESK_ID, plan: "growth", maxSeats: 25 } });

  const roleIdByKey: Record<string, string> = {};
  for (const [key, permissions] of Object.entries(ROLE_PERMISSIONS)) {
    const r = await prisma.role.create({
      data: { tenantId: ITDESK_ID, key, displayName: key[0].toUpperCase() + key.slice(1), permissions: JSON.stringify(permissions), isSystem: true, isCustom: false },
    });
    roleIdByKey[key] = r.id;
  }

  const userDefs = [
    { email: "it.admin@northwind.example", fullName: "IT Admin", legacy: "owner", key: "admin" },
    { email: "it.lead@northwind.example", fullName: "Service Desk Lead", legacy: "fnb_manager", key: "supervisor" },
    { email: "it.agent@northwind.example", fullName: "Support Engineer", legacy: "housekeeping", key: "agent" },
  ];
  const userIdByEmail: Record<string, string> = {};
  for (const u of userDefs) {
    const created = await prisma.user.create({
      data: { tenantId: ITDESK_ID, email: u.email, fullName: u.fullName, role: u.legacy, roleId: roleIdByKey[u.key], isActive: true },
    });
    userIdByEmail[u.email] = created.id;
  }

  // Employees who raised tickets, keyed the way the email intake door (#162) dedupes
  // a sender (email:<addr>).
  const employeeDefs = [
    { key: "email:alice.k@northwind.example", name: "Alice Kapoor" },
    { key: "email:raj.m@northwind.example", name: "Raj Menon" },
    { key: "email:sara.d@northwind.example", name: "Sara Dsouza" },
    { key: "email:tom.f@northwind.example", name: "Tom Fernandes" },
    { key: "email:neha.s@northwind.example", name: "Neha Sharma" },
  ];
  const contactIdByKey: Record<string, string> = {};
  for (const e of employeeDefs) {
    const c = await prisma.contact.create({
      data: { tenantId: ITDESK_ID, fullName: e.name, phoneE164: e.key, email: e.key.replace(/^email:/, ""), source: "connector" },
    });
    contactIdByKey[e.key] = c.id;
  }

  const now = new Date();
  const ago = (m: number) => new Date(now.getTime() - m * 60000);

  type Ticket = {
    who: string; category: string; summary: string;
    status: "open" | "accepted" | "resolved" | "escalated";
    priority: "normal" | "high" | "urgent";
    createdMinsAgo: number; slaMinutes: number; resolvedMinsAgo?: number; breached?: boolean; assignEmail?: string;
  };
  const ticketDefs: Ticket[] = [
    { who: "email:alice.k@northwind.example", category: "incident", summary: "VPN gateway down — the whole finance team cannot connect", status: "escalated", priority: "urgent", createdMinsAgo: 120, slaMinutes: 15, breached: true },
    { who: "email:raj.m@northwind.example", category: "access", summary: "Password reset and MFA re-enrollment for a new starter", status: "open", priority: "high", createdMinsAgo: 35, slaMinutes: 30 },
    { who: "email:sara.d@northwind.example", category: "hardware", summary: "Laptop won't power on — suspected charger or battery fault", status: "open", priority: "high", createdMinsAgo: 22, slaMinutes: 30 },
    { who: "email:tom.f@northwind.example", category: "software", summary: "Outlook crashing on launch after the latest update", status: "accepted", priority: "normal", createdMinsAgo: 18, slaMinutes: 240, assignEmail: "it.agent@northwind.example" },
    { who: "email:neha.s@northwind.example", category: "facilities", summary: "Meeting room 3 air conditioning not working", status: "open", priority: "normal", createdMinsAgo: 60, slaMinutes: 240 },
    { who: "email:raj.m@northwind.example", category: "hr_ops", summary: "Onboarding access bundle for a new hire (email, SSO, laptop)", status: "resolved", priority: "normal", createdMinsAgo: 600, slaMinutes: 240, resolvedMinsAgo: 480 },
    { who: "email:alice.k@northwind.example", category: "incident", summary: "Shared drive was briefly offline — restored, monitoring", status: "resolved", priority: "high", createdMinsAgo: 800, slaMinutes: 30, resolvedMinsAgo: 770 },
  ];

  const ticketIdByWhoCat: Record<string, string> = {};
  for (const t of ticketDefs) {
    const createdAt = ago(t.createdMinsAgo);
    const sr = await prisma.serviceRequest.create({
      data: {
        tenantId: ITDESK_ID,
        guestId: contactIdByKey[t.who],
        category: t.category,
        summary: t.summary,
        status: t.status,
        priority: t.priority,
        source: "email_inbound",
        slaDueAt: new Date(createdAt.getTime() + t.slaMinutes * 60000),
        slaBreachedAt: t.breached ? new Date(createdAt.getTime() + t.slaMinutes * 60000) : null,
        assignedToUserId: t.assignEmail ? (userIdByEmail[t.assignEmail] ?? null) : null,
        createdAt,
        resolvedAt: t.resolvedMinsAgo !== undefined ? ago(t.resolvedMinsAgo) : null,
      },
      select: { id: true },
    });
    ticketIdByWhoCat[`${t.who}:${t.category}:${t.createdMinsAgo}`] = sr.id;
  }

  // ConnectorEvents — the real intake that produced two of the tickets (email + webhook).
  await prisma.connectorEvent.create({
    data: {
      tenantId: ITDESK_ID, connectorKey: "email_inbound", eventType: "inbound_signal",
      guestPhone: "email:alice.k@northwind.example", guestName: "Alice Kapoor",
      guestId: contactIdByKey["email:alice.k@northwind.example"],
      aiProvider: "keyword", aiCategory: "incident", aiPriority: "urgent",
      aiSummary: "VPN gateway down — finance team cannot connect", aiSentiment: "negative",
      aiRoutingHint: "it", aiSlaMinutes: 15,
      serviceRequestId: ticketIdByWhoCat["email:alice.k@northwind.example:incident:120"],
      replyStatus: "no_reply_needed",
      rawPayload: JSON.stringify({ tenantId: ITDESK_ID, from: "alice.k@northwind.example", subject: "VPN down", text: "The VPN gateway is offline, the whole finance team cannot connect." }),
    },
  });
  await prisma.connectorEvent.create({
    data: {
      tenantId: ITDESK_ID, connectorKey: "webhook", eventType: "inbound_signal",
      guestPhone: "email:sara.d@northwind.example", guestName: "Sara Dsouza",
      guestId: contactIdByKey["email:sara.d@northwind.example"],
      aiProvider: "keyword", aiCategory: "hardware", aiPriority: "high",
      aiSummary: "Laptop won't power on — charger/battery fault", aiSentiment: "neutral",
      aiRoutingHint: "it", aiSlaMinutes: 30,
      serviceRequestId: ticketIdByWhoCat["email:sara.d@northwind.example:hardware:22"],
      replyStatus: "no_reply_needed",
      rawPayload: JSON.stringify({ tenantId: ITDESK_ID, message: "My laptop will not power on, I think the charger is dead", contact: { email: "sara.d@northwind.example", name: "Sara Dsouza" } }),
    },
  });

  await prisma.automationRule.create({ data: { tenantId: ITDESK_ID, code: "sla_breach_escalate", name: "SLA Breach → Auto-Escalate", isActive: true, configJson: JSON.stringify({ ruleType: "operational", trigger: { type: "sla_breach" }, action: { type: "escalate_sr" } }) } });
  await prisma.automationRule.create({ data: { tenantId: ITDESK_ID, code: "sentiment_low_flag", name: "Negative Sentiment → Flag for Review", isActive: true, configJson: JSON.stringify({ ruleType: "operational", trigger: { type: "sentiment_low", params: { threshold: 2 } }, action: { type: "create_sr" } }) } });

  console.log("✓ Seed complete — Northwind Corp IT help desk loaded (it_services demo).");
}

async function main() {
  // ── Clear existing data for clean seed ────────────────────────────────────
  await prisma.automationExecution.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.connectorEvent.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.serviceRequestTransition.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.serviceRequest.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.offerEvent.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.automationRule.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.auditLog.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.stay.deleteMany({ where: { tenantId: HOTEL_ID } });

  // ── Hotel ──────────────────────────────────────────────────────────────────
  const hotel = await prisma.tenant.upsert({
    where: { id: HOTEL_ID },
    update: { name: "The Riviera", timezone: "Asia/Kolkata" },
    create: { id: HOTEL_ID, name: "The Riviera", timezone: "Asia/Kolkata" }
  });

  // ── License (Growth, 25 seats, 1-year term) ───────────────────────────────
  await prisma.license.upsert({
    where: { tenantId: HOTEL_ID },
    update: { plan: "growth", maxSeats: 25 },
    create: {
      tenantId: HOTEL_ID,
      plan: "growth",
      maxSeats: 25,
      renewsAt: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000)
    }
  });

  // ── System roles (5 defaults) ──────────────────────────────────────────────
  const ROLE_DISPLAY: Record<string, string> = {
    admin: "Admin", manager: "Manager", supervisor: "Supervisor",
    agent: "Agent", viewer: "Viewer"
  };
  const roleIdMap: Record<string, string> = {};
  for (const [key, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const r = await prisma.role.upsert({
      where: { tenantId_key: { tenantId: HOTEL_ID, key } },
      // Keep system-role permissions in sync on re-seed (they aren't user-editable).
      update: { permissions: JSON.stringify(perms), isSystem: true, isCustom: false },
      create: {
        tenantId: HOTEL_ID,
        key,
        displayName: ROLE_DISPLAY[key] ?? key,
        permissions: JSON.stringify(perms),
        isSystem: true,
        isCustom: false
      }
    });
    roleIdMap[key] = r.id;
  }

  // ── Staff users (with roleId wired to new system roles) ───────────────────
  const staff = [
    { email: "vikram@theriviera.com", fullName: "Vikram Mehta",    role: "owner"       as const },
    { email: "sarah@theriviera.com",  fullName: "Sarah Jenkins",   role: "front_desk"  as const },
    { email: "amit@theriviera.com",   fullName: "Amit Sharma",     role: "housekeeping"as const },
    { email: "sanya@theriviera.com",  fullName: "Sanya Kapoor",    role: "housekeeping"as const },
    { email: "marcus@theriviera.com", fullName: "Marcus Vane",     role: "front_desk"  as const },
    { email: "elena@theriviera.com",  fullName: "Elena Rodriguez", role: "housekeeping"as const },
    { email: "david@theriviera.com",  fullName: "David Ling",      role: "fnb_manager" as const }
  ];

  const userMap: Record<string, string> = {};
  for (const s of staff) {
    const key = LEGACY_TO_KEY[s.role] ?? "agent";
    const u = await prisma.user.upsert({
      where: { tenantId_email: { tenantId: hotel.id, email: s.email } },
      update: { roleId: roleIdMap[key] },
      create: {
        tenantId: hotel.id,
        fullName: s.fullName,
        email: s.email,
        role: s.role,
        roleId: roleIdMap[key]
      }
    });
    userMap[s.email] = u.id;
  }

  // ── Guests ─────────────────────────────────────────────────────────────────
  await prisma.contact.deleteMany({ where: { tenantId: HOTEL_ID } });

  const guestDefs = [
    { phone: "+919876540001", name: "Elena Soros", visits: 14 },
    { phone: "+919876540002", name: "Julian Marc", visits: 3 },
    { phone: "+919876540003", name: "Aria Wade", visits: 8 },
    { phone: "+919876540004", name: "David Bloom", visits: 22 },
    { phone: "+919876540005", name: "Priya Nair", visits: 5 },
    { phone: "+919876540006", name: "James Thornton", visits: 1 },
    { phone: "+919876540007", name: "Meera Pillai", visits: 9 },
    { phone: "+919876540008", name: "Aditya Rao", visits: 2 },
    { phone: "+919876540009", name: "Sophie Laurent", visits: 6 },
    { phone: "+919876540010", name: "Rajan Gupta", visits: 4 }
  ];

  const guestMap: Record<string, string> = {};
  for (const g of guestDefs) {
    const guest = await prisma.contact.create({
      data: { tenantId: hotel.id, fullName: g.name, phoneE164: g.phone, visitCount: g.visits }
    });
    guestMap[g.phone] = guest.id;
  }

  // ── Service requests ───────────────────────────────────────────────────────
  const now = new Date();
  const ago = (m: number) => new Date(now.getTime() - m * 60000);

  type RequestDef = {
    category: string;
    summary: string;
    status: "open" | "accepted" | "resolved" | "escalated";
    priority: "normal" | "high" | "urgent";
    guestPhone: string;
    createdMinsAgo: number;
    resolvedMinsAgo?: number;
    assignedEmail?: string;
  };

  const requestDefs: RequestDef[] = [
    {
      category: "housekeeping",
      summary: "2x Extra pillows and clean towels",
      status: "open",
      priority: "normal",
      guestPhone: "+919876540002",
      createdMinsAgo: 12,
      assignedEmail: "amit@theriviera.com"
    },
    {
      category: "maintenance",
      summary: "AC leak in bedroom — water dripping from unit",
      status: "accepted",
      priority: "high",
      guestPhone: "+919876540003",
      createdMinsAgo: 28,
      assignedEmail: "sanya@theriviera.com"
    },
    {
      category: "fnb",
      summary: "In-room dining order delayed — Order open >45 mins",
      status: "escalated",
      priority: "urgent",
      guestPhone: "+919876540005",
      createdMinsAgo: 52,
      assignedEmail: "david@theriviera.com"
    },
    {
      category: "concierge",
      summary: "Valet pick-up request for 3 PM departure",
      status: "open",
      priority: "normal",
      guestPhone: "+919876540006",
      createdMinsAgo: 8,
      assignedEmail: "marcus@theriviera.com"
    },
    {
      category: "housekeeping",
      summary: "Towel replacement request",
      status: "open",
      priority: "normal",
      guestPhone: "+919876540001",
      createdMinsAgo: 2,
      assignedEmail: undefined
    },
    {
      category: "maintenance",
      summary: "TV remote not working — needs replacement",
      status: "resolved",
      priority: "normal",
      guestPhone: "+919876540008",
      createdMinsAgo: 90,
      resolvedMinsAgo: 70,
      assignedEmail: "marcus@theriviera.com"
    },
    {
      category: "housekeeping",
      summary: "Mini-bar restock — full restocking required",
      status: "resolved",
      priority: "normal",
      guestPhone: "+919876540004",
      createdMinsAgo: 110,
      resolvedMinsAgo: 96,
      assignedEmail: "sanya@theriviera.com"
    },
    {
      category: "maintenance",
      summary: "HVAC repair — heating not working in suite",
      status: "resolved",
      priority: "high",
      guestPhone: "+919876540009",
      createdMinsAgo: 200,
      resolvedMinsAgo: 177,
      assignedEmail: "david@theriviera.com"
    },
    {
      category: "housekeeping",
      summary: "Champagne service delivery — Suite 402",
      status: "resolved",
      priority: "normal",
      guestPhone: "+919876540001",
      createdMinsAgo: 260,
      resolvedMinsAgo: 244,
      assignedEmail: "sarah@theriviera.com"
    },
    {
      category: "maintenance",
      summary: "Technical: TV Setup assistance",
      status: "resolved",
      priority: "normal",
      guestPhone: "+919876540007",
      createdMinsAgo: 320,
      resolvedMinsAgo: 298,
      assignedEmail: "marcus@theriviera.com"
    }
  ];

  for (const r of requestDefs) {
    const guestId = guestMap[r.guestPhone];
    if (!guestId) continue;
    const assignedToUserId = r.assignedEmail ? (userMap[r.assignedEmail] ?? null) : null;
    const createdAt = ago(r.createdMinsAgo);
    const slaDueAt = new Date(createdAt.getTime() + 45 * 60000);
    const resolvedAt = r.resolvedMinsAgo !== undefined ? ago(r.resolvedMinsAgo) : null;

    await prisma.serviceRequest.create({
      data: {
        tenantId: hotel.id,
        guestId,
        category: r.category,
        summary: r.summary,
        status: r.status,
        priority: r.priority,
        slaDueAt,
        assignedToUserId,
        createdAt,
        resolvedAt
      }
    });
  }

  // ── Offer events ───────────────────────────────────────────────────────────
  const offerTypes = ["room_upgrade", "late_checkout", "fnb_offer", "spa_offer", "airport_transfer"];
  const offerStatuses = ["sent", "opened", "accepted", "declined"];
  const revenueByType: Record<string, number> = {
    room_upgrade: 4200,
    late_checkout: 1600,
    fnb_offer: 2800,
    spa_offer: 1900,
    airport_transfer: 1100
  };

  const guestIds = Object.values(guestMap);
  for (let i = 0; i < 80; i++) {
    const offerType = offerTypes[i % offerTypes.length];
    const hoursAgo = Math.floor((i * 17 + 3) % 720);
    const createdAt = new Date(now.getTime() - hoursAgo * 3600000);
    const status = offerStatuses[i % offerStatuses.length];
    const revenueInr = status === "accepted" ? revenueByType[offerType] : 0;
    const guestId = guestIds[i % guestIds.length];

    await prisma.offerEvent.create({
      data: {
        tenantId: hotel.id,
        guestId,
        offerType,
        channel: i % 2 === 0 ? "whatsapp" : "sms",
        status,
        revenueInr,
        contextJson: JSON.stringify({ automationType: offerType, day: i }),
        createdAt
      }
    });
  }

  // ── Automation rules ───────────────────────────────────────────────────────
  // Marketing-style rules with historical stats
  const marketingRules = [
    { code: "pre_arrival_welcome", name: "Pre-Arrival Welcome", active: true, executions: 2450, conversions: 794, revenue: 84200,
      trigger: { type: "checkin_within_days", params: { days: 2 } }, action: { type: "send_whatsapp", params: { template: "welcome" } } },
    { code: "checkin_breakfast_bundle", name: "Early Check-in Breakfast Bundle", active: true, executions: 1120, conversions: 461, revenue: 32500,
      trigger: { type: "checkin_event" }, action: { type: "send_whatsapp", params: { template: "breakfast_bundle" } } },
    { code: "spa_happy_hour", name: "Spa Happy Hour Re-marketing", active: false, executions: 840, conversions: 155, revenue: 15100,
      trigger: { type: "schedule", params: { cronExpr: "0 14 * * *" } }, action: { type: "send_whatsapp", params: { template: "spa_offer" } } },
    { code: "late_checkout_upsell", name: "Late Checkout Upsell", active: true, executions: 1890, conversions: 623, revenue: 48000,
      trigger: { type: "departure_eve" }, action: { type: "send_whatsapp", params: { template: "late_checkout" } } },
    { code: "post_stay_review", name: "Post-Stay Review", active: true, executions: 1200, conversions: 588, revenue: 0,
      trigger: { type: "checkout_event" }, action: { type: "send_whatsapp", params: { template: "review_request" } } }
  ];

  const ruleMap: Record<string, string> = {};
  for (const a of marketingRules) {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: hotel.id,
        code: a.code,
        name: a.name,
        isActive: a.active,
        configJson: JSON.stringify({
          ruleType: "marketing",
          trigger: a.trigger,
          action: a.action,
          stats: { executions: a.executions, conversions: a.conversions, revenueInr: a.revenue }
        })
      }
    });
    ruleMap[a.code] = rule.id;
  }

  // Operational rules — evaluated by the automation engine every 60s
  const operationalRules = [
    { code: "sla_breach_escalate", name: "SLA Breach → Auto-Escalate", active: true,
      trigger: { type: "sla_breach" }, action: { type: "escalate_sr" } },
    { code: "sentiment_low_flag", name: "Negative Sentiment → Flag for Review", active: true,
      trigger: { type: "sentiment_low", params: { threshold: 2 } },
      action: { type: "create_sr", params: { category: "front_desk", priority: "high" } } },
    { code: "checkin_welcome", name: "Check-in → Welcome WhatsApp", active: true,
      trigger: { type: "checkin_within_minutes", params: { minutes: 30 } },
      action: { type: "send_whatsapp", params: { template: "welcome" } } },
    { code: "upsell_followup", name: "Resolved Request → Queue Upsell", active: true,
      trigger: { type: "sr_resolved_within_hours", params: { hours: 2 } },
      action: { type: "queue_offer" } }
  ];

  for (const a of operationalRules) {
    const rule = await prisma.automationRule.create({
      data: {
        tenantId: hotel.id,
        code: a.code,
        name: a.name,
        isActive: a.active,
        configJson: JSON.stringify({ ruleType: "operational", trigger: a.trigger, action: a.action })
      }
    });
    ruleMap[a.code] = rule.id;
  }

  // ── Seed automation executions (realistic history) ─────────────────────────
  const executionDefs = [
    { ruleCode: "sla_breach_escalate", triggerType: "sla_breach", actionType: "escalate_sr",
      actionResult: "success", resultDetail: "Escalated: In-room dining order delayed — Order open >45 mins", minsAgo: 52 },
    { ruleCode: "sla_breach_escalate", triggerType: "sla_breach", actionType: "escalate_sr",
      actionResult: "success", resultDetail: "Escalated: AC leak in bedroom — water dripping from unit", minsAgo: 130 },
    { ruleCode: "sentiment_low_flag", triggerType: "sentiment_low", actionType: "create_sr",
      actionResult: "success", resultDetail: "Created SR for Arjun Kapoor — urgent negative feedback", minsAgo: 8 },
    { ruleCode: "checkin_welcome", triggerType: "checkin_welcome", actionType: "send_whatsapp",
      actionResult: "success", resultDetail: "Welcome sent to +919876540006", minsAgo: 9 },
    { ruleCode: "checkin_welcome", triggerType: "checkin_welcome", actionType: "send_whatsapp",
      actionResult: "failed", resultDetail: "No WhatsApp provider configured", minsAgo: 140 },
    { ruleCode: "upsell_followup", triggerType: "upsell_followup", actionType: "queue_offer",
      actionResult: "success", resultDetail: "Queued room_upgrade offer", minsAgo: 72 },
    { ruleCode: "upsell_followup", triggerType: "upsell_followup", actionType: "queue_offer",
      actionResult: "success", resultDetail: "Queued fnb_offer offer", minsAgo: 98 },
    { ruleCode: "upsell_followup", triggerType: "upsell_followup", actionType: "queue_offer",
      actionResult: "success", resultDetail: "Queued late_checkout offer", minsAgo: 180 }
  ];

  for (const ex of executionDefs) {
    const ruleId = ruleMap[ex.ruleCode];
    if (!ruleId) continue;
    await prisma.automationExecution.create({
      data: {
        tenantId: hotel.id,
        ruleId,
        ruleCode: ex.ruleCode,
        triggerType: ex.triggerType,
        actionType: ex.actionType,
        actionResult: ex.actionResult,
        resultDetail: ex.resultDetail,
        executedAt: ago(ex.minsAgo)
      }
    });
  }

  // ── Connector events (inbound pipeline demo data) ─────────────────────────
  const connectorEventsData = [
    {
      connectorKey: "whatsapp_twilio",
      guestPhone: "+919876543210",
      guestName: "Rahul Sharma",
      aiCategory: "housekeeping",
      aiPriority: "normal",
      aiSummary: "Guest requests extra towels and blanket for room 302",
      aiSentiment: "neutral",
      aiRoutingHint: "Housekeeping team",
      aiSlaMinutes: 30,
      aiProvider: "claude",
      replyStatus: "sent",
      replySentAt: new Date(Date.now() - 45 * 60000),
      replyMessage: "Hi Rahul! We've received your request and our team is on it.\n\n\"Guest requests extra towels and blanket for room 302\"\n\nRef: #A1B2C3 — The Riviera"
    },
    {
      connectorKey: "whatsapp_interakt",
      guestPhone: "+919812345678",
      guestName: "Priya Nair",
      aiCategory: "fnb",
      aiPriority: "normal",
      aiSummary: "Guest ordering dal makhani, butter naan and mango lassi via room service",
      aiSentiment: "positive",
      aiRoutingHint: "F&B / Room Service team",
      aiSlaMinutes: 25,
      aiProvider: "claude",
      replyStatus: "sent",
      replySentAt: new Date(Date.now() - 22 * 60000),
      replyMessage: "Hi Priya! We've received your order and our kitchen is preparing it now.\n\nRef: #D4E5F6 — The Riviera"
    },
    {
      connectorKey: "whatsapp_twilio",
      guestPhone: "+919988776655",
      guestName: "Arjun Kapoor",
      aiCategory: "maintenance",
      aiPriority: "urgent",
      aiSummary: "AC not working in room 506 — urgent, guest very uncomfortable",
      aiSentiment: "negative",
      aiRoutingHint: "Maintenance team — urgent escalation",
      aiSlaMinutes: 10,
      aiProvider: "claude",
      replyStatus: "sent",
      replySentAt: new Date(Date.now() - 8 * 60000),
      replyMessage: "Hi Arjun! We've received your urgent request and our maintenance team is on their way.\n\nRef: #G7H8I9 — The Riviera"
    },
    {
      connectorKey: "whatsapp_twilio",
      guestPhone: "+919765432109",
      guestName: "Meera Iyer",
      aiCategory: "concierge",
      aiPriority: "normal",
      aiSummary: "Guest requesting taxi to airport at 6am tomorrow morning",
      aiSentiment: "neutral",
      aiRoutingHint: "Concierge / Front Desk",
      aiSlaMinutes: 60,
      aiProvider: "openai",
      replyStatus: "sent",
      replySentAt: new Date(Date.now() - 3 * 60000),
      replyMessage: "Hi Meera! We've noted your taxi request for 6am and our concierge will confirm the booking shortly.\n\nRef: #J1K2L3 — The Riviera"
    },
    {
      connectorKey: "whatsapp_interakt",
      guestPhone: "+919654321098",
      guestName: "Vikrant Bose",
      aiCategory: "front_desk",
      aiPriority: "high",
      aiSummary: "Guest requesting early check-in at 10am, arriving from Mumbai",
      aiSentiment: "neutral",
      aiRoutingHint: "Front Desk",
      aiSlaMinutes: 20,
      aiProvider: "claude",
      replyStatus: "failed: No WhatsApp provider configured",
      replySentAt: null,
      replyMessage: null
    }
  ];

  for (const ev of connectorEventsData) {
    await prisma.connectorEvent.create({
      data: {
        tenantId: hotel.id,
        connectorKey: ev.connectorKey,
        eventType: "inbound_message",
        guestPhone: ev.guestPhone,
        guestName: ev.guestName,
        rawPayload: JSON.stringify({ tenantId: hotel.id, fromPhone: ev.guestPhone, message: ev.aiSummary }),
        aiProvider: ev.aiProvider,
        aiCategory: ev.aiCategory,
        aiPriority: ev.aiPriority,
        aiSummary: ev.aiSummary,
        aiSentiment: ev.aiSentiment,
        aiRoutingHint: ev.aiRoutingHint,
        aiSlaMinutes: ev.aiSlaMinutes,
        replySentAt: ev.replySentAt ?? undefined,
        replyStatus: ev.replyStatus,
        replyMessage: ev.replyMessage ?? undefined,
        createdAt: new Date(Date.now() - Math.floor(Math.random() * 120) * 60000)
      }
    });
  }

  // ── CRM: default pipeline + demo deals (Increment A) ─────────────────────────
  await prisma.dealTransition.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.deal.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.stage.deleteMany({ where: { tenantId: HOTEL_ID } });
  await prisma.pipeline.deleteMany({ where: { tenantId: HOTEL_ID } });

  const DEFAULT_STAGES = [
    { name: "Lead In", order: 0, probability: 10, isWon: false, isLost: false },
    { name: "Qualified", order: 1, probability: 30, isWon: false, isLost: false },
    { name: "Proposal", order: 2, probability: 60, isWon: false, isLost: false },
    { name: "Negotiation", order: 3, probability: 80, isWon: false, isLost: false },
    { name: "Won", order: 4, probability: 100, isWon: true, isLost: false },
    { name: "Lost", order: 5, probability: 0, isWon: false, isLost: true },
  ];

  const pipeline = await prisma.pipeline.create({
    data: {
      tenantId: hotel.id, name: "Sales Pipeline", isDefault: true,
      stages: { create: DEFAULT_STAGES.map((s) => ({ tenantId: hotel.id, ...s })) },
    },
    include: { stages: { orderBy: { order: "asc" } } },
  });
  const stageByName: Record<string, string> = {};
  for (const s of pipeline.stages) stageByName[s.name] = s.id;

  const dealOwners = [userMap["vikram@theriviera.com"], userMap["sarah@theriviera.com"], userMap["marcus@theriviera.com"]].filter(Boolean);
  const dealGuestIds = Object.values(guestMap);
  const dayMs = 24 * 60 * 60 * 1000;

  // Companies are created before deals so B2B deals can be linked to them
  // (companyId). They're also reused by the contact-enrichment step below.
  await prisma.company.deleteMany({ where: { tenantId: HOTEL_ID } });
  const companyDefs = [
    { name: "Meridian Events Pvt Ltd", domain: "meridianevents.in", industry: "Events", size: "51-200" },
    { name: "Northwind Tours", domain: "northwindtours.com", industry: "Travel", size: "11-50" },
    { name: "Apex Pharma", domain: "apexpharma.co", industry: "Healthcare", size: "200+" },
  ];
  const companyIds: string[] = [];
  for (const c of companyDefs) {
    const company = await prisma.company.create({
      data: { tenantId: hotel.id, ownerId: dealOwners[0] ?? null, ...c },
    });
    companyIds.push(company.id);
  }

  // `company` indexes into companyDefs above (null = no company on the deal).
  const dealDefs = [
    { title: "Corporate retreat — 30 rooms", value: 850000, stage: "Lead In", closeInDays: 25, guest: 0, company: 0 },
    { title: "Wedding package — Grand Ballroom", value: 1200000, stage: "Qualified", closeInDays: 18, guest: 1, company: 0 },
    { title: "Q3 conference block booking", value: 640000, stage: "Qualified", closeInDays: 40, guest: 2, company: 1 },
    { title: "Annual loyalty suite upgrade", value: 220000, stage: "Proposal", closeInDays: 10, guest: 3, company: null },
    { title: "Spa & dining membership — VIP", value: 180000, stage: "Proposal", closeInDays: 12, guest: 4, company: null },
    { title: "Film crew long-stay (3 weeks)", value: 980000, stage: "Negotiation", closeInDays: 6, guest: 5, company: 2 },
    { title: "New Year gala — full property", value: 1500000, stage: "Negotiation", closeInDays: 8, guest: 6, company: 0 },
    { title: "Diwali corporate gifting + stay", value: 410000, stage: "Won", closeInDays: -3, guest: 7, company: 2 },
    { title: "Off-site team workshop", value: 150000, stage: "Lost", closeInDays: -8, guest: 8, company: 1 },
  ];
  for (let i = 0; i < dealDefs.length; i++) {
    const d = dealDefs[i];
    const stageId = stageByName[d.stage];
    const isWon = d.stage === "Won";
    const isLost = d.stage === "Lost";
    const status = isWon ? "won" : isLost ? "lost" : "open";
    await prisma.deal.create({
      data: {
        tenantId: hotel.id, title: d.title, value: d.value, currency: "INR",
        pipelineId: pipeline.id, stageId,
        contactId: dealGuestIds[d.guest] ?? null,
        companyId: d.company != null ? (companyIds[d.company] ?? null) : null,
        ownerId: dealOwners[i % dealOwners.length] ?? null,
        status,
        expectedCloseAt: new Date(now.getTime() + d.closeInDays * dayMs),
        closedAt: status === "open" ? null : new Date(now.getTime() + d.closeInDays * dayMs),
        source: "manual",
        transitions: { create: { tenantId: hotel.id, toStageId: stageId, changedById: dealOwners[0] ?? null } },
      },
    });
  }

  // ── CRM: contact enrichment (Increment B) ────────────────────────────────────
  const enrich = [
    { idx: 0, lifecycleStage: "customer", leadStatus: "qualified", company: 0, tags: ["vip", "repeat"] },
    { idx: 1, lifecycleStage: "opportunity", leadStatus: "connected", company: 0, tags: ["events"] },
    { idx: 2, lifecycleStage: "sql", leadStatus: "qualified", company: 1, tags: ["corporate"] },
    { idx: 3, lifecycleStage: "customer", leadStatus: "qualified", company: 2, tags: ["vip"] },
    { idx: 4, lifecycleStage: "lead", leadStatus: "new", company: 1, tags: [] },
  ];
  const dealGuestIdList = Object.values(guestMap);
  for (const e of enrich) {
    const contactId = dealGuestIdList[e.idx];
    if (!contactId) continue;
    await prisma.contact.update({
      where: { id: contactId },
      data: {
        lifecycleStage: e.lifecycleStage, leadStatus: e.leadStatus,
        companyId: companyIds[e.company] ?? null, ownerId: dealOwners[e.idx % dealOwners.length] ?? null,
        tags: e.tags, email: `contact${e.idx}@example.com`, source: "manual",
      },
    });
  }

  // ── CRM: demo activities / tasks (Increment C) ───────────────────────────────
  await prisma.activity.deleteMany({ where: { tenantId: HOTEL_ID } });
  const firstContact = dealGuestIdList[0];
  const secondContact = dealGuestIdList[1];
  if (firstContact) {
    await prisma.activity.create({ data: { tenantId: hotel.id, contactId: firstContact, userId: dealOwners[0] ?? null, type: "note", title: "Intro call", body: "Discussed corporate retreat needs. Customer confirmed budget and is keen to go ahead — wants a proposal this week." } });
    await prisma.activity.create({ data: { tenantId: hotel.id, contactId: firstContact, userId: dealOwners[0] ?? null, type: "task", title: "Send retreat proposal", status: "open", dueAt: new Date(now.getTime() + 2 * dayMs) } });
  }
  if (secondContact) {
    await prisma.activity.create({ data: { tenantId: hotel.id, contactId: secondContact, userId: dealOwners[0] ?? null, type: "task", title: "Follow up on wedding package", status: "open", dueAt: new Date(now.getTime() - dayMs) } });
  }

  console.log("✓ Seed complete — The Riviera hotel loaded with full demo data.");

  // Second demo tenant: an IT/Tech Corporate help desk on the same pipeline (#166).
  await seedItDesk();
}

main()
  .then(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
