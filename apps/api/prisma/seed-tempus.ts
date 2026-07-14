import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { seedIndustryDefaults } from "../src/core/quotes/provision";
import { getIndustryCatalog } from "../src/core/quotes/industry-catalog";

// Tempus demo tenant — a furniture manufacturer. Seeds the quoting + costing engine
// with real, prefilled data so the demo opens on something tangible. The actual
// content (materials, templates, follow-up sequence, WhatsApp agent) now lives in the
// shared INDUSTRY_CATALOG and is written by `seedIndustryDefaults` — the exact same
// path a real workspace is provisioned with — so this script just sets up the tenant
// and delegates. Idempotent: clears and rebuilds this tenant's quoting/demo data on
// each run. Safe alongside `db:seed` (separate tenant id).

const prisma = new PrismaClient();
const TENANT_ID = "eynis-tempus-1";
const COMPANY_NAME = "Tempus Furniture";
const INDUSTRY = "manufacturing";

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

async function main() {
  // Tenant + license.
  await prisma.tenant.upsert({
    where: { id: TENANT_ID },
    update: { name: COMPANY_NAME, industry: INDUSTRY },
    create: { id: TENANT_ID, name: COMPANY_NAME, industry: INDUSTRY, timezone: "Asia/Kolkata" },
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

  // Clean rebuild of this demo tenant's quoting/follow-up data, then re-provision from
  // the shared catalog (the same code path new workspaces use).
  const catalog = getIndustryCatalog(INDUSTRY);
  await prisma.quoteTemplate.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.sequence.deleteMany({ where: { tenantId: TENANT_ID, name: catalog.sequence.name } });
  await prisma.voiceCampaign.deleteMany({ where: { tenantId: TENANT_ID, name: catalog.agent.name } });
  await prisma.messageTemplate.deleteMany({ where: { tenantId: TENANT_ID, name: { in: catalog.messageTemplates.map((m) => m.name) } } });

  const r = await seedIndustryDefaults(TENANT_ID, INDUSTRY, COMPANY_NAME);

  console.log(
    `Seeded Tempus demo tenant "${TENANT_ID}": ${r.materials} materials, ${r.templates} quote templates, ` +
    `${r.messageTemplates} message templates, follow-up sequence${r.sequence ? "" : " (existing)"}, WhatsApp agent${r.agent ? "" : " (existing)"}.`,
  );
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(async () => { await prisma.$disconnect(); });
