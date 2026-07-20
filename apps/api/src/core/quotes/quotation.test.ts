import test from "node:test";
import assert from "node:assert/strict";
import { buildQuotationView, cleanSeller, serializeSeller, parseSeller, serializeBillTo, cleanLineImages, gstStateCode, cleanHsnByGroup, serializeHsnByGroup, gstStateName, isValidGstin, normalizeStateCode, cleanQtyByGroup, amountInWords } from "./quotation";
import { gstAmountPaise } from "./costing";

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

test("cleanHsnByGroup: keeps 4–8 digit codes, strips non-digits, drops the rest", () => {
  const out = cleanHsnByGroup({
    "Dining Table": "9403",
    "Chair": " 94 01 60 ", // non-digits stripped → "940160" (6 digits, ok)
    "Bad": "12", // too short
    "TooLong": "1234567890", // >8 digits
    "Empty": "",
  });
  assert.equal(out["Dining Table"], "9403");
  assert.equal(out["Chair"], "940160");
  assert.equal(out["Bad"], undefined);
  assert.equal(out["TooLong"], undefined);
  assert.equal(out["Empty"], undefined);
  assert.equal(serializeHsnByGroup({}), null);
});

test("isValidGstin + gstStateCode: only a well-formed GSTIN yields a state code", () => {
  assert.equal(isValidGstin("07ABCDE1234F1Z5"), true);
  assert.equal(isValidGstin("27aaaaa0000a1z5"), true); // case-insensitive
  assert.equal(isValidGstin("+917006013317"), false); // a phone number
  assert.equal(isValidGstin("07ABC"), false);
  // A phone/typo in the GSTIN field must NOT resolve to a state code (would skew IGST).
  assert.equal(gstStateCode("+917006013317"), null);
  assert.equal(gstStateCode("07ABCDE1234F1Z5"), "07");
});

test("normalizeStateCode: accepts real 2-digit GST state codes only", () => {
  assert.equal(normalizeStateCode("27"), "27");
  assert.equal(normalizeStateCode("07"), "07");
  assert.equal(normalizeStateCode("00"), null); // not a real code
  assert.equal(normalizeStateCode("7"), null);
  assert.equal(normalizeStateCode("XX"), null);
});

test("buildQuotationView: explicit place of supply overrides buyer GSTIN for IGST", () => {
  // Buyer GSTIN is same-state (Delhi 07) but ship-to is Maharashtra (27) → inter-state.
  const view = buildQuotationView({
    lineItems: [line("Item", "A", 1000)], totalPaise: 100000, discountPaise: 0, gstPercent: 18,
    sellerGstin: "07AAAAA0000A1Z5", buyerGstin: "07BBBBB1111B1Z5", placeOfSupplyState: "27",
  });
  assert.equal(view.placeOfSupplyState, "27");
  assert.equal(view.interState, true);
  assert.equal(view.igstPaise, 18000);
});

test("buildQuotationView: per-piece quantity yields a per-unit price", () => {
  const view = buildQuotationView({
    lineItems: [line("Chair", "seat", 1000)], totalPaise: 60000, discountPaise: 0, gstPercent: 0,
    qtyByGroup: { Chair: 6, Ghost: 0 }, // Ghost invalid (dropped)
  });
  assert.equal(view.items[0].quantity, 6);
  assert.equal(view.items[0].unitPricePaise, 10000); // 60000 / 6
  assert.equal(view.items[0].amountPaise, 60000); // piece total (qty × unit)
  assert.equal(view.totalQuantity, 6);
});

test("cleanQtyByGroup: keeps positive integers, drops the rest", () => {
  const out = cleanQtyByGroup({ A: 3, B: 0, C: -2, D: 1.9, E: "x" });
  assert.equal(out.A, 3);
  assert.equal(out.D, 1); // floored
  assert.equal(out.B, undefined);
  assert.equal(out.C, undefined);
  assert.equal(out.E, undefined);
});

test("amountInWords: Indian numbering", () => {
  assert.equal(amountInWords(14750000), "Indian Rupees One Lakh Forty Seven Thousand Five Hundred Only");
  assert.equal(amountInWords(10000), "Indian Rupees One Hundred Only");
  assert.equal(amountInWords(12345), "Indian Rupees One Hundred Twenty Three and Forty Five Paise Only");
  assert.equal(amountInWords(0), "Indian Rupees Zero Only");
});

test("gstStateName: maps GST state codes to names", () => {
  assert.equal(gstStateName("07"), "Delhi");
  assert.equal(gstStateName("27"), "Maharashtra");
  assert.equal(gstStateName("99"), "Centre Jurisdiction");
  assert.equal(gstStateName("00"), null);
  assert.equal(gstStateName(null), null);
});

test("buildQuotationView: attaches HSN/SAC to the matching piece by groupName", () => {
  const view = buildQuotationView({
    lineItems: [line("Dining Table", "Top", 8000), line("Wardrobe", "Carcass", 2000)],
    totalPaise: 100000, discountPaise: 0, gstPercent: 18,
    hsnByGroup: { "Dining Table": "9403", "Wardrobe": "abc" }, // invalid code dropped
  });
  assert.equal(view.items.find((i) => i.name === "Dining Table")!.hsn, "9403");
  assert.equal(view.items.find((i) => i.name === "Wardrobe")!.hsn, undefined);
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

test("buildQuotationView: discount reduces the taxable value; GST on the post-discount amount", () => {
  const view = buildQuotationView({
    lineItems: [line("Item", "A", 1000)],
    totalPaise: 90000, // already net of a 10000 discount
    discountPaise: 10000,
    gstPercent: 10,
  });
  assert.equal(view.grossSubtotalPaise, 100000); // list value, pre-discount
  assert.equal(view.discountPaise, 10000);
  assert.equal(view.taxablePaise, 90000); // post-discount GST base
  const gst = view.cgstPaise + view.sgstPaise;
  assert.equal(gst, 9000); // 10% of the POST-discount value (compliant)
  assert.equal(view.grandTotalPaise, 90000 + 9000);
  // The item's list price is gross; its GST allocation sums to the headline.
  assert.equal(view.items[0].unitPricePaise, 100000);
  assert.equal(view.items.reduce((s, i) => s + i.taxPaise, 0), gst);
});

test("buildQuotationView: headline GST/total match gstAmountPaise exactly (PDF ↔ voucher invariant)", () => {
  for (const [total, discount, pct] of [[90000, 10000, 10], [123457, 7777, 18], [50000, 0, 12]] as const) {
    const view = buildQuotationView({ lineItems: [line("A", "a", 3), line("B", "b", 7)], totalPaise: total, discountPaise: discount, gstPercent: pct });
    const expectedGst = gstAmountPaise(total, pct);
    assert.equal(view.cgstPaise + view.sgstPaise + view.igstPaise, expectedGst, `gst for ${total}/${pct}`);
    assert.equal(view.grandTotalPaise, total + expectedGst, `grand for ${total}/${pct}`);
    assert.equal(view.items.reduce((s, i) => s + i.taxPaise, 0), expectedGst, `per-line tax sums to headline for ${total}/${pct}`);
  }
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
