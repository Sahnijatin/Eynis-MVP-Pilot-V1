import test, { after } from "node:test";
import assert from "node:assert/strict";
import type { AddressInfo } from "node:net";
import { buildServer } from "../../server";
import { prisma } from "../../db/prisma";

const uid = () => "qtest-" + Date.now() + "-" + Math.random().toString(16).slice(2, 8);

// Track created tenants so we can tear them down — the sequence-runner processes
// due enrollments GLOBALLY, so a leftover enrollment from this suite would pollute
// that test's counts. Deleting the tenant cascades to quotes/leads/enrollments.
const createdTenants: string[] = [];

async function setup() {
  const tenantId = uid();
  createdTenants.push(tenantId);
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

after(async () => {
  // Cascade-delete every tenant this suite created so no enrollments linger for the
  // global sequence-runner. Also sweep any older 'qtest-' pollution from prior runs.
  for (const id of createdTenants) await prisma.tenant.deleteMany({ where: { id } });
  await prisma.tenant.deleteMany({ where: { id: { startsWith: "qtest-" } } });
  await prisma.$disconnect();
});

test("quote lifecycle: template → quote → calc → floor guard → send → immutability → accept → deal + pdf", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    // A material the table top references (₹250/sqft).
    const topMaterial = await prisma.inventoryItem.create({
      data: { tenantId, name: "Sheesham Top " + tenantId.slice(-4), category: "Wood", stock: 100, unit: "sqft", unitCostPaise: 25000 },
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

    // Yield (4.3): the accepted quote's inventory-linked line shows up as
    // committed demand for that material.
    const yieldRes = await fetch(base + "/inventory/yield", { headers: H });
    assert.equal(yieldRes.status, 200);
    const yieldBody = (await yieldRes.json()) as { ok: boolean; items: Array<{ id: string; committedQty: number }> };
    const topYield = yieldBody.items.find((i) => i.id === topMaterial.id)!;
    assert.ok(topYield.committedQty > 0, `accepted quote commits material demand, got ${topYield.committedQty}`);

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
    // waitMinutes > 0 → the enrollment's first run is in the future, so it is never
    // "due" and cannot be picked up (and counted) by the global sequence-runner test.
    await prisma.sequenceStep.create({ data: { sequenceId: seq.id, order: 0, waitMinutes: 60, channel: "whatsapp", whatsappContentSid: "HXtest" } });

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

test("busy-export: rejected until accepted, then returns a CSV voucher at the selling price", async () => {
  const { base, H, close } = await setup();
  try {
    const qRes = await fetch(base + "/quotes", {
      method: "POST", headers: H,
      body: JSON.stringify({ title: "Office Desk", marginPct: 60, marginFloorPct: 20, lines: [
        { name: "Desk top", groupName: "Office Desk", costBasis: "fixed", quantity: 1, unitRatePaise: 4000000 },
        { name: "Legs", groupName: "Office Desk", costBasis: "fixed", quantity: 4, unitRatePaise: 200000 },
      ] }),
    });
    const { quote } = (await qRes.json()) as { quote: { id: string; totalPaise: number } };

    // Not accepted yet → 409.
    const early = await fetch(base + `/quotes/${quote.id}/busy-export`, { headers: H });
    assert.equal(early.status, 409);

    await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    await fetch(base + `/quotes/${quote.id}/accept`, { method: "POST", headers: H });

    const csvRes = await fetch(base + `/quotes/${quote.id}/busy-export?format=csv`, { headers: H });
    assert.equal(csvRes.status, 200);
    assert.match(csvRes.headers.get("content-type") ?? "", /text\/csv/);
    const csv = await csvRes.text();
    assert.match(csv, /Date,VoucherType,Series,PartyName/); // header
    assert.match(csv, /Sales/);
    // The voucher lines sum to the quote's selling price (ex-GST), not the cost.
    const amounts = csv.trim().split(/\r?\n/).slice(1).map((r) => Number(r.split(",")[9]));
    const sumPaise = Math.round(amounts.reduce((s, a) => s + a, 0) * 100);
    assert.equal(sumPaise, quote.totalPaise);

    // XML variant is well-formed and carries the grand total.
    const xmlRes = await fetch(base + `/quotes/${quote.id}/busy-export?format=xml`, { headers: H });
    assert.equal(xmlRes.status, 200);
    const xml = await xmlRes.text();
    assert.match(xml, /<BusyImport>/);
    assert.match(xml, /<GrandTotal>/);
  } finally {
    await close();
  }
});

test("quotes/parse: no AI configured returns a clear note, not a crash", async () => {
  const { base, H, close } = await setup();
  try {
    const res = await fetch(base + "/quotes/parse", { method: "POST", headers: H, body: JSON.stringify({ text: "6-seater dining table, 1800x900mm sheesham top, 4 legs" }) });
    assert.equal(res.status, 200);
    const data = (await res.json()) as { ok: boolean; lines: unknown[]; note?: string };
    assert.equal(data.ok, true);
    assert.equal(data.lines.length, 0);
    assert.match(data.note ?? "", /not configured/i);
  } finally {
    await close();
  }
});

test("quotes/parse provider selection: an OpenAI-only tenant chooses OpenAI (not Claude)", async () => {
  // This is the fix's core: the route resolves per-tenant credentials and picks the
  // provider via chooseProvider — so a tenant with only an OpenAI key (via Integrations)
  // uses OpenAI, instead of the old code wrongly preferring Claude when any Anthropic
  // key exists. Asserted at the credential layer (no network).
  const { tenantId, close } = await setup();
  try {
    const { resolveAiCredentials, chooseProvider, providerKey } = await import("../research/ai-credentials");
    await prisma.connectorConfig.create({
      data: { tenantId, connectorKey: "ai_openai", enabled: true, configJson: JSON.stringify({ apiKey: "sk-test-openai-only" }) },
    });
    const creds = await resolveAiCredentials(tenantId);
    assert.equal(creds.openaiKey, "sk-test-openai-only");
    assert.equal(creds.anthropicKey, null); // no anthropic env/connector in the test env
    const provider = chooseProvider(creds);
    assert.equal(provider, "openai");
    assert.equal(providerKey(creds, provider), "sk-test-openai-only");
  } finally {
    await close();
  }
});

test("creating a quote with a new-customer object find-or-creates the Contact and links it", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    // First quote creates the contact.
    const r1 = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Table A", customer: { fullName: "Ravi Kumar", phoneE164: "9812300099", email: "ravi@example.com" },
      lines: [{ name: "Top", costBasis: "fixed", quantity: 1, unitRatePaise: 1000000 }],
    }) });
    const q1 = ((await r1.json()) as { quote: { contactId: string; contactName: string } }).quote;
    assert.ok(q1.contactId, "contact linked");
    assert.equal(q1.contactName, "Ravi Kumar");
    // A bare 10-digit number is normalised to +91.
    const contact = await prisma.contact.findFirst({ where: { tenantId, id: q1.contactId } });
    assert.equal(contact!.phoneE164, "+919812300099");

    // Second quote with the same phone reuses the same contact (no duplicate).
    const r2 = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Table B", customer: { fullName: "Ravi K", phoneE164: "+919812300099" },
      lines: [{ name: "Top", costBasis: "fixed", quantity: 1, unitRatePaise: 1000000 }],
    }) });
    const q2 = ((await r2.json()) as { quote: { contactId: string } }).quote;
    assert.equal(q2.contactId, q1.contactId, "same phone → same contact");
  } finally {
    await close();
  }
});

