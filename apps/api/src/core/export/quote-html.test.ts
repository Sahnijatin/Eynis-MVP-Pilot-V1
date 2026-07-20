import test from "node:test";
import assert from "node:assert/strict";
import { renderQuotationHtml } from "./quote-html";
import { buildQuotationView } from "../quotes/quotation";
import type { QuotationPdfData } from "./quote-pdf";

// Pure-function tests for the HTML quotation template (no browser). The HTML→PDF render is
// exercised manually via headless Chromium; here we lock the data → markup mapping,
// escaping, and the GST-presentation branches.

type ViewInput = Parameters<typeof buildQuotationView>[0];
const baseView = (over: Partial<ViewInput> = {}) => {
  const defaults: ViewInput = {
    lineItems: [
      { groupName: "Dining Table", name: "Sheesham top", lengthMm: 1800, widthMm: 900, heightMm: null, lineCostPaise: 4200000 },
      { groupName: "Office Desk", name: "Plywood top", lengthMm: 1500, widthMm: 750, heightMm: null, lineCostPaise: 3700000 },
    ],
    totalPaise: 13000000, discountPaise: 700000, gstPercent: 18,
    hsnByGroup: { "Dining Table": "9403" }, qtyByGroup: { "Office Desk": 2 },
    sellerGstin: "29ABCDE1234F1Z5", placeOfSupplyState: "29",
  };
  return buildQuotationView({ ...defaults, ...over });
};

const baseData = (over: Partial<QuotationPdfData> = {}): QuotationPdfData => ({
  number: "Q-2026-0006", subject: "Home office fit-out", date: new Date("2026-07-20T00:00:00Z"),
  seller: { name: "Tempus Furniture", gstin: "29ABCDE1234F1Z5", ifsc: "HDFC0000123", upi: "tempus@hdfcbank" },
  billTo: { name: "Sharma Residency", address: "Whitefield", pin: "560066" },
  view: baseView(), notes: "50% advance", terms: null, validUntil: new Date("2026-08-04T00:00:00Z"),
  accentColor: "#8a1e24", brandName: "Tempus Furniture", logoUrl: null, imageLinkBase: null,
  ...over,
});

test("renders the static scaffold + core dynamic fields", () => {
  const html = renderQuotationHtml(baseData());
  assert.match(html, /<!doctype html>/i);
  assert.match(html, /Content-Security-Policy/); // hermetic render (no network)
  assert.match(html, /QUOTATION/);
  assert.match(html, />Bill To</);
  assert.match(html, /Tempus Furniture/);
  assert.match(html, /Q-2026-0006/);
  assert.match(html, /Sharma Residency/);
  assert.match(html, /Dining Table/);
  assert.match(html, /HSN 9403/);
  assert.match(html, /Home office fit-out/);          // subject row
  assert.match(html, /Place of Supply/);
  assert.match(html, /Karnataka \(29\)/);
  assert.match(html, /₹1,53,400\.00/);                // grand total
  assert.match(html, /Indian Rupees One Lakh Fifty Three Thousand Four Hundred Only/);
  assert.match(html, /Authorised Signatory for/);
});

test("intra-state quote splits GST into CGST + SGST (no IGST)", () => {
  const html = renderQuotationHtml(baseData());
  assert.match(html, /CGST @9%/);
  assert.match(html, /SGST @9%/);
  assert.doesNotMatch(html, /IGST/);
});

test("inter-state quote charges IGST", () => {
  // Seller in Karnataka (29), place of supply Maharashtra (27) → inter-state.
  const view = baseView({ placeOfSupplyState: "27" });
  const html = renderQuotationHtml(baseData({ view }));
  assert.match(html, /IGST @18%/);
  assert.doesNotMatch(html, /CGST/);
});

test("discount rows appear only when a discount applies", () => {
  const withDisc = renderQuotationHtml(baseData());
  assert.match(withDisc, /Discount/);
  assert.match(withDisc, /− ₹7,000\.00/);
  const noDisc = renderQuotationHtml(baseData({ view: baseView({ totalPaise: 13700000, discountPaise: 0 }) }));
  assert.doesNotMatch(noDisc, />Discount</);
});

test("HTML-escapes untrusted seller/customer text (no injection)", () => {
  const html = renderQuotationHtml(baseData({
    seller: { name: "<script>alert(1)</script>Evil & Co" },
    billTo: { name: "O'Brien \"Sons\" <b>", address: "1 & 2 <lane>" },
  }));
  assert.doesNotMatch(html, /<script>alert/);          // raw script never emitted
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /Evil &amp; Co/);
  assert.match(html, /O&#39;Brien &quot;Sons&quot; &lt;b&gt;/);
});

test("falls back to default terms and shows an em-dash when a piece has no images", () => {
  const html = renderQuotationHtml(baseData({ terms: null }));
  assert.match(html, /This is a quotation and not a tax invoice/); // default terms
  assert.match(html, /—/); // no-image placeholder (both pieces have none here)
});

test("uses the seller logo tile when a logo is provided", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const html = renderQuotationHtml(baseData({ logoUrl: png }));
  assert.match(html, /class="mark mark-img"/);
  assert.match(html, /src="data:image\/png;base64,/);
});
