import test from "node:test";
import assert from "node:assert/strict";
import { buildQuotationView, cleanSeller, serializeSeller, parseSeller, serializeBillTo, cleanLineImages, gstStateCode } from "./quotation";

// A tiny valid data URL (content isn't decoded by the sanitizer, only shape/size checked).
const DATA_URL = "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBD";

const line = (groupName: string, name: string, lineCostPaise: number, dims?: { l?: number; w?: number; h?: number }) => ({
  groupName, name, lineCostPaise,
  lengthMm: dims?.l ?? null, widthMm: dims?.w ?? null, heightMm: dims?.h ?? null,
});

test("buildQuotationView: one line per piece with selling price allocated by cost", () => {
  const view = buildQuotationView({
    lineItems: [
      line("Dining Table", "Table top", 6000, { l: 1800, w: 900 }),
      line("Dining Table", "Legs", 2000),
      line("Wardrobe", "Carcass", 2000),
    ],
    totalPaise: 100000, // ex-GST selling, after discount
    discountPaise: 0,
    gstPercent: 18,
  });
  // Two pieces; allocation proportional to cost (8000 vs 2000 → 80/20).
  assert.equal(view.items.length, 2);
  assert.equal(view.items[0].name, "Dining Table");
  assert.equal(view.items[0].unitPricePaise, 80000);
  assert.equal(view.items[1].unitPricePaise, 20000); // remainder on last
  // Allocations sum exactly to the taxable value.
  assert.equal(view.items.reduce((s, i) => s + i.unitPricePaise, 0), view.taxablePaise);
  // GST split; halves sum to the full GST.
  assert.equal(view.cgstPaise + view.sgstPaise, view.items.reduce((s, i) => s + i.taxPaise, 0));
  assert.equal(view.taxablePaise, 100000);
  assert.equal(view.grandTotalPaise, 100000 + 18000);
  // Spec carries the piece's components + dimensions.
  assert.match(view.items[0].spec, /Table top \(1800 × 900 mm\)/);
});

test("gstStateCode: extracts the leading 2-digit state code, else null", () => {
  assert.equal(gstStateCode("07ABCDE1234F1Z5"), "07");
  assert.equal(gstStateCode("27AAAAA0000A1Z5"), "27");
  assert.equal(gstStateCode("  08AALCR2857A1ZD "), "08");
  assert.equal(gstStateCode("ABCDE1234F"), null); // no leading numeric state code
  assert.equal(gstStateCode(""), null);
  assert.equal(gstStateCode(null), null);
});

test("buildQuotationView: intra-state → CGST+SGST, no IGST", () => {
  const view = buildQuotationView({
    lineItems: [line("Item", "A", 1000)],
    totalPaise: 100000, discountPaise: 0, gstPercent: 18,
    sellerGstin: "07AAAAA0000A1Z5", // Delhi
    buyerGstin: "07BBBBB1111B1Z5", // Delhi (same state)
  });
  assert.equal(view.interState, false);
  assert.equal(view.igstPaise, 0);
  assert.equal(view.cgstPaise, 9000);
  assert.equal(view.sgstPaise, 9000);
  assert.equal(view.cgstPaise + view.sgstPaise, 18000);
});

test("buildQuotationView: inter-state → single IGST, no CGST/SGST", () => {
  const view = buildQuotationView({
    lineItems: [line("Item", "A", 1000)],
    totalPaise: 100000, discountPaise: 0, gstPercent: 18,
    sellerGstin: "07AAAAA0000A1Z5", // Delhi
    buyerGstin: "27BBBBB1111B1Z5", // Maharashtra (different state)
  });
  assert.equal(view.interState, true);
  assert.equal(view.igstPaise, 18000);
  assert.equal(view.cgstPaise, 0);
  assert.equal(view.sgstPaise, 0);
  assert.equal(view.grandTotalPaise, 100000 + 18000);
});

test("buildQuotationView: unknown/missing buyer GSTIN defaults to intra-state (CGST+SGST)", () => {
  const view = buildQuotationView({
    lineItems: [line("Item", "A", 1000)],
    totalPaise: 100000, discountPaise: 0, gstPercent: 18,
    sellerGstin: "07AAAAA0000A1Z5",
    buyerGstin: null, // unregistered / B2C
  });
  assert.equal(view.interState, false);
  assert.equal(view.igstPaise, 0);
  assert.equal(view.cgstPaise + view.sgstPaise, 18000);
});

