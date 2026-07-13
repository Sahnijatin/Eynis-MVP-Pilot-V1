import "dotenv/config";
import { PrismaClient } from "@prisma/client";

// Tempus demo tenant — a furniture manufacturer. Seeds the quoting + costing engine
// with real, prefilled data so the demo opens on something tangible: materials with
// rates, reusable templates (Dining Table / Office Desk / Wardrobe), a Quote
// follow-up sequence, and the two-way WhatsApp sales agent. Idempotent — clears and
// rebuilds this tenant's quoting/demo data on each run. Safe alongside `db:seed`
// (separate tenant id).

const prisma = new PrismaClient();
const TENANT_ID = "eynis-tempus-1";

const ROLE_PERMISSIONS: Record<string, string[]> = {
  admin: [
    "invite_users", "manage_users", "manage_roles", "create_custom_roles", "manage_billing",
    "manage_settings", "view_reports", "manage_requests", "view_requests", "manage_automations",
    "view_guests", "manage_guests", "night_audit", "manage_connectors", "manage_campaigns",
    "manage_inventory", "view_crm", "manage_crm",
  ],
  manager: ["view_reports", "manage_requests", "view_requests", "view_guests", "manage_guests", "manage_campaigns", "manage_inventory", "view_crm", "manage_crm"],
  supervisor: ["view_reports", "manage_requests", "view_requests", "view_guests", "view_crm", "manage_crm"],
  agent: ["view_requests", "manage_requests", "view_guests", "view_crm", "manage_crm"],
  viewer: ["view_reports", "view_requests", "view_guests", "view_crm"],
};

// (name, category, unit, ₹/unit)
const MATERIALS: Array<[string, string, string, number]> = [
  ["Sheesham Wood", "Wood", "sqft", 320],
  ["Teak Wood", "Wood", "sqft", 480],
  ["Plywood 18mm", "Board", "sqft", 95],
  ["Laminate Sheet", "Board", "sqft", 65],
  ["MDF 18mm", "Board", "sqft", 55],
  ["Steel Leg (powder-coated)", "Hardware", "unit", 380],
  ["Brass Handle", "Hardware", "unit", 120],
  ["Soft-close Hinge", "Hardware", "unit", 90],
  ["PU Finish", "Finish", "sqft", 40],
];

