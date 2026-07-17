import { NextRequest, NextResponse } from "next/server";
import { getApiBaseUrl, getApiToken } from "../../../../../../lib/api";

// Forwards the multipart CSV upload (file + columnMap + consent fields) to the
// API's import endpoint. We re-read and rebuild the form so fetch sets a fresh
// multipart boundary; the Authorization header is injected server-side.
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const token = await getApiToken();
  const incoming = await req.formData();
  const forward = new FormData();
  for (const [key, value] of incoming.entries()) forward.append(key, value as string | Blob);

  const res = await fetch(`${getApiBaseUrl()}/campaigns/${encodeURIComponent(id)}/leads/import`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: forward,
  });
  return NextResponse.json(await res.json().catch(() => ({ ok: false, error: "Upstream error" })), { status: res.status });
}
