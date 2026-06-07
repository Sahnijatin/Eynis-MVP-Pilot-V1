// Real upsell-campaign analytics, computed from the OfferEvent table (offers are
// queued by the upsell_followup automation and marked accepted when they convert).
// Replaces the hard-coded weeklyData / synthetic figures (F-17).

import { prisma } from "../../db/prisma";

const DAY_MS = 24 * 60 * 60 * 1000;
const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const OFFER_LABELS: Record<string, string> = {
  room_upgrade: "Room Upgrade",
  fnb_offer: "F&B Offer",
  late_checkout: "Late Checkout",
};
const prettyOfferType = (t: string) => OFFER_LABELS[t] ?? t.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

export interface UpsellItem {
  id: string;
  name: string;
  status: string;
  trigger: string;
  recipients: number;
  conversions: number;
  conversionRate: number;
  revenueInr: number;
}
export interface UpsellAnalytics {
  ok: true;
  items: UpsellItem[];
  total: number;
  weeklyData: Array<{ day: string; executions: number; conversions: number }>;
}

const isConverted = (status: string) => status === "accepted" || status === "converted";

export async function computeUpsellAnalytics(tenantId: string, range?: { from: Date; to: Date }): Promise<UpsellAnalytics> {
  // When a window is given (E-15) filter offers to it; otherwise keep the prior
  // all-time behaviour. The weekly chart is always the 7 days ending at `now`.
  const now = range?.to ?? new Date();
  const weekAgo = new Date(now.getTime() - 7 * DAY_MS);
  const offers = await prisma.offerEvent.findMany({
    where: { tenantId, ...(range ? { createdAt: { gte: range.from, lte: range.to } } : {}) },
    select: { offerType: true, status: true, revenueInr: true, createdAt: true },
  });

  // Group by offer type → one "campaign" row each, with real conversion + revenue.
  const byType = new Map<string, { recipients: number; conversions: number; revenueInr: number }>();
  for (const o of offers) {
    const cur = byType.get(o.offerType) ?? { recipients: 0, conversions: 0, revenueInr: 0 };
    cur.recipients += 1;
    if (isConverted(o.status)) { cur.conversions += 1; cur.revenueInr += o.revenueInr; }
    byType.set(o.offerType, cur);
  }
  const items: UpsellItem[] = [...byType.entries()]
    .sort((a, b) => b[1].revenueInr - a[1].revenueInr)
    .map(([offerType, v]) => ({
      id: offerType,
      name: prettyOfferType(offerType),
      status: "Active",
      trigger: "Automation",
      recipients: v.recipients,
      conversions: v.conversions,
      conversionRate: v.recipients > 0 ? Math.round((v.conversions / v.recipients) * 1000) / 10 : 0,
      revenueInr: v.revenueInr,
    }));

  // Last 7 calendar days, executions = offers queued, conversions = offers converted.
  const recent = offers.filter((o) => o.createdAt >= weekAgo);
  const weeklyData = Array.from({ length: 7 }, (_, i) => {
    const dayStart = new Date(now.getTime() - (6 - i) * DAY_MS);
    const label = DOW[dayStart.getDay()];
    const dayOffers = recent.filter((o) => Math.floor(o.createdAt.getTime() / DAY_MS) === Math.floor(dayStart.getTime() / DAY_MS));
    return { day: label, executions: dayOffers.length, conversions: dayOffers.filter((o) => isConverted(o.status)).length };
  });

  return { ok: true, items, total: items.length, weeklyData };
}
