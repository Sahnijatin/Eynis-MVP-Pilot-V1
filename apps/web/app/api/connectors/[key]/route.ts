import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export const dynamic = "force-dynamic";

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const body = await request.json() as unknown;
  const token = await getApiToken();

  const res = await fetch(`${getApiBaseUrl()}/connectors/configs/${encodeURIComponent(key)}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body),
    cache: "no-store"
  });

  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" })) as unknown;
  return Response.json(data, { status: res.status });
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ key: string }> }
) {
  const { key } = await params;
  const token = await getApiToken();

  const res = await fetch(`${getApiBaseUrl()}/connectors/configs/${encodeURIComponent(key)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });

  const data = await res.json().catch(() => ({ ok: false, error: "Upstream error" })) as unknown;
  return Response.json(data, { status: res.status });
}
