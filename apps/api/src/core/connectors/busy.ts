// BUSY Accounting export.
//
// BUSY (Busy Infotech) has no open public API; its supported integration surface is
// file import (Administration → Data Export/Import → Import Voucher from Excel/XML).
// So we generate a BUSY-ready SALES voucher file from an ACCEPTED quote that the
// operator imports in a couple of clicks. This is the honest, dependency-free path;
// automated/live sync is a documented phase-2 (middleware or a local agent).
//
// Important: the voucher reflects the CUSTOMER-FACING selling price (what BUSY should
// invoice), NOT the internal cost breakdown. We allocate the quote's selling price
// across its pieces (groupName) proportional to cost, so nothing about margins or
// component costs leaks into the accounting system.

import { prisma } from "../../db/prisma";
import { gstAmountPaise } from "../quotes/costing";

export interface BusyConfig {
  voucherSeries: string;
  salesLedger: string;
  gstPercent: number;
}

const DEFAULTS: BusyConfig = { voucherSeries: "Main", salesLedger: "Sales", gstPercent: 18 };

export async function resolveBusyConfig(tenantId: string): Promise<BusyConfig> {
  try {
    const cfg = await prisma.connectorConfig.findUnique({
      where: { tenantId_connectorKey: { tenantId, connectorKey: "accounting_busy" } },
      select: { enabled: true, configJson: true },
    });
    if (cfg?.enabled && cfg.configJson) {
      const parsed = JSON.parse(cfg.configJson) as Partial<Record<keyof BusyConfig, string>>;
      return {
        voucherSeries: (parsed.voucherSeries ?? "").toString().trim() || DEFAULTS.voucherSeries,
        salesLedger: (parsed.salesLedger ?? "").toString().trim() || DEFAULTS.salesLedger,
        gstPercent: Number(parsed.gstPercent) >= 0 && Number.isFinite(Number(parsed.gstPercent)) ? Number(parsed.gstPercent) : DEFAULTS.gstPercent,
      };
    }
  } catch {
    /* fall through to defaults */
  }
  return { ...DEFAULTS };
}

export interface VoucherLine {
  itemName: string;
  quantity: number;
  unit: string;
  ratePaise: number; // selling rate (ex-GST) per unit
  amountPaise: number; // selling amount (ex-GST)
}

export interface QuoteForVoucher {
  number: string;
  title: string;
  acceptedAt: Date | null;
  totalPaise: number; // selling price, ex-GST
  lineItems: Array<{ groupName: string; lineCostPaise: number }>;
}

// Allocate the selling price across pieces (groupName) proportional to their cost,
// fixing any rounding remainder on the last piece so the lines sum to the total.
export function buildVoucherLines(quote: QuoteForVoucher): VoucherLine[] {
  const groups = new Map<string, number>();
  for (const l of quote.lineItems) groups.set(l.groupName, (groups.get(l.groupName) ?? 0) + l.lineCostPaise);
  const entries = [...groups.entries()];
  const totalCost = entries.reduce((s, [, c]) => s + c, 0);

  if (entries.length === 0 || totalCost <= 0) {
    // Degenerate: one line for the whole quote.
    return [{ itemName: quote.title, quantity: 1, unit: "unit", ratePaise: quote.totalPaise, amountPaise: quote.totalPaise }];
  }

  const lines: VoucherLine[] = [];
  let allocated = 0;
  entries.forEach(([name, cost], i) => {
    const amount = i === entries.length - 1 ? quote.totalPaise - allocated : Math.round((quote.totalPaise * cost) / totalCost);
    allocated += amount;
    lines.push({ itemName: name, quantity: 1, unit: "unit", ratePaise: amount, amountPaise: amount });
  });
  return lines;
}

const rupees = (paise: number) => (Math.round(paise) / 100).toFixed(2);
const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const xmlEsc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const voucherDate = (d: Date | null) => (d ?? new Date()).toISOString().slice(0, 10);

// BUSY "Import Voucher from Excel" reads a tabular sheet; a CSV maps 1:1 (the operator
// maps columns once). Columns follow BUSY's sales-voucher import layout.
export function buildBusyCsv(quote: QuoteForVoucher, config: BusyConfig, partyName: string): string {
  const header = ["Date", "VoucherType", "Series", "PartyName", "SalesLedger", "ItemName", "Quantity", "Unit", "Rate", "Amount", "GSTPercent", "GSTAmount", "TotalAmount"];
  const date = voucherDate(quote.acceptedAt);
  const rows = buildVoucherLines(quote).map((l) => {
    const gst = gstAmountPaise(l.amountPaise, config.gstPercent);
    return [
      date, "Sales", config.voucherSeries, partyName, config.salesLedger,
      l.itemName, l.quantity, l.unit, rupees(l.ratePaise), rupees(l.amountPaise), config.gstPercent,
      rupees(gst), rupees(l.amountPaise + gst),
    ];
  });
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

// BUSY XML (Data Export/Import). A documented, self-describing envelope for the same
// voucher — importable via Administration → Data Export/Import (XML).
export function buildBusyXml(quote: QuoteForVoucher, config: BusyConfig, partyName: string): string {
  const date = voucherDate(quote.acceptedAt);
  const lines = buildVoucherLines(quote);
  const taxable = lines.reduce((s, l) => s + l.amountPaise, 0);
  const gst = gstAmountPaise(taxable, config.gstPercent);
  const items = lines
    .map(
      (l) =>
        `    <Item>\n      <Name>${xmlEsc(l.itemName)}</Name>\n      <Qty>${l.quantity}</Qty>\n      <Unit>${xmlEsc(l.unit)}</Unit>\n      <Rate>${rupees(l.ratePaise)}</Rate>\n      <Amount>${rupees(l.amountPaise)}</Amount>\n    </Item>`,
    )
    .join("\n");
  return (
    `<?xml version="1.0" encoding="UTF-8"?>\n` +
    `<BusyImport>\n` +
    `  <Voucher Type="Sales" Series="${xmlEsc(config.voucherSeries)}">\n` +
    `    <Date>${date}</Date>\n` +
    `    <PartyName>${xmlEsc(partyName)}</PartyName>\n` +
    `    <SalesLedger>${xmlEsc(config.salesLedger)}</SalesLedger>\n` +
    `    <Reference>${xmlEsc(quote.number)}</Reference>\n` +
    `    <Narration>${xmlEsc(`Sale as per accepted quote ${quote.number} — ${quote.title}`)}</Narration>\n` +
    items +
    `\n    <TaxableAmount>${rupees(taxable)}</TaxableAmount>\n` +
    `    <GSTPercent>${config.gstPercent}</GSTPercent>\n` +
    `    <GSTAmount>${rupees(gst)}</GSTAmount>\n` +
    `    <GrandTotal>${rupees(taxable + gst)}</GrandTotal>\n` +
    `  </Voucher>\n` +
    `</BusyImport>\n`
  );
}
