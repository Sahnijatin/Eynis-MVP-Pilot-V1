import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl } from "../../../../../lib/api";
import { joinProxyPath } from "../../../../../lib/proxy";

// Public quote-link proxy (Phase 6) — no auth token attached: possession of the
// quote token in the path IS the credential, verified by the API.
async function forward(req: NextRequest, path: string[], method: "GET" | "POST") {
  const sub = joinProxyPath(path);
  if (sub === null) return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });
  const target = `${getApiBaseUrl()}/public/quotes${sub}`;
  const init: RequestInit = { method, cache: "no-store" };
  if (method === "POST") {
    init.headers = { "content-type": "application/json" };
    init.body = await req.text();
  }
  try {
    const res = await fetch(target, init);
    return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
  } catch {
    return NextResponse.json({ ok: false, error: "Service unavailable" }, { status: 502 });
  }
}

type Ctx = { params: Promise<{ path: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path, "GET");
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return forward(req, (await ctx.params).path, "POST");
}
