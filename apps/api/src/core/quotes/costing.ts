// Component-based furniture/manufacturing costing — the pure math core.
//
// A quote is a bill of materials: each line (component) is costed by
// dimension × material rate + labor; lines roll up to material/labor subtotals,
// then overhead and margin are applied to reach the selling price. This mirrors
// how furniture makers price in Excel (Selling Price = (Material + Labor +
// Overhead) × (1 + Markup%)), which is exactly the spreadsheet pain we replace.
//
// Everything here is a PURE function on plain numbers (no Prisma, no I/O) so it is
// trivially unit-testable and is reused by both the live-preview route and the
// server-side send/accept guards. All money is integer paise (1 rupee = 100 paise)
// to avoid float drift when multiplying dimensions by rates.

export type CostBasis = "area" | "length" | "perimeter" | "volume" | "fixed" | "hours";

export interface LineInput {
  costBasis: CostBasis;
  lengthMm?: number | null;
  widthMm?: number | null;
  heightMm?: number | null;
  quantity: number;
  unitRatePaise: number; // material rate per unit (sqft/rft/cft/unit)
  wastagePct: number; // added to material to cover offcuts/handling
  laborHours: number;
  laborRatePaise: number; // per hour
}

export interface LineResult {
  computedQty: number; // billable quantity in the costBasis unit
  materialCostPaise: number;
  laborCostPaise: number;
  lineCostPaise: number; // material + labor (pre overhead/margin)
}

export interface QuoteKnobs {
  overheadPct: number;
  marginPct: number;
  marginFloorPct: number;
  discountPaise: number;
}

export interface QuoteResult {
  materialCostPaise: number;
  laborCostPaise: number;
  overheadPaise: number;
  subtotalCostPaise: number; // material + labor + overhead (fully loaded cost)
  marginPaise: number;
  totalPaise: number; // selling price after discount
  marginPctActual: number; // gross margin: margin / total * 100
  minTotalPaise: number; // lowest price that still satisfies the margin floor
  floorViolation: boolean; // total < minTotalPaise
}

const MM_PER_FOOT = 304.8;
const mmToFeet = (mm: number): number => mm / MM_PER_FOOT;

// Coerce a possibly-null dimension to a non-negative number of millimetres.
const mm = (v: number | null | undefined): number =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;

const nn = (v: number): number => (Number.isFinite(v) && v > 0 ? v : 0);

// Derive the billable quantity from the cost basis and dimensions. Dimensions are
// entered in millimetres (shop-floor friendly) and converted to feet, the unit
// Indian furniture makers quote in (sqft/rft/cft).
export function computeQuantity(
  costBasis: CostBasis,
  dims: { lengthMm?: number | null; widthMm?: number | null; heightMm?: number | null },
  quantity: number,
): number {
  const qty = nn(quantity) || (quantity === 0 ? 0 : 1);
  const L = mmToFeet(mm(dims.lengthMm));
  const W = mmToFeet(mm(dims.widthMm));
  const H = mmToFeet(mm(dims.heightMm));
  switch (costBasis) {
    case "area":
      return round4(L * W * qty);
    case "length":
      return round4(L * qty);
    case "perimeter":
      return round4(2 * (L + W) * qty);
    case "volume":
      return round4(L * W * H * qty);
    case "fixed":
    case "hours":
      return round4(qty);
    default:
      return round4(qty);
  }
}

// Cost a single component line. Material = billable qty × rate × (1 + wastage);
// labor = hours × labor rate. For a pure-labor line, unitRatePaise is typically 0.
export function computeLine(line: LineInput): LineResult {
  const computedQty = computeQuantity(line.costBasis, line, line.quantity);
  const wastageFactor = 1 + Math.max(0, nn(line.wastagePct)) / 100;
  const materialCostPaise = Math.round(computedQty * Math.max(0, nn(line.unitRatePaise)) * wastageFactor);
  const laborCostPaise = Math.round(Math.max(0, nn(line.laborHours)) * Math.max(0, nn(line.laborRatePaise)));
  return {
    computedQty,
    materialCostPaise,
    laborCostPaise,
    lineCostPaise: materialCostPaise + laborCostPaise,
  };
}

// Roll up costed lines into a quote total. Overhead is a % of direct (material +
// labor) cost; markup is applied to the fully-loaded cost to get the selling price;
// discount is subtracted last. The margin floor is a floor on GROSS MARGIN
// (margin / price) — the number a manufacturer actually protects — expressed as the
// minimum price that still clears it.
export function computeQuote(lines: LineResult[], knobs: QuoteKnobs): QuoteResult {
  const materialCostPaise = lines.reduce((s, l) => s + l.materialCostPaise, 0);
  const laborCostPaise = lines.reduce((s, l) => s + l.laborCostPaise, 0);
  const direct = materialCostPaise + laborCostPaise;

  const overheadPct = Math.max(0, nn(knobs.overheadPct));
  const marginPct = Math.max(0, nn(knobs.marginPct));
  const marginFloorPct = clampPct(knobs.marginFloorPct);
  const discountPaise = Math.max(0, Math.round(nn(knobs.discountPaise)));

  const overheadPaise = Math.round((direct * overheadPct) / 100);
  const subtotalCostPaise = direct + overheadPaise; // fully loaded cost
  const totalPaise = Math.max(0, Math.round(subtotalCostPaise * (1 + marginPct / 100)) - discountPaise);
  const marginPaise = totalPaise - subtotalCostPaise;
  const marginPctActual = totalPaise > 0 ? round2((marginPaise / totalPaise) * 100) : 0;

  // Minimum price that satisfies the gross-margin floor: price such that
  // (price - cost) / price >= floor  ⇒  price >= cost / (1 - floor).
  const floorFraction = marginFloorPct / 100;
  const minTotalPaise =
    floorFraction >= 1 ? Number.MAX_SAFE_INTEGER : Math.ceil(subtotalCostPaise / (1 - floorFraction));
  const floorViolation = totalPaise < minTotalPaise;

  return {
    materialCostPaise,
    laborCostPaise,
    overheadPaise,
    subtotalCostPaise,
    marginPaise,
    totalPaise,
    marginPctActual,
    minTotalPaise,
    floorViolation,
  };
}

// Convenience: cost raw line inputs and roll them up in one call.
export function priceQuote(lines: LineInput[], knobs: QuoteKnobs): { lines: LineResult[]; quote: QuoteResult } {
  const costed = lines.map(computeLine);
  return { lines: costed, quote: computeQuote(costed, knobs) };
}

// The ONE GST formula (4.4): display-only tax on top of the taxable selling
// total — it never enters the costing/margin math. The serializer, the PDF and
// the BUSY export all call this, so a voucher can never disagree with the quote.
export function gstAmountPaise(taxablePaise: number, gstPercent: number): number {
  return Math.round((Math.max(0, Math.round(taxablePaise)) * Math.max(0, nn(gstPercent))) / 100);
}

function clampPct(v: number): number {
  const n = nn(v);
  if (n < 0) return 0;
  if (n > 99) return 99; // a 100% gross-margin floor is unreachable; cap below it
  return n;
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function round4(v: number): number {
  return Math.round(v * 10000) / 10000;
}
