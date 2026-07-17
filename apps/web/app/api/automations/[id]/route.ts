import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

// PATCH an automation rule — pause / resume (isActive). The engine only fires
// active rules, so this genuinely starts/stops the rule on the next cycle.
export async function PATCH(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const body = await req.json().catch(() => ({}));
  const res = await fetch(`${getApiBaseUrl()}/automations/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
