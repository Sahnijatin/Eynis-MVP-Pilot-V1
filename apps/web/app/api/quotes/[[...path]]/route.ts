import { NextRequest } from "next/server";
import { proxyApi } from "../../../../lib/proxy";

// Catch-all proxy for every /quotes[...] backend route (list/create, :id CRUD,
// lines, calc, parse, send/accept/reject/expire, pdf, busy-export).
function target(path?: string[]): string {
  return "/quotes" + (path && path.length ? "/" + path.map(encodeURIComponent).join("/") : "");
}

type Ctx = { params: Promise<{ path?: string[] }> };

export async function GET(req: NextRequest, ctx: Ctx) {
  return proxyApi(req, target((await ctx.params).path));
}
export async function POST(req: NextRequest, ctx: Ctx) {
  return proxyApi(req, target((await ctx.params).path));
}
export async function PATCH(req: NextRequest, ctx: Ctx) {
  return proxyApi(req, target((await ctx.params).path));
}
export async function DELETE(req: NextRequest, ctx: Ctx) {
  return proxyApi(req, target((await ctx.params).path));
}
