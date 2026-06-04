import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

// GET the messaging activity feed (WhatsApp/email sends) for a campaign.
// Forwards filters/pagination (limit, offset, channel, status).
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const qs = req.nextUrl.search;
  const res = await fetch(`${getApiBaseUrl()}/campaigns/${encodeURIComponent(id)}/deliveries${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