test("GST is applied on top of the taxable total (display only, not in the margin math)", async () => {
  const { base, H, close } = await setup();
  try {
    const r = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Desk", marginPct: 50, marginFloorPct: 10, gstPercent: 18,
      lines: [{ name: "Body", costBasis: "fixed", quantity: 1, unitRatePaise: 10000000 }],
    }) });
    const q = ((await r.json()) as { quote: { totalPaise: number; gstPercent: number; gstPaise: number; grandTotalPaise: number } }).quote;
    assert.equal(q.gstPercent, 18);
    assert.equal(q.gstPaise, Math.round(q.totalPaise * 0.18));
    assert.equal(q.grandTotalPaise, q.totalPaise + q.gstPaise);
  } finally {
    await close();
  }
});

test("editing a draft replaces its line items and re-prices; the PDF hides cost/margin", async () => {
  const { base, H, close } = await setup();
  try {
    const created = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Wardrobe", marginPct: 50, marginFloorPct: 10,
      lines: [{ name: "Old", costBasis: "fixed", quantity: 1, unitRatePaise: 500000 }],
    }) });
    const q = ((await created.json()) as { quote: { id: string; totalPaise: number } }).quote;
    const before = q.totalPaise;

    // Edit: replace the line with a pricier one via PATCH.
    const patched = await fetch(base + `/quotes/${q.id}`, { method: "PATCH", headers: H, body: JSON.stringify({
      title: "Wardrobe (2-door)", gstPercent: 12,
      lines: [{ name: "Carcass", costBasis: "fixed", quantity: 1, unitRatePaise: 900000 }, { name: "Doors", costBasis: "fixed", quantity: 2, unitRatePaise: 300000 }],
    }) });
    const q2 = ((await patched.json()) as { quote: { title: string; totalPaise: number; lineItems: unknown[]; gstPercent: number } }).quote;
    assert.equal(q2.title, "Wardrobe (2-door)");
    assert.equal(q2.lineItems.length, 2);
    assert.equal(q2.gstPercent, 12);
    assert.ok(q2.totalPaise > before, "re-priced upward");

    // The customer PDF must NOT leak the internal cost breakdown. Assert on the
    // structured blocks (PDF byte text is compressed and not reliably searchable).
    const { quotePdfBlocks } = await import("./service");
    const full = ((await (await fetch(base + `/quotes/${q.id}`, { headers: H })).json()) as { quote: Parameters<typeof quotePdfBlocks>[0] }).quote;
    const blocks = quotePdfBlocks(full);
    const flat = JSON.stringify(blocks);
    assert.ok(!/Overhead|Margin/.test(flat), "PDF blocks omit Overhead/Margin");
    assert.ok(/Grand Total/.test(flat), "PDF blocks show Grand Total");
  } finally {
    await close();
  }
});

