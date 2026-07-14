// Workspace provisioning — seed a new tenant's industry "starter kit" across all
// quoting workstreams from the shared INDUSTRY_CATALOG:
//   • starter materials (InventoryItem)
//   • preset QuoteTemplates + components, stamped with the company name
//   • the follow-up Sequence + its MessageTemplates
//   • the two-way WhatsApp sales-agent campaign
//
// Called once from workspace creation (server.ts) right after roles/license, and
// reused by the Tempus demo seed. Every write is idempotent and NON-DESTRUCTIVE:
// existing rows (a workspace's own edits) are never clobbered — a template/sequence/
// agent that already exists by name is skipped, materials upsert their rate.

import { prisma } from "../../db/prisma";
import {
  getIndustryCatalog,
  fillCompany,
  type CatalogComponent,
  type CatalogMaterial,
} from "./industry-catalog";

const toPaise = (inr: number): number => Math.max(0, Math.round(inr)) * 100;

export interface ProvisionResult {
  materials: number;
  templates: number;
  messageTemplates: number;
  sequence: boolean;
  agent: boolean;
}

// Build the nested-create data for one template component. Links to the seeded
// InventoryItem for live-rate provenance AND stores the material rate inline in
// `defaultRatePaise`, so a quote built from this template prices correctly whether or
// not the workspace still has the inventory row.
function componentData(
  tenantId: string,
  c: CatalogComponent,
  i: number,
  invByName: Record<string, string>,
  matByName: Map<string, CatalogMaterial>,
) {
  const mat = c.material ? matByName.get(c.material) : undefined;
  const rateInr = c.material ? mat?.rateInr ?? c.rateInr ?? 0 : c.rateInr ?? 0;
  return {
    tenantId,
    name: c.name,
    kind: c.kind ?? "material",
    costBasis: c.costBasis,
    inventoryItemId: c.material ? invByName[c.material] ?? null : null,
    materialUnit: c.materialUnit ?? mat?.unit ?? "unit",
    defaultRatePaise: toPaise(rateInr),
    defaultLengthMm: c.lengthMm ?? null,
    defaultWidthMm: c.widthMm ?? null,
    defaultHeightMm: c.heightMm ?? null,
    defaultQuantity: c.quantity ?? 1,
    wastagePct: c.wastagePct ?? 0,
    laborHours: c.laborHours ?? 0,
    sortOrder: i,
  };
}

export async function seedIndustryDefaults(
  tenantId: string,
  industry: string | null | undefined,
  companyName: string,
): Promise<ProvisionResult> {
  const catalog = getIndustryCatalog(industry);
  const name = (companyName || "Your Company").trim() || "Your Company";
  const result: ProvisionResult = { materials: 0, templates: 0, messageTemplates: 0, sequence: false, agent: false };

  // 1. Starter materials (idempotent upsert). Keep a name→id map for template links.
  const invByName: Record<string, string> = {};
  const matByName = new Map(catalog.materials.map((m) => [m.name, m]));
  for (const m of catalog.materials) {
    const item = await prisma.inventoryItem.upsert({
      where: { tenantId_name: { tenantId, name: m.name } },
      update: { category: m.category, unit: m.unit, unitCostInr: m.rateInr },
      create: { tenantId, name: m.name, category: m.category, unit: m.unit, stock: 0, reorderLevel: 5, unitCostInr: m.rateInr },
    });
    invByName[m.name] = item.id;
    result.materials++;
  }

  // 2. Quote templates. The company name is stamped into the description so the
  //    builder + PDF read as a per-company heading with the line items as the
  //    editable values below. Skip any template that already exists by name.
  for (const t of catalog.templates) {
    const exists = await prisma.quoteTemplate.findFirst({ where: { tenantId, name: t.name }, select: { id: true } });
    if (exists) continue;
    await prisma.quoteTemplate.create({
      data: {
        tenantId,
        name: t.name,
        category: t.category,
        description: `${name} — ${t.description}`,
        overheadPct: t.overheadPct,
        marginPct: t.marginPct,
        marginFloorPct: t.marginFloorPct,
        laborRatePaise: toPaise(t.laborRateInr),
        components: { create: t.components.map((c, i) => componentData(tenantId, c, i, invByName, matByName)) },
      },
    });
    result.templates++;
  }

  // 3. Message templates for the follow-up sequence (idempotent by name+channel).
  const tplIdByKey: Record<string, string> = {};
  for (const mt of catalog.messageTemplates) {
    const body = fillCompany(mt.body, name);
    const subject = mt.subject ? fillCompany(mt.subject, name) : null;
    const existing = await prisma.messageTemplate.findFirst({ where: { tenantId, name: mt.name, channel: mt.channel }, select: { id: true } });
    const row = existing
      ? await prisma.messageTemplate.update({ where: { id: existing.id }, data: { body, subject, category: mt.category, status: "approved" }, select: { id: true } })
      : await prisma.messageTemplate.create({ data: { tenantId, name: mt.name, channel: mt.channel, category: mt.category, subject, body, status: "approved" }, select: { id: true } });
    tplIdByKey[mt.key] = row.id;
    result.messageTemplates++;
  }

  // 4. Follow-up sequence + steps (skip if a sequence with this name exists). Exits
  //    the moment the customer replies/books/opts out — the auto-stop the customer asked for.
  const seqExists = await prisma.sequence.findFirst({ where: { tenantId, name: catalog.sequence.name }, select: { id: true } });
  if (!seqExists) {
    const seq = await prisma.sequence.create({
      data: { tenantId, name: catalog.sequence.name, status: "active", exitOn: JSON.stringify(["opted_out", "replied", "booked"]) },
    });
    await prisma.sequenceStep.createMany({
      data: catalog.sequence.steps.map((s) => {
        const mt = catalog.messageTemplates.find((m) => m.key === s.templateKey);
        if (s.channel === "email") {
          return {
            sequenceId: seq.id, order: s.order, waitMinutes: s.waitDays * 24 * 60, channel: "email",
            emailSubject: mt?.subject ? fillCompany(mt.subject, name) : null,
            emailBody: mt ? fillCompany(mt.body, name) : null,
          };
        }
        return { sequenceId: seq.id, order: s.order, waitMinutes: s.waitDays * 24 * 60, channel: "whatsapp", whatsappTemplateId: tplIdByKey[s.templateKey] ?? null };
      }),
    });
    result.sequence = true;
  }

  // 5. Two-way WhatsApp sales agent (skip if it already exists by name).
  const agentExists = await prisma.voiceCampaign.findFirst({ where: { tenantId, name: catalog.agent.name }, select: { id: true } });
  if (!agentExists) {
    await prisma.voiceCampaign.create({
      data: {
        tenantId, name: catalog.agent.name, status: "active",
        channels: JSON.stringify(["whatsapp"]),
        whatsappAgentEnabled: true,
        whatsappAgentPrompt: fillCompany(catalog.agent.prompt, name),
      },
    });
    result.agent = true;
  }

  return result;
}
