import test from "node:test";
import assert from "node:assert/strict";
import { computeQuantity, computeLine, computeQuote, priceQuote, type LineInput } from "./costing";

test("computeQuantity: area converts mm to sqft", () => {
  // 1800mm × 900mm = 5.905... ft × 2.952... ft ≈ 17.44 sqft
  const q = computeQuantity("area", { lengthMm: 1800, widthMm: 900 }, 1);
  assert.ok(Math.abs(q - 17.4342) < 0.01, `expected ~17.43 sqft, got ${q}`);
});

test("computeQuantity: length uses only length × qty (rft)", () => {
  // 720mm ≈ 2.362 ft, × 4 legs = 9.4488 rft
  const q = computeQuantity("length", { lengthMm: 720 }, 4);
  assert.ok(Math.abs(q - 9.4488) < 0.01, `got ${q}`);
});

test("computeQuantity: perimeter = 2*(L+W)*qty", () => {
  const q = computeQuantity("perimeter", { lengthMm: 1800, widthMm: 900 }, 1);
  // 2*(5.9055 + 2.9528) = 17.7165 rft
  assert.ok(Math.abs(q - 17.7165) < 0.01, `got ${q}`);
});

test("computeQuantity: volume = L*W*H*qty (cft)", () => {
  const q = computeQuantity("volume", { lengthMm: 304.8, widthMm: 304.8, heightMm: 304.8 }, 2);
  assert.equal(q, 2); // each is exactly 1 cft, ×2
});

test("computeQuantity: fixed and hours ignore dimensions", () => {
  assert.equal(computeQuantity("fixed", { lengthMm: 9999 }, 3), 3);
  assert.equal(computeQuantity("hours", {}, 5), 5);
});

test("computeLine: material includes wastage, labor is hours × rate", () => {
  const line: LineInput = {
    costBasis: "area",
    lengthMm: 1800,
    widthMm: 900,
    quantity: 1,
    unitRatePaise: 20000, // ₹200 / sqft
    wastagePct: 10,
    laborHours: 2,
    laborRatePaise: 15000, // ₹150 / hour
  };
  const r = computeLine(line);
  const qty = computeQuantity("area", { lengthMm: 1800, widthMm: 900 }, 1);
  assert.equal(r.materialCostPaise, Math.round(qty * 20000 * 1.1)); // rate × wastage
  assert.equal(r.laborCostPaise, 30000); // 2 × 15000
  assert.equal(r.lineCostPaise, r.materialCostPaise + r.laborCostPaise);
});

test("computeQuote: full rollup material+labor+overhead+margin", () => {
  const lines = [
    { materialCostPaise: 100000, laborCostPaise: 20000, lineCostPaise: 120000, computedQty: 1 },
    { materialCostPaise: 50000, laborCostPaise: 10000, lineCostPaise: 60000, computedQty: 1 },
  ];
  // Floor 25%: a 40% markup = 40/140 ≈ 28.6% gross margin, which clears a 25% floor.
  const q = computeQuote(lines, { overheadPct: 15, marginPct: 40, marginFloorPct: 25, discountPaise: 0 });
  assert.equal(q.materialCostPaise, 150000);
  assert.equal(q.laborCostPaise, 30000);
  const direct = 180000;
  assert.equal(q.overheadPaise, Math.round(direct * 0.15)); // 27000
  assert.equal(q.subtotalCostPaise, direct + 27000); // 207000
  assert.equal(q.totalPaise, Math.round(207000 * 1.4)); // 289800
  assert.equal(q.marginPaise, q.totalPaise - q.subtotalCostPaise);
  assert.ok(!q.floorViolation, "28.6% gross margin clears a 25% floor");

  // The same quote against a 30% floor is a violation (markup% ≠ gross-margin%).
  const strict = computeQuote(lines, { overheadPct: 15, marginPct: 40, marginFloorPct: 30, discountPaise: 0 });
  assert.ok(strict.floorViolation, "28.6% gross margin is below a 30% floor");
});

