import { getApiBaseUrl, getApiToken } from "../../../../../../lib/api";

export const dynamic = "force-dynamic";

// Streams the branded research export from the API, attaching the auth token
// server-side so the browser can open/download it. pdf is binary, so pass raw
// bytes through (never upstream.text(), which would corrupt the PDF).
const ALLOWED = new Set(["pdf", "csv", "html"]);

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const raw = new URL(request.url).searchParams.get("format") ?? "pdf";
  const format = ALLOWED.has(raw) ? raw : "pdf";
  const token = await getApiToken();
  const upstream = await fetch(
    `${getApiBaseUrl()}/research/runs/${encodeURIComponent(id)}/export?format=${format}`,
    { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" },
  );
  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(body, { status: upstream.status, headers });
}
