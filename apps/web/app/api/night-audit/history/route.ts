import { getApiBaseUrl, getApiToken } from "../../../../lib/api";

export const dynamic = "force-dynamic";

// Proxy for the browsable list of past night-audit reports (E-15).
export async function GET() {
  const token = await getApiToken();
  const res = await fetch(`${getApiBaseUrl()}/night-audit/history`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store"
  });
  return Response.json(await res.json() as unknown, { status: res.status });
}
