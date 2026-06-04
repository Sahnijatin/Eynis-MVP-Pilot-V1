import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

// Lifecycle actions: activate | pause | complete.
const ALLOWED = new Set(["activate", "pause", "complete"]);

export async function POST(_req: NextRequest, ctx: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await ctx.params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ ok: false, error: "Unknown action" }, { status: 404 });
  }
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/campaigns/${encodeURIComponent(id)}/${action}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
  });
  return NextResponse.json(await res.json(), { status: res.status });
}