async function main() {
  // Tenant + license.
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: "Tempus Furniture", industry: "manufacturing" },
    create: { id: TENANT_ID, name: "Tempus Furniture", industry: "manufacturing", timezone: "Asia/Kolkata" },
  });
  await prisma.license.upsert({
    where: { tenantId: TENANT_ID },
    update: { plan: "growth", maxSeats: 25 },
    create: { tenantId: TENANT_ID, plan: "growth", maxSeats: 25 },
  });

  // Roles + an admin user.
  for (const [key, perms] of Object.entries(ROLE_PERMISSIONS)) {
    await prisma.role.upsert({
      where: { tenantId_key: { tenantId: TENANT_ID, key } },
      update: { permissions: JSON.stringify(perms), isSystem: true, isCustom: false },
      create: { tenantId: TENANT_ID, key, displayName: key[0].toUpperCase() + key.slice(1), permissions: JSON.stringify(perms), isSystem: true, isCustom: false },
    });
  }
  const adminRole = await prisma.role.findUnique({ where: { tenantId_key: { tenantId: TENANT_ID, key: "admin" } } });
  await prisma.user.upsert({
    where: { tenantId_email: { tenantId: TENANT_ID, email: "owner@tempus.example" } },
    update: { roleId: adminRole?.id, isActive: true },
    create: { tenantId: TENANT_ID, fullName: "Tempus Owner", email: "owner@tempus.example", role: "owner", roleId: adminRole?.id, isActive: true },
  });

  // Materials (inventory).
  const invByName: Record<string, string> = {};
  for (const [name, category, unit, cost] of MATERIALS) {
    const item = await prisma.inventoryItem.upsert({
      where: { tenantId_name: { tenantId: TENANT_ID, name } },
      update: { category, unit, unitCostPaise: cost * 100 },
      create: { tenantId: TENANT_ID, name, category, unit, stock: 500, reorderLevel: 50, unitCostPaise: cost * 100 },
    });
    invByName[name] = item.id;
  }

  // Rebuild quote templates from scratch (idempotent).
  await prisma.quoteTemplate.deleteMany({ where: { tenantId: TENANT_ID } });
  const mk = (name: string, inv: string | null, costBasis: string, unit: string, opts: Partial<{ rate: number; L: number; W: number; H: number; qty: number; waste: number; hrs: number; kind: string }>, sort: number) => ({
    tenantId: TENANT_ID,
    name, kind: opts.kind ?? "material", costBasis, materialUnit: unit,
    inventoryItemId: inv, defaultRatePaise: (opts.rate ?? 0) * 100,
    defaultLengthMm: opts.L ?? null, defaultWidthMm: opts.W ?? null, defaultHeightMm: opts.H ?? null,
    defaultQuantity: opts.qty ?? 1, wastagePct: opts.waste ?? 0, laborHours: opts.hrs ?? 0, sortOrder: sort,
  });

  await prisma.quoteTemplate.create({
    data: {
      tenantId: TENANT_ID, name: "Dining Table", category: "Furniture",
      description: "Solid-wood top with legs and apron", overheadPct: 15, marginPct: 45, marginFloorPct: 30, laborRatePaise: 15000,
      components: {
        create: [
          mk("Table top", invByName["Sheesham Wood"], "area", "sqft", { L: 1800, W: 900, waste: 10, hrs: 3 }, 0),
          mk("Legs", invByName["Steel Leg (powder-coated)"], "fixed", "unit", { qty: 4, hrs: 1 }, 1),
          mk("Apron", invByName["Plywood 18mm"], "length", "rft", { L: 5000, waste: 5, hrs: 1 }, 2),
          mk("Handles / hardware", invByName["Brass Handle"], "fixed", "unit", { qty: 0 }, 3),
          mk("PU finish", invByName["PU Finish"], "area", "sqft", { L: 1800, W: 900, hrs: 1 }, 4),
        ],
      },
    },
  });
  await prisma.quoteTemplate.create({
    data: {
      tenantId: TENANT_ID, name: "Office Desk", category: "Furniture",
      description: "Laminate desk with steel legs and drawer unit", overheadPct: 15, marginPct: 40, marginFloorPct: 28, laborRatePaise: 15000,
      components: {
        create: [
          mk("Desk top", invByName["Plywood 18mm"], "area", "sqft", { L: 1500, W: 750, waste: 8, hrs: 2 }, 0),
          mk("Laminate", invByName["Laminate Sheet"], "area", "sqft", { L: 1500, W: 750, waste: 8, hrs: 1 }, 1),
          mk("Legs", invByName["Steel Leg (powder-coated)"], "fixed", "unit", { qty: 4 }, 2),
          mk("Soft-close hinges", invByName["Soft-close Hinge"], "fixed", "unit", { qty: 4 }, 3),
        ],
      },
    },
  });
  await prisma.quoteTemplate.create({
    data: {
      tenantId: TENANT_ID, name: "Wardrobe (2-door)", category: "Furniture",
      description: "MDF carcass with laminate finish and soft-close doors", overheadPct: 18, marginPct: 42, marginFloorPct: 30, laborRatePaise: 16000,
      components: {
        create: [
          mk("Carcass", invByName["MDF 18mm"], "area", "sqft", { L: 2100, W: 1200, waste: 10, hrs: 5 }, 0),
          mk("Doors", invByName["MDF 18mm"], "area", "sqft", { L: 2100, W: 600, qty: 2, waste: 8, hrs: 3 }, 1),
          mk("Laminate", invByName["Laminate Sheet"], "area", "sqft", { L: 2100, W: 1200, waste: 8 }, 2),
          mk("Handles", invByName["Brass Handle"], "fixed", "unit", { qty: 2 }, 3),
          mk("Hinges", invByName["Soft-close Hinge"], "fixed", "unit", { qty: 6 }, 4),
        ],
      },
    },
  });

  // Message templates for the follow-up sequence.
  const waTpl = await prisma.messageTemplate.upsert({
    where: { id: `${TENANT_ID}-wa-quote` },
    update: {},
    create: {
      id: `${TENANT_ID}-wa-quote`, tenantId: TENANT_ID, name: "Quote sent (WhatsApp)", channel: "whatsapp", category: "utility",
      body: "Hi {lead.firstName}, thanks for your interest in Tempus Furniture! Your quote is ready. Reply here with any questions and we'll be happy to help.",
      status: "approved", providerTemplateId: "HX_demo_quote_followup",
    },
  });
  const emailTpl = await prisma.messageTemplate.upsert({
    where: { id: `${TENANT_ID}-em-quote` },
    update: {},
    create: {
      id: `${TENANT_ID}-em-quote`, tenantId: TENANT_ID, name: "Quote nudge (Email)", channel: "email", category: "marketing",
      subject: "Your Tempus Furniture quote", body: "<p>Hi {lead.firstName},</p><p>Just checking in on the quote we sent. Happy to adjust materials, finish, or dimensions — reply and we'll revise it.</p><p>— Team Tempus</p>",
      status: "approved",
    },
  });

  // Quote follow-up sequence: WhatsApp now → email in 2 days → WhatsApp in 5 days.
  await prisma.sequence.deleteMany({ where: { tenantId: TENANT_ID, name: "Quote follow-up" } });
  const seq = await prisma.sequence.create({
    data: { tenantId: TENANT_ID, name: "Quote follow-up", status: "active", exitOn: JSON.stringify(["opted_out", "replied", "booked"]) },
  });
  await prisma.sequenceStep.createMany({
    data: [
      { sequenceId: seq.id, order: 0, waitMinutes: 0, channel: "whatsapp", whatsappTemplateId: waTpl.id },
      { sequenceId: seq.id, order: 1, waitMinutes: 2 * 24 * 60, channel: "email", whatsappTemplateId: null, emailSubject: emailTpl.subject, emailBody: emailTpl.body },
      { sequenceId: seq.id, order: 2, waitMinutes: 5 * 24 * 60, channel: "whatsapp", whatsappTemplateId: waTpl.id },
    ],
  });

  // The two-way WhatsApp sales agent (customer messages get real answers + capture).
  await prisma.voiceCampaign.upsert({
    where: { id: `${TENANT_ID}-inbound-sales` },
    update: { whatsappAgentEnabled: true },
    create: {
      id: `${TENANT_ID}-inbound-sales`, tenantId: TENANT_ID, name: "Inbound Sales (WhatsApp Agent)", status: "active",
      channels: JSON.stringify(["whatsapp"]), whatsappAgentEnabled: true,
      whatsappAgentPrompt:
        "You are Tempus Furniture's friendly sales assistant. Answer questions about custom furniture (tables, desks, wardrobes), materials (sheesham, teak, plywood, MDF), finishes, timelines and rough pricing. Ask for the piece, dimensions and material to prepare a quote. Offer to have a human follow up with a formal quote. Be concise and warm.",
    },
  });

  console.log(`Seeded Tempus demo tenant "${TENANT_ID}": ${MATERIALS.length} materials, 3 quote templates, follow-up sequence, WhatsApp agent.`);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