test("sub-rupee material rates survive into the quote (paise-precise inventory, 4.1)", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    // ₹250.50/sqft — impossible under the old whole-rupee Int column.
    const item = await prisma.inventoryItem.create({
      data: { tenantId, name: "Fine Veneer " + tenantId.slice(-4), category: "Wood", stock: 50, unit: "sqft", unitCostPaise: 25050 },
    });
    const r = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Veneer panel", marginPct: 50, marginFloorPct: 10,
      lines: [{ name: "Panel", costBasis: "fixed", quantity: 1, inventoryItemId: item.id }],
    }) });
    const { quote } = (await r.json()) as { quote: { lineItems: Array<{ unitRatePaise: number }> } };
    assert.equal(quote.lineItems[0].unitRatePaise, 25050, "paise-precise rate snapshotted");

    // The API also accepts fractional rupees on writes (unitCostInr: 99.99 → 9999 paise).
    const put = await fetch(base + `/inventory/items/${item.id}`, { method: "PUT", headers: H, body: JSON.stringify({ unitCostInr: 99.99 }) });
    const updated = ((await put.json()) as { item: { unitCostPaise: number; unitCostInr: number } }).item;
    assert.equal(updated.unitCostPaise, 9999);
    assert.equal(updated.unitCostInr, 99.99);
  } finally {
    await close();
  }
});

test("BUSY export carries the shared GST formula: XML GSTAmount and CSV GSTAmount columns", async () => {
  const { base, H, close } = await setup();
  try {
    const r = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Console Table", marginPct: 50, marginFloorPct: 10, gstPercent: 18,
      lines: [{ name: "Body", costBasis: "fixed", quantity: 1, unitRatePaise: 1000000 }],
    }) });
    const { quote } = (await r.json()) as { quote: { id: string; totalPaise: number } };
    await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    await fetch(base + `/quotes/${quote.id}/accept`, { method: "POST", headers: H });

    const expectedGst = Math.round((quote.totalPaise * 18) / 100);

    const xml = await (await fetch(base + `/quotes/${quote.id}/busy-export?format=xml`, { headers: H })).text();
    assert.match(xml, new RegExp(`<GSTAmount>${(expectedGst / 100).toFixed(2)}</GSTAmount>`), "XML GST amount matches the quote's formula");
    assert.match(xml, new RegExp(`<GrandTotal>${((quote.totalPaise + expectedGst) / 100).toFixed(2)}</GrandTotal>`));

    const csv = await (await fetch(base + `/quotes/${quote.id}/busy-export?format=csv`, { headers: H })).text();
    const header = csv.trim().split(/\r?\n/)[0].split(",");
    const gstIdx = header.indexOf("GSTAmount");
    const totalIdx = header.indexOf("TotalAmount");
    assert.ok(gstIdx > 0 && totalIdx > 0, "CSV carries computed GSTAmount + TotalAmount columns");
    const lines = csv.trim().split(/\r?\n/).slice(1);
    const gstSum = Math.round(lines.reduce((s, l) => s + Number(l.split(",")[gstIdx]), 0) * 100);
    assert.equal(gstSum, expectedGst, "CSV GST amounts sum to the quote's GST");
  } finally {
    await close();
  }
});

