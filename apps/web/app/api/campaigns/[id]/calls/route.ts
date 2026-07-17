import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

// GET calls list for a campaign. Forwards filters/pagination (limit, offset,
// outcome, abVariant) straight through to the API. With ?format=csv the API
// responds text/csv, so the body must be passed through as-is — re-parsing it
// as JSON throws and turned every CSV export into a 500.
export async function GET(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const qs = req.nextUrl.search; // includes leading "?" or ""
  const upstream = await fetch(`${getApiBaseUrl()}/campaigns/${encodeURIComponent(id)}/calls${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });

  const contentType = upstream.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    const headers = new Headers();
    headers.set("content-type", contentType || "text/csv; charset=utf-8");
    const disposition = upstream.headers.get("content-disposition");
    if (disposition) headers.set("content-disposition", disposition);
    return new Response(await upstream.arrayBuffer(), { status: upstream.status, headers });
  }

  const data = await upstream.json().catch(() => ({ ok: false, error: "Upstream error" }));
  return NextResponse.json(data, { status: upstream.status });
}
