import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

// GET the leads for a campaign. Forwards filters/pagination (limit, offset, tag)
// so the Leads tab can filter by tag and refresh after bulk tagging.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const qs = req.nextUrl.search;
  const res = await fetch(`${getApiBaseUrl()}/campaigns/${encodeURIComponent(id)}/leads${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
