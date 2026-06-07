import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export const dynamic = "force-dynamic";

// Streams the branded night-audit export (E-9) from the API, attaching the auth
// token server-side so the browser can open/download it without a token. Supports
// pdf (binary) / csv / html — so we pass the body through as raw bytes, never
// upstream.text() (which would corrupt the PDF).
const ALLOWED = new Set(["pdf", "csv", "html"]);

const DATE_ONLY_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const raw = params.get("format") ?? "pdf";
  const format = ALLOWED.has(raw) ? raw : "pdf";
  // Optional date selects a specific past report (E-15); else the API uses latest.
  const date = params.get("date");
  const dateQs = date && DATE_ONLY_RE.test(date) ? `&date=${date}` : "";
  const token = await getApiToken();
  const upstream = await fetch(`${getApiBaseUrl()}/night-audit/export?format=${format}${dateQs}`, {
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