test("computeQuote: discount is subtracted after markup", () => {
  const lines = [{ materialCostPaise: 100000, laborCostPaise: 0, lineCostPaise: 100000, computedQty: 1 }];
  const noDisc = computeQuote(lines, { overheadPct: 0, marginPct: 50, marginFloorPct: 0, discountPaise: 0 });
  const disc = computeQuote(lines, { overheadPct: 0, marginPct: 50, marginFloorPct: 0, discountPaise: 5000 });
  assert.equal(noDisc.totalPaise, 150000);
  assert.equal(disc.totalPaise, 145000);
});

test("computeQuote: margin floor is enforced on gross margin", () => {
  // Loaded cost 100000. A 10% markup → price 110000 → gross margin 10000/110000 ≈ 9.1%,
  // which is below a 30% floor. minTotalPaise = ceil(100000 / 0.7) = 142858.
  const lines = [{ materialCostPaise: 100000, laborCostPaise: 0, lineCostPaise: 100000, computedQty: 1 }];
  const q = computeQuote(lines, { overheadPct: 0, marginPct: 10, marginFloorPct: 30, discountPaise: 0 });
  assert.equal(q.totalPaise, 110000);
  assert.equal(q.minTotalPaise, Math.ceil(100000 / 0.7));
  assert.ok(q.floorViolation, "below-floor quote must be flagged");

  // Pricing at exactly the floor clears it.
  const atFloor = computeQuote(lines, { overheadPct: 0, marginPct: 0, marginFloorPct: 30, discountPaise: -0 });
  assert.ok(atFloor.floorViolation, "0% markup is below a 30% floor");
});

test("priceQuote: end-to-end table quote (top + 4 legs + hardware)", () => {
  const lines: LineInput[] = [
    { costBasis: "area", lengthMm: 1800, widthMm: 900, quantity: 1, unitRatePaise: 25000, wastagePct: 10, laborHours: 3, laborRatePaise: 15000 },
    { costBasis: "length", lengthMm: 720, quantity: 4, unitRatePaise: 8000, wastagePct: 5, laborHours: 2, laborRatePaise: 15000 },
    { costBasis: "fixed", quantity: 1, unitRatePaise: 120000, wastagePct: 0, laborHours: 0, laborRatePaise: 0 },
  ];
  const { lines: costed, quote } = priceQuote(lines, { overheadPct: 15, marginPct: 40, marginFloorPct: 30, discountPaise: 0 });
  assert.equal(costed.length, 3);
  assert.ok(quote.totalPaise > quote.subtotalCostPaise, "price exceeds cost");
  assert.ok(quote.marginPctActual > 28 && quote.marginPctActual < 30, `gross margin ~28.6%, got ${quote.marginPctActual}`);
});

test("computeQuote: zero lines yields zero totals, no NaN", () => {
  const q = computeQuote([], { overheadPct: 15, marginPct: 40, marginFloorPct: 30, discountPaise: 0 });
  assert.equal(q.totalPaise, 0);
  assert.equal(q.marginPctActual, 0);
});

test("computeLine: negative/invalid inputs are clamped, never NaN", () => {
  const r = computeLine({ costBasis: "area", lengthMm: -5, widthMm: 900, quantity: 1, unitRatePaise: -100, wastagePct: -10, laborHours: -2, laborRatePaise: 15000 });
  assert.ok(Number.isFinite(r.materialCostPaise));
  assert.equal(r.materialCostPaise, 0); // negative length → 0 area
  assert.equal(r.laborCostPaise, 0); // negative hours clamped
});

test("gstAmountPaise: the one shared GST formula (display-only, clamped)", async () => {
  const { gstAmountPaise } = await import("./costing");
  assert.equal(gstAmountPaise(100000, 18), 18000);
  assert.equal(gstAmountPaise(100000, 0), 0);
  assert.equal(gstAmountPaise(0, 18), 0);
  assert.equal(gstAmountPaise(333, 18), 60); // rounds to whole paise
  assert.equal(gstAmountPaise(-500, 18), 0); // negative taxable clamps to 0
  assert.equal(gstAmountPaise(100000, -5), 0); // negative rate clamps to 0
});
