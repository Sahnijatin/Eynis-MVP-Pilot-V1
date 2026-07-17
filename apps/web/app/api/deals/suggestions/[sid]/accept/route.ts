import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../../lib/api";
export async function POST(_req: NextRequest, ctx: { params: Promise<{ sid: string }> }) {
  const { sid } = await ctx.params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/deals/suggestions/${encodeURIComponent(sid)}/accept`, { method: "POST", headers: { Authorization: `Bearer ${token}` } });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}
