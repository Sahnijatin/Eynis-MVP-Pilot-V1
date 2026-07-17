import { NextRequest, NextResponse } from "next/server";
import { proxyApi, joinProxyPath } from "../../../../lib/proxy";

// Catch-all proxy for /quote-templates[...] backend routes.
type Ctx = { params: Promise<{ path?: string[] }> };

async function handle(req: NextRequest, ctx: Ctx) {
  const sub = joinProxyPath((await ctx.params).path);
  if (sub === null) return NextResponse.json({ ok: false, error: "Invalid path" }, { status: 400 });
  return proxyApi(req, "/quote-templates" + sub);
}

export async function GET(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function POST(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function PATCH(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
export async function DELETE(req: NextRequest, ctx: Ctx) { return handle(req, ctx); }
