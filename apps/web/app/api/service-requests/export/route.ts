import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export const dynamic = "force-dynamic";

// Streams the branded service-requests CSV export (E-9) from the API with the
// auth token attached server-side.
export async function GET(request: Request) {
  const status = new URL(request.url).searchParams.get("status");
  const qs = status ? `?status=${encodeURIComponent(status)}` : "";
  const token = await getApiToken();
  const upstream = await fetch(`${getApiBaseUrl()}/service-requests/export${qs}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const body = await upstream.text();
  const headers = new Headers();
  headers.set("content-type", upstream.headers.get("content-type") ?? "application/octet-stream");
  const disposition = upstream.headers.get("content-disposition");
  if (disposition) headers.set("content-disposition", disposition);
  return new Response(body, { status: upstream.status, headers });
}