test("lifecycle guards: accept/reject/expire only from sent; a committed deal value survives a reject attempt", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    const created = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Bookshelf", marginPct: 50, marginFloorPct: 10,
      lines: [{ name: "Frame", costBasis: "fixed", quantity: 1, unitRatePaise: 2000000 }],
    }) });
    const { quote } = (await created.json()) as { quote: { id: string; totalPaise: number } };

    // Decisions on a draft are rejected — send is the only door out of draft.
    for (const action of ["accept", "reject", "expire"] as const) {
      const r = await fetch(base + `/quotes/${quote.id}/${action}`, { method: "POST", headers: H, body: "{}" });
      assert.equal(r.status, 409, `${action} on a draft must 409`);
    }

    // An empty draft cannot be sent (and therefore can never be accepted at value 0).
    const empty = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({ title: "Empty" }) });
    const emptyQuote = ((await empty.json()) as { quote: { id: string } }).quote;
    assert.equal((await fetch(base + `/quotes/${emptyQuote.id}/send`, { method: "POST", headers: H })).status, 422);
    assert.equal((await fetch(base + `/quotes/${emptyQuote.id}/accept`, { method: "POST", headers: H })).status, 409);

    // Send, link a deal, accept → the deal value is committed.
    await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: "Sales", isDefault: true } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: "New", order: 0, probability: 10 } });
    const deal = await prisma.deal.create({ data: { tenantId, title: "Bookshelf deal", pipelineId: pipeline.id, stageId: stage.id } });
    await prisma.quote.update({ where: { id: quote.id }, data: { dealId: deal.id } });
    assert.equal((await fetch(base + `/quotes/${quote.id}/accept`, { method: "POST", headers: H })).status, 200);
    const committed = Number((await prisma.deal.findUnique({ where: { id: deal.id } }))!.value);
    assert.ok(committed > 0, "deal value committed on accept");

    // Accepted is terminal: reject and expire must 409, and the deal value must not move.
    const rej = await fetch(base + `/quotes/${quote.id}/reject`, { method: "POST", headers: H, body: JSON.stringify({ reason: "changed mind" }) });
    assert.equal(rej.status, 409);
    assert.equal((await fetch(base + `/quotes/${quote.id}/expire`, { method: "POST", headers: H })).status, 409);
    const after = await prisma.quote.findUnique({ where: { id: quote.id }, select: { status: true } });
    assert.equal(after!.status, "accepted", "status unchanged by rejected transition attempts");
    assert.equal(Number((await prisma.deal.findUnique({ where: { id: deal.id } }))!.value), committed, "deal value untouched");
  } finally {
    await close();
  }
});

test("quote numbers are max+1: deleting a quote never makes the next create collide", async () => {
  const { base, H, close } = await setup();
  try {
    const mk = async (title: string) => {
      const r = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({ title }) });
      assert.equal(r.status, 200, `create "${title}" succeeds`);
      return ((await r.json()) as { quote: { id: string; number: string } }).quote;
    };
    const q1 = await mk("One");
    await mk("Two");
    const q3 = await mk("Three");
    assert.match(q3.number, /-0003$/);

    // Delete the FIRST quote — under count+1 the next number would be 0003 (taken).
    assert.equal((await fetch(base + `/quotes/${q1.id}`, { method: "DELETE", headers: H })).status, 200);
    const q4 = await mk("Four");
    assert.match(q4.number, /-0004$/, "max+1 steps past the surviving 0003");
  } finally {
    await close();
  }
});

