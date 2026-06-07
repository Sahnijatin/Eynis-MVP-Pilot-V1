import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export const dynamic = "force-dynamic";

// Streams the branded night-audit export (E-9) from the API, attaching the auth
// token server-side so the browser can open/download it without a token. Supports
// pdf (binary) / csv / html — so we pass the body through as raw bytes, never
// upstream.text() (which would corrupt the PDF).
const ALLOWED = new Set(["pdf", "csv", "html"]);

export async function GET(request: Request) {
  const raw = new URL(request.url).searchParams.get("format") ?? "pdf";
  const format = ALLOWED.has(raw) ? raw : "pdf";
  const token = await getApiToken();
  const upstream = await fetch(`${getApiBaseUrl()}/night-audit/export?format=${format}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const body = await upstream.arrayBuffer();
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(body, { status: upstream.status, headers });
}
