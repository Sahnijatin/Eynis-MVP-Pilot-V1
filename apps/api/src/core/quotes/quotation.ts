// Quotation letterhead + customer-facing view — the data behind the branded
// quotation PDF. Pure (no Prisma/I/O) so it is unit-testable.
//
// Two concerns live here:
//  1. SellerDetails / BillTo — the per-quote letterhead SNAPSHOT (issuer business/
//     tax/bank details + the customer bill-to block). Stored as JSON on the Quote.
//  2. buildQuotationView — turns the internal cost-component quote into the
//     customer-facing document: one line PER PIECE (groupName) at an allocated
//     selling price, with GST split into CGST/SGST. Internal material/labor/overhead/
//     margin never appears. All money is integer paise.

export interface SellerDetails {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
  gstin?: string;
  pan?: string;
  bankAccountName?: string;
  bankAccountNumber?: string;
  bankName?: string;
  bankBranch?: string;
  ifsc?: string;
  upi?: string;
  signatory?: string;
}

export interface BillTo {
  name?: string;
  address?: string;
  pin?: string;
  phone?: string;
  gstin?: string;
}

const SELLER_KEYS: (keyof SellerDetails)[] = [
  "name", "address", "phone", "email", "gstin", "pan",
  "bankAccountName", "bankAccountNumber", "bankName", "bankBranch", "ifsc", "upi", "signatory",
];
const BILLTO_KEYS: (keyof BillTo)[] = ["name", "address", "pin", "phone", "gstin"];

const str = (v: unknown): string | undefined => {
  const s = typeof v === "string" ? v.trim() : typeof v === "number" ? String(v) : "";
  return s ? s.slice(0, 400) : undefined; // cap to keep the snapshot bounded
};

// Sanitize an untrusted input object down to the known keys (drops anything else).
export function cleanSeller(o: unknown): SellerDetails {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: SellerDetails = {};
  for (const k of SELLER_KEYS) { const v = str(src[k]); if (v) out[k] = v; }
  return out;
}
export function cleanBillTo(o: unknown): BillTo {
  const src = (o ?? {}) as Record<string, unknown>;
  const out: BillTo = {};
  for (const k of BILLTO_KEYS) { const v = str(src[k]); if (v) out[k] = v; }
  return out;
}

export function parseSeller(json: string | null | undefined): SellerDetails {
  if (!json) return {};
  try { return cleanSeller(JSON.parse(json)); } catch { return {}; }
}
export function parseBillTo(json: string | null | undefined): BillTo {
  if (!json) return {};
  try { return cleanBillTo(JSON.parse(json)); } catch { return {}; }
}

// Serialize for storage — returns null when nothing meaningful was provided, so an
// empty letterhead stays NULL in the DB rather than "{}".
export function serializeSeller(o: unknown): string | null {
  const c = cleanSeller(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}
export function serializeBillTo(o: unknown): string | null {
  const c = cleanBillTo(o);
  return Object.keys(c).length ? JSON.stringify(c) : null;
}

export interface QuotationItem {
  name: string; // the piece (groupName)
  spec: string; // its components + dimensions, as a customer-readable spec
  quantity: number;
  unit: string;
  unitPricePaise: number; // ex-GST price per unit
  taxPct: number;
  taxPaise: number; // GST on this line
  amountPaise: number; // ex-GST + tax
}

export interface QuotationView {
  items: QuotationItem[];
  totalQuantity: number;
  subTotalPaise: number; // Σ item amounts (incl. tax)
  taxablePaise: number; // ex-GST taxable value (pre-discount)
  gstPct: number;
  cgstPaise: number;
  sgstPaise: number;
  discountPaise: number;
  grandTotalPaise: number; // taxable + gst − discount
}

interface ViewLine {
  groupName: string;
  name: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  lineCostPaise: number;
}

const dimsOf = (l: ViewLine): string => {
  const parts = [l.lengthMm, l.widthMm, l.heightMm].filter((v): v is number => typeof v === "number" && v > 0);
  return parts.length ? `${parts.join(" × ")} mm` : "";
};

// Build the customer-facing quotation from the internal quote. The selling total is
// allocated across pieces proportional to their internal cost (the customer sees only
// the piece and its price). GST is charged on the pre-discount taxable value and the
// discount is applied after tax — the standard trade-discount presentation.
export function buildQuotationView(q: {
  lineItems: ViewLine[];
  totalPaise: number; // ex-GST selling value, AFTER discount (the engine's stored total)
  discountPaise: number;
  gstPercent: number;
}): QuotationView {
  const gstPct = Math.max(0, Number(q.gstPercent) || 0);
  const discountPaise = Math.max(0, Math.round(Number(q.discountPaise) || 0));
  const netTotal = Math.max(0, Math.round(Number(q.totalPaise) || 0));
  const taxablePaise = netTotal + discountPaise; // pre-discount ex-GST value

  // Group the internal lines into pieces, preserving first-seen order.
  const order: string[] = [];
  const groups = new Map<string, ViewLine[]>();
  for (const l of q.lineItems ?? []) {
    if (!groups.has(l.groupName)) { groups.set(l.groupName, []); order.push(l.groupName); }
    groups.get(l.groupName)!.push(l);
  }
  const costByGroup = order.map((g) => groups.get(g)!.reduce((s, l) => s + Math.max(0, l.lineCostPaise), 0));
  const totalCost = costByGroup.reduce((s, c) => s + c, 0);

  const items: QuotationItem[] = [];
  let allocated = 0;
  let gstTotal = 0;
  order.forEach((group, i) => {
    const last = i === order.length - 1;
    const exTax = last || totalCost <= 0
      ? taxablePaise - allocated
      : Math.round((taxablePaise * costByGroup[i]) / totalCost);
    allocated += exTax;
    const tax = Math.round((exTax * gstPct) / 100);
    gstTotal += tax;
    const lines = groups.get(group)!;
    const spec = lines.map((l) => { const d = dimsOf(l); return d ? `${l.name} (${d})` : l.name; }).join(", ");
    items.push({ name: group, spec, quantity: 1, unit: "unit", unitPricePaise: exTax, taxPct: gstPct, taxPaise: tax, amountPaise: exTax + tax });
  });

  // Degenerate case (no line items): a single line for the whole quote.
  if (items.length === 0 && taxablePaise > 0) {
    const tax = Math.round((taxablePaise * gstPct) / 100);
    gstTotal = tax;
    items.push({ name: "Quotation", spec: "", quantity: 1, unit: "unit", unitPricePaise: taxablePaise, taxPct: gstPct, taxPaise: tax, amountPaise: taxablePaise + tax });
  }

  const cgstPaise = Math.round(gstTotal / 2);
  const sgstPaise = gstTotal - cgstPaise; // remainder on SGST so the two halves sum exactly
  const subTotalPaise = items.reduce((s, it) => s + it.amountPaise, 0);

  return {
    items,
    totalQuantity: items.reduce((s, it) => s + it.quantity, 0),
    subTotalPaise,
    taxablePaise,
    gstPct,
    cgstPaise,
    sgstPaise,
    discountPaise,
    grandTotalPaise: taxablePaise + gstTotal - discountPaise,
  };
}