test("concurrent quote creates allocate distinct numbers", async () => {
  const { base, H, close } = await setup();
  try {
    const results = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({ title: `Race ${i}` }) }),
      ),
    );
    const numbers: string[] = [];
    for (const r of results) {
      assert.equal(r.status, 200);
      numbers.push(((await r.json()) as { quote: { number: string } }).quote.number);
    }
    assert.equal(new Set(numbers).size, 5, `all numbers distinct, got ${numbers.join(", ")}`);
  } finally {
    await close();
  }
});

test("expiry sweep: a sent quote past validUntil flips to expired; others are untouched", async () => {
  const { base, H, close } = await setup();
  try {
    const mk = async (title: string, validUntil?: string) => {
      const r = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
        title, marginPct: 50, marginFloorPct: 10, ...(validUntil ? { validUntil } : {}),
        lines: [{ name: "Body", costBasis: "fixed", quantity: 1, unitRatePaise: 1000000 }],
      }) });
      return ((await r.json()) as { quote: { id: string } }).quote;
    };
    const overdue = await mk("Overdue", new Date(Date.now() - 24 * 3600_000).toISOString());
    const current = await mk("Current", new Date(Date.now() + 24 * 3600_000).toISOString());
    const draft = await mk("Draft overdue", new Date(Date.now() - 24 * 3600_000).toISOString());
    await fetch(base + `/quotes/${overdue.id}/send`, { method: "POST", headers: H });
    await fetch(base + `/quotes/${current.id}/send`, { method: "POST", headers: H });

    const { expireOverdueQuotes } = await import("./service");
    await expireOverdueQuotes();

    const status = async (id: string) => (await prisma.quote.findUnique({ where: { id }, select: { status: true } }))!.status;
    assert.equal(await status(overdue.id), "expired", "overdue sent quote expired");
    assert.equal(await status(current.id), "sent", "future-dated quote untouched");
    assert.equal(await status(draft.id), "draft", "drafts are never expired by the sweep");

    // Idempotent: a second sweep changes nothing for this tenant's quotes.
    await expireOverdueQuotes();
    assert.equal(await status(overdue.id), "expired");
  } finally {
    await close();
  }
});

test("quotation letterhead: seller/bill-to persist, carry forward, and render on the PDF", async () => {
  const { base, H, close } = await setup();
  try {
    const seller = { name: "Akash Furnitures", gstin: "08AALCR2857A1ZD", pan: "AVHPC9999A", ifsc: "SBIN0002836", upi: "1281@paytm", signatory: "Akash Singh" };
    const billTo = { name: "Sampath singh", address: "04, KK Buildings, Jodhpur", pin: "304582", phone: "+91 9981028177" };
    const c1 = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Furniture set", gstPercent: 5, seller, billTo,
      lines: [{ groupName: "Item 1", name: "Chair", costBasis: "fixed", quantity: 5, unitRatePaise: 1000000 }],
    }) });
    const { quote } = (await c1.json()) as { quote: { id: string; seller: Record<string, string>; billTo: Record<string, string> } };
    assert.equal(quote.seller.gstin, "08AALCR2857A1ZD");
    assert.equal(quote.billTo.pin, "304582");

    // A second quote WITHOUT a seller inherits the seller from the last one (typed once).
    const c2 = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({ title: "Second quote" }) });
    const q2 = (await c2.json()) as { quote: { seller: Record<string, string>; billTo: Record<string, string> } };
    assert.equal(q2.quote.seller.name, "Akash Furnitures", "seller carried forward");
    assert.deepEqual(q2.quote.billTo, {}, "bill-to is NOT carried forward (per-customer)");

    // PDF renders as real bytes.
    const pdfRes = await fetch(base + `/quotes/${quote.id}/pdf`, { headers: H });
    assert.equal(pdfRes.headers.get("content-type"), "application/pdf");
    const bytes = new Uint8Array(await pdfRes.arrayBuffer());
    assert.ok(bytes.byteLength > 800, "pdf has content");
    assert.equal(new TextDecoder().decode(bytes.slice(0, 5)), "%PDF-");
  } finally {
    await close();
  }
});

