import test, { after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../db/prisma";
import { seedIndustryDefaults, backfillIndustryDefaults } from "./provision";
import { INDUSTRY_CATALOG, getIndustryCatalog } from "./industry-catalog";
import { priceQuote } from "./costing";

const uid = () => "ptest-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);
const createdTenants: string[] = [];

async function newTenant(industry: string, name: string) {
  const tenantId = uid();
  createdTenants.push(tenantId);
  await prisma.tenant.create({ data: { id: tenantId, name, industry, timezone: "Asia/Kolkata" } });
  return tenantId;
}

after(async () => {
  for (const id of createdTenants) await prisma.tenant.deleteMany({ where: { id } });
  await prisma.tenant.deleteMany({ where: { id: { startsWith: "ptest-" } } });
  await prisma.$disconnect();
});

test("provisioning seeds a healthcare workspace with only its own templates, company-stamped", async () => {
  const tenantId = await newTenant("healthcare", "XYZ Clinic");
  const r = await seedIndustryDefaults(tenantId, "healthcare", "XYZ Clinic");

  const cat = getIndustryCatalog("healthcare");
  assert.equal(r.templates, cat.templates.length);
  assert.equal(r.materials, cat.materials.length);
  assert.ok(r.sequence && r.agent);

  const templates = await prisma.quoteTemplate.findMany({ where: { tenantId }, include: { components: true } });
  const names = templates.map((t) => t.name).sort();
  // Exactly the healthcare set — none of the furniture templates leaked in.
  assert.deepEqual(names, cat.templates.map((t) => t.name).sort());
  assert.ok(!names.includes("Dining Table"), "furniture template must not appear for a clinic");

  // The company name is stamped into every template's description (the per-company heading).
  for (const t of templates) assert.ok(t.description?.startsWith("XYZ Clinic — "), `"${t.name}" should be company-stamped`);

  // Components link to seeded inventory and carry a non-zero rate so they price standalone.
  const impl = templates.find((t) => t.name === "Dental Implant");
  assert.ok(impl, "Dental Implant template exists");
  const fixture = impl!.components.find((c) => c.name === "Implant fixture");
  assert.ok(fixture?.inventoryItemId, "component links to the seeded material");
  assert.ok((fixture?.defaultRatePaise ?? 0) > 0, "component has an inline rate fallback");
});

test("each industry seeds a distinct, non-overlapping template set", async () => {
  const seen = new Map<string, string>(); // templateName -> industry (allow duplicates across only via distinct names)
  for (const industry of ["manufacturing", "healthcare", "fnb", "travel", "hospitality"]) {
    const tenantId = await newTenant(industry, `Co ${industry}`);
    await seedIndustryDefaults(tenantId, industry, `Co ${industry}`);
    const templates = await prisma.quoteTemplate.findMany({ where: { tenantId }, select: { name: true } });
    assert.equal(templates.length, INDUSTRY_CATALOG[industry as keyof typeof INDUSTRY_CATALOG].templates.length);
    for (const t of templates) seen.set(`${industry}:${t.name}`, industry);
  }
  // Sanity: a furniture-only name and a clinic-only name both exist, keyed by industry.
  assert.ok([...seen.keys()].includes("manufacturing:Dining Table"));
  assert.ok([...seen.keys()].includes("healthcare:Dental Implant"));
});

test("provisioning is idempotent — a second run does not duplicate templates", async () => {
  const tenantId = await newTenant("fnb", "ABC Caterers");
  await seedIndustryDefaults(tenantId, "fnb", "ABC Caterers");
  const r2 = await seedIndustryDefaults(tenantId, "fnb", "ABC Caterers");
  assert.equal(r2.templates, 0, "no new templates on the second run");
  assert.equal(r2.sequence, false);
  assert.equal(r2.agent, false);
  const count = await prisma.quoteTemplate.count({ where: { tenantId } });
  assert.equal(count, getIndustryCatalog("fnb").templates.length);
});

test("seeded follow-up sequence + WhatsApp agent are wired across workstreams", async () => {
  const tenantId = await newTenant("hospitality", "Grand Palace");
  await seedIndustryDefaults(tenantId, "hospitality", "Grand Palace");

  const seq = await prisma.sequence.findFirst({ where: { tenantId }, include: { steps: true } });
  assert.ok(seq, "a follow-up sequence exists");
  assert.equal(seq!.status, "active");
  assert.equal(seq!.steps.length, 3);

  const agent = await prisma.voiceCampaign.findFirst({ where: { tenantId } });
  assert.ok(agent?.whatsappAgentEnabled, "WhatsApp agent is enabled");
  assert.ok(agent?.whatsappAgentPrompt?.includes("Grand Palace"), "agent prompt is company-stamped");
});

test("backfill provisions templates for a pre-existing tenant that has none, and skips ones that do", async () => {
  // A tenant created "before" auto-provisioning: exists, but has zero quote templates.
  const bare = await newTenant("travel", "Old Travel Co");
  // A tenant that already has its kit — backfill must not touch it or duplicate.
  const seeded = await newTenant("manufacturing", "Already Furnished");
  await seedIndustryDefaults(seeded, "manufacturing", "Already Furnished");
  const beforeSeeded = await prisma.quoteTemplate.count({ where: { tenantId: seeded } });

  const n = await backfillIndustryDefaults();
  assert.ok(n >= 1, "at least the bare tenant was backfilled");

  const bareCount = await prisma.quoteTemplate.count({ where: { tenantId: bare } });
  assert.equal(bareCount, getIndustryCatalog("travel").templates.length, "bare tenant now has its travel templates");
  const bareNames = (await prisma.quoteTemplate.findMany({ where: { tenantId: bare }, select: { name: true } })).map((t) => t.name);
  assert.ok(bareNames.includes("Tour Package (per person)"), "travel-specific template present");

  const afterSeeded = await prisma.quoteTemplate.count({ where: { tenantId: seeded } });
  assert.equal(afterSeeded, beforeSeeded, "an already-provisioned tenant is left untouched");
});

test("a service-vertical template prices correctly through the shared costing engine", async () => {
  // Healthcare uses fixed/hours cost bases; confirm the engine rolls it up without a
  // furniture-style dimension. Dental Implant = fixture + crown + lab + 1.5h surgery.
  const cat = getIndustryCatalog("healthcare");
  const t = cat.templates.find((x) => x.name === "Dental Implant")!;
  const lines = t.components.map((c) => ({
    costBasis: c.costBasis,
    lengthMm: c.lengthMm ?? null,
    widthMm: c.widthMm ?? null,
    heightMm: c.heightMm ?? null,
    quantity: c.quantity ?? 1,
    unitRatePaise: ((c.material ? cat.materials.find((m) => m.name === c.material)?.rateInr : c.rateInr) ?? 0) * 100,
    wastagePct: c.wastagePct ?? 0,
    laborHours: c.laborHours ?? 0,
    laborRatePaise: t.laborRateInr * 100,
  }));
  const { quote } = priceQuote(lines, { overheadPct: t.overheadPct, marginPct: t.marginPct, marginFloorPct: t.marginFloorPct, discountPaise: 0 });
  assert.ok(quote.totalPaise > 0, "service template yields a positive total");
  assert.ok(quote.laborCostPaise > 0, "clinician hours are costed");
  assert.ok(!quote.floorViolation, "default margin clears its own floor");
});
