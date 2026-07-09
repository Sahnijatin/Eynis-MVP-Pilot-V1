import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

const uid = () => "qtest-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);

async function setup() {
  const tenantId = uid();
  await prisma.tenant.create({ data: { id: tenantId, name: "Quote Co " + tenantId.slice(-4), timezone: "Asia/Kolkata" } });
  await prisma.license.create({ data: { tenantId, plan: "growth", maxSeats: 25 } });
  const email = `owner-${tenantId}@example.com`;
  await prisma.user.create({ data: { tenantId, fullName: "Owner", email, role: "owner", isActive: true } });

  const server = buildServer();
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const base = "http://127.0.0.1:" + (server.address() as AddressInfo).port;

  const tokRes = await fetch(base + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ tenantId, email, role: "owner" }),
  });
  const { token } = (await tokRes.json()) as { token: string };
  const H = { authorization: "Bearer " + token, "content-type": "application/json" };
  const close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return { tenantId, base, H, close };
}

after(async () => { await prisma.$disconnect(); });

test("quote lifecycle: template → quote → calc → floor guard → send → immutability → accept → deal + pdf", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    // A material the table top references (₹250/sqft).
    const topMaterial = await prisma.inventoryItem.create({
      data: { tenantId, name: "Sheesham Top " + tenantId.slice(-4), category: "Wood", stock: 100, unit: "sqft", unitCostInr: 250 },
    });

    // Create a template: top (area, linked to inventory) + 4 legs (length). margin 50/floor 30 clears.
    const tplRes = await fetch(base + "/quote-templates", {
      method: "POST", headers: H,
      body: JSON.stringify({
        name: "Dining Table " + tenantId.slice(-4), category: "Furniture",
        overheadPct: 15, marginPct: 50, marginFloorPct: 30, laborRatePaise: 15000,
        components: [
          { name: "Table top", kind: "material", costBasis: "area", inventoryItemId: topMaterial.id, materialUnit: "sqft", defaultLengthMm: 1800, defaultWidthMm: 900, defaultQuantity: 1, wastagePct: 10, laborHours: 3 },
          { name: "Leg", kind: "material", costBasis: "length", materialUnit: "rft", defaultRatePaise: 8000, defaultLengthMm: 720, defaultQuantity: 4, wastagePct: 5, laborHours: 2 },
        ],
      }),
    });
    assert.equal(tplRes.status, 200);
    const { template } = (await tplRes.json()) as { template: { id: string; components: unknown[] } };
    assert.equal(template.components.length, 2);

    // Create a quote from the template.
    const qRes = await fetch(base + "/quotes", {
      method: "POST", headers: H,
      body: JSON.stringify({ title: "Riviera Dining Table", templateId: template.id }),
    });
    assert.equal(qRes.status, 200);
    const { quote } = (await qRes.json()) as { quote: QuoteShape };
    assert.match(quote.number, /^Q-\d{4}-\d{4}$/);
    assert.equal(quote.status, "draft");
    assert.equal(quote.lineItems.length, 2);
    // Top rate must be snapshotted from inventory: 250 rupees → 25000 paise.
    const top = quote.lineItems.find((l) => l.name === "Table top")!;
    assert.equal(top.unitRatePaise, 25000);
    assert.ok(quote.totalPaise > quote.subtotalCostPaise, "price exceeds loaded cost");
    assert.ok(quote.marginPctActual > 30, `gross margin clears floor, got ${quote.marginPctActual}`);

    // Snapshot immutability: change the material price; the quote must not move.
    await fetch(base + `/inventory/items/${topMaterial.id}`, { method: "PUT", headers: H, body: JSON.stringify({ unitCostInr: 9999 }) });
    const afterRepriceRes = await fetch(base + `/quotes/${quote.id}`, { headers: H });
    const afterReprice = ((await afterRepriceRes.json()) as { quote: QuoteShape }).quote;
    assert.equal(afterReprice.lineItems.find((l) => l.name === "Table top")!.unitRatePaise, 25000, "sent-price snapshot is immutable to inventory changes");

    // Live calc preview matches (no persistence).
    const calcRes = await fetch(base + "/quotes/calc", {
      method: "POST", headers: H,
      body: JSON.stringify({ overheadPct: 0, marginPct: 100, marginFloorPct: 0, lines: [{ costBasis: "fixed", quantity: 1, unitRatePaise: 100000 }] }),
    });
    const calc = (await calcRes.json()) as { preview: { quote: { totalPaise: number } } };
    assert.equal(calc.preview.quote.totalPaise, 200000); // 100000 cost × (1 + 100%)

    // Margin-floor guard: drop margin to 10% → send must 422.
    await fetch(base + `/quotes/${quote.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ marginPct: 10, marginFloorPct: 30 }) });
    const badSend = await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    assert.equal(badSend.status, 422);
    const badBody = (await badSend.json()) as { ok: boolean; minTotalPaise: number };
    assert.equal(badBody.ok, false);
    assert.ok(badBody.minTotalPaise > 0);

    // Restore a healthy margin and send.
    await fetch(base + `/quotes/${quote.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ marginPct: 50 }) });
    const sendRes = await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    assert.equal(sendRes.status, 200);
    assert.equal(((await sendRes.json()) as { quote: QuoteShape }).quote.status, "sent");

    // Immutability: editing a line on a sent quote → 409.
    const editSent = await fetch(base + `/quotes/${quote.id}/lines/${top.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ quantity: 2 }) });
    assert.equal(editSent.status, 409);

    // Accept with a linked deal → deal.value is committed from the quote total.
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: "Sales", isDefault: true } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: "New", order: 0, probability: 10 } });
    const deal = await prisma.deal.create({ data: { tenantId, title: "Dining table deal", pipelineId: pipeline.id, stageId: stage.id } });
    // Re-link the (now sent) quote to the deal directly, then accept.
    await prisma.quote.update({ where: { id: quote.id }, data: { dealId: deal.id } });
    const acceptRes = await fetch(base + `/quotes/${quote.id}/accept`, { method: "POST", headers: H });
    assert.equal(acceptRes.status, 200);
    const accepted = ((await acceptRes.json()) as { quote: QuoteShape }).quote;
    assert.equal(accepted.status, "accepted");
    const updatedDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
    assert.equal(Number(updatedDeal!.value), Math.round(accepted.totalPaise / 100 * 100) / 100);

    // PDF renders real bytes.
    const pdfRes = await fetch(base + `/quotes/${quote.id}/pdf`, { headers: H });
    assert.equal(pdfRes.status, 200);
    assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
    const bytes = new Uint8Array(await pdfRes.arrayBuffer());
    assert.ok(bytes.byteLength > 500, "pdf has content");
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  } finally {
    await close();
  }
});

test("sending a quote logs a follow-up task and enrolls the contact when a sequence exists", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    // A contact + an active "Quote follow-up" sequence with one WhatsApp step.
    const contact = await prisma.contact.create({ data: { tenantId, fullName: "Asha Rao", phoneE164: "+919812300011", email: "asha@example.com" } });
    const seq = await prisma.sequence.create({ data: { tenantId, name: "Quote follow-up", status: "active" } });
    await prisma.sequenceStep.create({ data: { sequenceId: seq.id, order: 0, waitMinutes: 0, channel: "whatsapp", whatsappContentSid: "HXtest" } });

    // A quote for that contact with one fixed line, healthy margin.
    const qRes = await fetch(base + "/quotes", {
      method: "POST", headers: H,
      body: JSON.stringify({ title: "Wardrobe", contactId: contact.id, marginPct: 60, marginFloorPct: 20, lines: [{ name: "Cabinet", costBasis: "fixed", quantity: 1, unitRatePaise: 5000000 }] }),
    });
    const { quote } = (await qRes.json()) as { quote: { id: string } };

    const sendRes = await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    assert.equal(sendRes.status, 200);
    const sent = (await sendRes.json()) as { ok: boolean; followup?: { activityLogged: boolean; enrolled: boolean } };
    assert.ok(sent.followup?.activityLogged, "a follow-up task is logged");
    assert.ok(sent.followup?.enrolled, "the contact is enrolled into the sequence");

    // Verify persistence: a task activity + a sequence enrollment exist.
    const task = await prisma.activity.findFirst({ where: { tenantId, contactId: contact.id, type: "task" } });
    assert.ok(task, "follow-up task persisted");
    const enrollment = await prisma.sequenceEnrollment.findFirst({ where: { tenantId, sequenceId: seq.id } });
    assert.ok(enrollment, "enrollment persisted");

    // Idempotent: re-sending an already-sent quote is rejected (409), no double work.
    const resend = await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    assert.equal(resend.status, 409);
  } finally {
    await close();
  }
});

test("quotes are tenant-isolated", async () => {
  const a = await setup();
  const b = await setup();
  try {
    const created = await fetch(a.base + "/quotes", { method: "POST", headers: a.H, body: JSON.stringify({ title: "A's quote" }) });
    const { quote } = (await created.json()) as { quote: { id: string } };
    // Tenant B must not see tenant A's quote.
    const cross = await fetch(b.base + `/quotes/${quote.id}`, { headers: b.H });
    assert.equal(cross.status, 404);
  } finally {
    await a.close();
    await b.close();
  }
});

interface QuoteShape {
  id: string;
  number: string;
  status: string;
  totalPaise: number;
  subtotalCostPaise: number;
  marginPctActual: number;
  lineItems: Array<{ id: string; name: string; unitRatePaise: number }>;
}