test("line images: persist per piece (cap 3), PDF renders, and the public serve endpoint opens/downloads", async () => {
  const { base, H, close } = await setup();
  try {
    // A real 1×1 red PNG.
    const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
    const create = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Table", gstPercent: 5,
      lines: [{ groupName: "Dining Table", name: "Top", costBasis: "fixed", quantity: 1, unitRatePaise: 5000000 }],
      lineImages: { "Dining Table": [PNG, PNG, PNG, PNG] }, // 4 → capped to 3
    }) });
    const { quote } = (await create.json()) as { quote: { id: string; lineImages: Record<string, string[]> } };
    assert.equal(quote.lineImages["Dining Table"].length, 3, "capped at 3 server-side");

    // PDF renders (links are text, not embedded images).
    const pdf = new Uint8Array(await (await fetch(base + `/quotes/${quote.id}/pdf`, { headers: H })).arrayBuffer());
    assert.equal(new TextDecoder().decode(pdf.slice(0, 5)), "%PDF-");

    // Mint the image token (the PDF route does this when EYNIS_PUBLIC_URL is set) and
    // exercise the public serve endpoint directly.
    const token = await prisma.quote.findUnique({ where: { id: quote.id }, select: { imageToken: true } })
      .then((r) => r?.imageToken) ?? null;
    const tok = token ?? (await (async () => {
      const t = "imgtok-" + Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
      await prisma.quote.update({ where: { id: quote.id }, data: { imageToken: t } });
      return t;
    })());

    const open = await fetch(base + `/public/quote-image/${tok}/0`);
    assert.equal(open.status, 200);
    assert.equal(open.headers.get("content-type"), "image/png");
    assert.match(open.headers.get("content-disposition") ?? "", /^inline/);
    const bytes = new Uint8Array(await open.arrayBuffer());
    assert.ok(bytes.byteLength > 20 && bytes[0] === 0x89 && bytes[1] === 0x50, "returns real PNG bytes");

    const dl = await fetch(base + `/public/quote-image/${tok}/0?download=1`);
    assert.match(dl.headers.get("content-disposition") ?? "", /^attachment/);

    // Out-of-range index and a bad token both 404 (token is the credential).
    assert.equal((await fetch(base + `/public/quote-image/${tok}/9`)).status, 404);
    assert.equal((await fetch(base + `/public/quote-image/deadbeefdeadbeef00/0`)).status, 404);

    // Editing to remove images is allowed on a draft and clears them.
    await fetch(base + `/quotes/${quote.id}`, { method: "PATCH", headers: H, body: JSON.stringify({ lineImages: {} }) });
    const after = (await (await fetch(base + `/quotes/${quote.id}`, { headers: H })).json()) as { quote: { lineImages: Record<string, string[]> } };
    assert.deepEqual(after.quote.lineImages, {}, "images cleared");
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

