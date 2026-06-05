import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";
export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/contacts/${encodeURIComponent(id)}/score`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  return NextResponse.json(await res.json(), { status: res.status });
}
