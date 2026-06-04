import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

// GET calls list for a campaign. Forwards filters/pagination (limit, offset,
// outcome, abVariant) straight through to the API.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const qs = req.nextUrl.search; // includes leading "?" or ""
  const res = await fetch(`${getApiBaseUrl()}/campaigns/${encodeURIComponent(id)}/calls${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