test("public quote link: view is customer-safe, decisions drive the state machine + deal + audit", async () => {
  const { tenantId, base, H, close } = await setup();
  try {
    const created = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Console", marginPct: 50, marginFloorPct: 10, gstPercent: 18,
      customer: { fullName: "Meera Iyer", phoneE164: "+919812300777" },
      lines: [{ name: "Body", groupName: "Console", costBasis: "fixed", quantity: 1, unitRatePaise: 3000000 }],
    }) });
    const { quote } = (await created.json()) as { quote: { id: string; totalPaise: number } };

    // Link a deal so accept-via-link commits the value.
    const pipeline = await prisma.pipeline.create({ data: { tenantId, name: "Sales", isDefault: true } });
    const stage = await prisma.stage.create({ data: { tenantId, pipelineId: pipeline.id, name: "New", order: 0, probability: 10 } });
    const deal = await prisma.deal.create({ data: { tenantId, title: "Console deal", pipelineId: pipeline.id, stageId: stage.id } });
    await prisma.quote.update({ where: { id: quote.id }, data: { dealId: deal.id } });

    // Send mints the public link.
    const sendRes = await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H });
    const sent = (await sendRes.json()) as { ok: boolean; publicUrl?: string };
    assert.ok(sent.publicUrl, "send returns the customer link");
    const token = sent.publicUrl!.split("/q/")[1];
    assert.ok(token && token.length >= 16);
    // Only the hash is stored.
    const row = await prisma.quote.findUnique({ where: { id: quote.id }, select: { publicTokenHash: true } });
    assert.ok(row!.publicTokenHash && !sent.publicUrl!.includes(row!.publicTokenHash!), "raw token never stored");

    // Public view: customer-safe fields only — no cost/margin anywhere.
    const viewRes = await fetch(base + `/public/quotes/${token}`);
    assert.equal(viewRes.status, 200);
    const view = (await viewRes.json()) as { ok: boolean; quote: Record<string, unknown>; brand: { name: string } };
    assert.equal(view.ok, true);
    assert.ok(view.brand.name, "tenant brand present");
    const flat = JSON.stringify(view);
    for (const secret of ["materialCostPaise", "laborCostPaise", "overheadPaise", "marginPaise", "marginPct", "subtotalCostPaise", "unitRatePaise"]) {
      assert.ok(!flat.includes(secret), `public payload must not leak ${secret}`);
    }
    assert.ok(flat.includes("grandTotalPaise"));

    // Bad token → uniform 404.
    assert.equal((await fetch(base + "/public/quotes/definitely-not-a-real-token")).status, 404);

    // Customer accepts → status, deal value, audit actor.
    const acceptRes = await fetch(base + `/public/quotes/${token}/accept`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    assert.equal(acceptRes.status, 200);
    assert.equal(((await acceptRes.json()) as { status: string }).status, "accepted");
    const updatedDeal = await prisma.deal.findUnique({ where: { id: deal.id } });
    assert.ok(Number(updatedDeal!.value) > 0, "deal value committed by customer accept");
    const audit = await prisma.auditLog.findFirst({ where: { tenantId, action: "quote_accepted", entityId: quote.id } });
    assert.equal(audit!.actorRole, "customer");

    // Idempotent: deciding again reports the final state, no error, no change.
    const again = await fetch(base + `/public/quotes/${token}/decline`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    const againBody = (await again.json()) as { ok: boolean; alreadyDecided?: boolean; status?: string };
    assert.equal(again.status, 200);
    assert.equal(againBody.alreadyDecided, true);
    assert.equal(againBody.status, "accepted");
  } finally {
    await close();
  }
});

test("public quote link: decline path and link regeneration invalidates the old token", async () => {
  const { base, H, close } = await setup();
  try {
    const created = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({
      title: "Shelf", marginPct: 50, marginFloorPct: 10,
      lines: [{ name: "Board", costBasis: "fixed", quantity: 1, unitRatePaise: 500000 }],
    }) });
    const { quote } = (await created.json()) as { quote: { id: string } };
    const sent = (await (await fetch(base + `/quotes/${quote.id}/send`, { method: "POST", headers: H })).json()) as { publicUrl?: string };
    const oldToken = sent.publicUrl!.split("/q/")[1];

    // Regenerate: the old link must die, the new one must work.
    const regen = await fetch(base + `/quotes/${quote.id}/public-link`, { method: "POST", headers: H, body: "{}" });
    assert.equal(regen.status, 200);
    const { url } = (await regen.json()) as { url: string };
    const newToken = url.split("/q/")[1];
    assert.notEqual(newToken, oldToken);
    assert.equal((await fetch(base + `/public/quotes/${oldToken}`)).status, 404, "old link invalidated");
    assert.equal((await fetch(base + `/public/quotes/${newToken}`)).status, 200, "new link works");

    // Customer declines via the new link.
    const decline = await fetch(base + `/public/quotes/${newToken}/decline`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason: "over budget" }) });
    assert.equal(((await decline.json()) as { status: string }).status, "rejected");
    const rejected = await prisma.quote.findUnique({ where: { id: quote.id }, select: { status: true, rejectedReason: true } });
    assert.equal(rejected!.status, "rejected");
    assert.equal(rejected!.rejectedReason, "over budget");

    // Drafts never expose a link.
    const draft = await fetch(base + "/quotes", { method: "POST", headers: H, body: JSON.stringify({ title: "Draft only" }) });
    const draftQuote = ((await draft.json()) as { quote: { id: string } }).quote;
    assert.equal((await fetch(base + `/quotes/${draftQuote.id}/public-link`, { method: "POST", headers: H, body: "{}" })).status, 409);
  } finally {
    await close();
  }
});
