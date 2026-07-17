import { getApiBaseUrl, getApiToken } from "../../../lib/api";

export const dynamic = "force-dynamic";

export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/night-audit/latest`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" })) as unknown;
  return Response.json(data, { status: res.status });
}

export async function POST(request: Request) {
  const body = await request.json() as unknown;
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/night-audit/generate`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    cache: "no-store"
  });
  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" })) as unknown;
  return Response.json(data, { status: res.status });
}
