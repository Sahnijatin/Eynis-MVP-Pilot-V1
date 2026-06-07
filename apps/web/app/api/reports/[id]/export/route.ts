import { NextRequest } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../lib/api";

export const dynamic = "force-dynamic";

// GET /api/reports/:id/export?format=csv — stream the branded CSV (binary-safe).
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const token = await getApiToken();
  const upstream = await fetch(`${getApiBaseUrl()}/reports/${encodeURIComponent(id)}/export?format=csv`, {
    headers: { Authorization: `Bearer ${token}` }, cache: "no-store",
  });
  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "text/csv; charset=utf-8");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(body, { status: upstream.status, headers });
}