test("cleanLineImages: caps at 3 per row, rejects non-image / oversized, drops empty groups", () => {
  const big = "data:image/png;base64," + "A".repeat(2_100_000); // ~1.57 MB > 1.5 MB per-image cap
  const out = cleanLineImages({
    "Dining Table": [DATA_URL, DATA_URL, DATA_URL, DATA_URL], // 4 → capped to 3
    "Wardrobe": ["not-a-data-url", "https://evil/x.png", big], // all rejected → group dropped
    "Empty": [],
    12345: [DATA_URL], // non-string key coerced
  });
  assert.equal(out["Dining Table"].length, 3);
  assert.equal(out["Wardrobe"], undefined);
  assert.equal(out["Empty"], undefined);
  assert.equal(out["12345"].length, 1);
});

test("cleanLineImages: enforces a whole-quote byte budget", () => {
  // ~1.4 MB each (under the 1.5 MB per-image cap); 6 × 1.4 MB = 8.4 MB exceeds the
  // 6 MB whole-quote budget, so some are dropped.
  const img = "data:image/jpeg;base64," + "A".repeat(1_957_000); // ~1.4 MB decoded
  const out = cleanLineImages({ A: [img, img, img], B: [img, img, img] });
  const total = Object.values(out).reduce((s, arr) => s + arr.length, 0);
  assert.ok(total >= 1 && total < 6, `budget drops over-budget images, got ${total}`);
});

test("buildQuotationView: attaches images to the matching piece by groupName", () => {
  const view = buildQuotationView({
    lineItems: [line("Dining Table", "Top", 8000), line("Wardrobe", "Carcass", 2000)],
    totalPaise: 100000, discountPaise: 0, gstPercent: 0,
    images: { "Dining Table": [DATA_URL, DATA_URL] },
  });
  const table = view.items.find((i) => i.name === "Dining Table")!;
  const wardrobe = view.items.find((i) => i.name === "Wardrobe")!;
  assert.equal(table.images.length, 2);
  assert.equal(wardrobe.images.length, 0);
});

test("buildQuotationView: discount is shown pre-tax-value and applied after GST", () => {
  const view = buildQuotationView({
    lineItems: [line("Item", "A", 1000)],
    totalPaise: 90000, // already net of a 10000 discount
    discountPaise: 10000,
    gstPercent: 10,
  });
  assert.equal(view.taxablePaise, 100000); // gross (pre-discount)
  assert.equal(view.discountPaise, 10000);
  const gst = view.cgstPaise + view.sgstPaise;
  assert.equal(gst, 10000); // 10% of gross
  assert.equal(view.grandTotalPaise, 100000 + 10000 - 10000);
});

test("buildQuotationView: no line items still yields a single positive line", () => {
  const view = buildQuotationView({ lineItems: [], totalPaise: 50000, discountPaise: 0, gstPercent: 0 });
  assert.equal(view.items.length, 1);
  assert.equal(view.grandTotalPaise, 50000);
  assert.equal(view.cgstPaise, 0);
});

test("letterhead serialize/parse: sanitizes to known keys and round-trips", () => {
  const clean = cleanSeller({ name: "Akash Furnitures", gstin: "08AALCR2857A1ZD", evil: "<script>", phone: "  +91 99  " });
  assert.equal(clean.name, "Akash Furnitures");
  assert.equal(clean.phone, "+91 99");
  assert.equal((clean as Record<string, unknown>).evil, undefined);

  const json = serializeSeller({ name: "X", ifsc: "SBIN0002836" });
  assert.ok(json && json.includes("SBIN0002836"));
  assert.deepEqual(parseSeller(json), { name: "X", ifsc: "SBIN0002836" });

  // Empty input serializes to null (stays NULL in the DB, not "{}").
  assert.equal(serializeSeller({}), null);
  assert.equal(serializeBillTo({ bogus: 1 }), null);
  assert.deepEqual(parseSeller(null), {});
  assert.deepEqual(parseSeller("not json"), {});
});
