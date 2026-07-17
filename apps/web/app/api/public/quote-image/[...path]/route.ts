import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../lib/api";
import { joinProxyPath } from "../../../../../lib/proxy";

// Public quote-image proxy — streams the image BYTES from the API (the existing
// /api/public/quotes proxy only forwards JSON). No auth: possession of the image
// token in the path IS the credential, verified by the API. Passes through the
// content-type and content-disposition (inline vs attachment for ?download=1).
export async function GET(req: NextRequest, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  const sub = joinProxyPath(path);
  if (sub === null) return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });
  const qs = req.nextUrl.search; // preserve ?download=1
  const target = `${getApiBaseUrl()}/public/quote-image${sub}${qs}`;
  try {
    const res = await fetch(target, { cache: "no-store" });
    if (!res.ok) return NextResponse.json({ ok: false, error: "Not found" }, { status: res.status });
    const buf = await res.arrayBuffer();
    return new NextResponse(buf, {
      status: 200,
      headers: {
        "content-type": res.headers.get("content-type") ?? "application/octet-stream",
        "content-disposition": res.headers.get("content-disposition") ?? "inline",
        "cache-control": "private, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ ok: false, error: "Service unavailable" }, { status: 502 });
  }
}
