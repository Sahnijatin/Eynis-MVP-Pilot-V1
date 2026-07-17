import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../../lib/api";

// GET a single call: detail + sentiment timeline + the lead's WhatsApp thread.
export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string; callId: string }> }) {
  const { id, callId } = await ctx.params;
  const token = await getApiToken();
  const res = await fetch(
    `${getApiBaseUrl()}/campaigns/${encodeURIComponent(id)}/calls/${encodeURIComponent(callId)}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}
