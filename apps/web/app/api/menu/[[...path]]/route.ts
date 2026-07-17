import { NextRequest } from "next/server";
import { proxyApi } from "../../../../lib/proxy";

// Catch-all proxy for the menu backend routes (list, create, :id update/delete).
function target(path?: string[]): string {
  return "/menu" + (path && path.length ? "/" + path.map(encodeURIComponent).join("/") : "");
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
