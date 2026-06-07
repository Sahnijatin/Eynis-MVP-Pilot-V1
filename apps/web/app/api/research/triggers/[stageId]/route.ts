import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ stageId: string }> }) {
  const { stageId } = await ctx.params;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/research/triggers/${encodeURIComponent(stageId)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
