// Impure adapter over the pure schedule logic: decides whether a campaign may
// contact leads right now, resolving the timezone (campaign override → hotel →
// Asia/Kolkata). Shared by the dialler and the messaging dispatcher so both
// honour send windows / quiet-hours / scheduled starts identically.

import { prisma } from "../../db/prisma";
import { isWithinSendWindow, parseSendDays } from "./schedule";

interface ScheduledCampaign {
  hotelId: string;
  scheduledStartAt: Date | null;
  sendWindowStartMin: number | null;
  sendWindowEndMin: number | null;
  sendDays: string;
  sendTimeZone: string | null;
}

export async function campaignMaySendNow(c: ScheduledCampaign, now = new Date()): Promise<boolean> {
  const days = parseSendDays(c.sendDays);
  const hasWindow = c.sendWindowStartMin != null && c.sendWindowEndMin != null;
  // Fast path: nothing scheduled → no timezone lookup, no work.
  if (!c.scheduledStartAt && !hasWindow && days.length === 0) return true;

  let timeZone = c.sendTimeZone ?? null;
  if (!timeZone) {
    const hotel = await prisma.hotel.findUnique({ where: { id: c.hotelId }, select: { timezone: true } });
    timeZone = hotel?.timezone ?? "Asia/Kolkata";
  }
  return isWithinSendWindow(now, {
    scheduledStartAt: c.scheduledStartAt,
    windowStartMin: c.sendWindowStartMin,
    windowEndMin: c.sendWindowEndMin,
    days,
    timeZone,
  }).ok;
}
