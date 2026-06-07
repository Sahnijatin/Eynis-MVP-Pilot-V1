import { NextRequest } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

const ALLOWED = new Set(["csv", "html", "pdf"]);

// GET /api/reports/:id/export?format=csv|html|pdf — stream the branded export
// (binary-safe so a PDF isn't corrupted by text round-tripping).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const raw = req.nextUrl.searchParams.get("format") ?? "csv";
  const format = ALLOWED.has(raw) ? raw : "csv";
  const token = await getApiToken();
  const upstream = await fetch(`${getApiBaseUrl()}/reports/${encodeURIComponent(id)}/export?format=${format}`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "text/csv; charset=utf-8");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(body, { status: upstream.status, headers });
}
