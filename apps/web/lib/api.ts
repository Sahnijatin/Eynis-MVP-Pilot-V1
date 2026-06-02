import { resolveUserContext } from "./user-context";

const getDemoEnv = () => ({
  apiBaseUrl: process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000",
  hotelId: process.env.EYNIS_DEMO_HOTEL_ID ?? "eynis-riviera-1",
  email: process.env.EYNIS_DEMO_OWNER_EMAIL ?? "vikram@theriviera.com",
  role: process.env.EYNIS_DEMO_OWNER_ROLE ?? "owner"
});

async function fetchToken(apiBaseUrl: string, hotelId: string, email: string, role: string): Promise<string | null> {
  // 3s timeout: if the API is unreachable we MUST NOT hang the server render.
  // Hanging here is what makes a logged-in user land on a blank shell.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const response = await fetch(apiBaseUrl + "/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hotelId, email, role }),
      cache: "no-store",
      signal: ctrl.signal
    });
    if (!response.ok) return null;
    const payload = (await response.json()) as { token?: string };
    return payload.token ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function getApiToken() {
  const staticToken = String(process.env.EYNIS_API_TOKEN ?? "").trim();
  if (staticToken) return staticToken;

  const apiBaseUrl = process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";

  // Resolve from Clerk metadata or DB lookup
  const ctx = await resolveUserContext();
  if (ctx.exists && ctx.hotelId && ctx.email && ctx.role) {
    const token = await fetchToken(apiBaseUrl, ctx.hotelId, ctx.email, ctx.role);
    if (token) return token;
  }

  // Fallback to demo env vars (dev only)
  const env = getDemoEnv();
  const token = await fetchToken(apiBaseUrl, env.hotelId, env.email, env.role);
  if (!token) throw new Error("Failed to fetch auth token for web route");
  return token;
}

export function getApiBaseUrl() {
  return process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";
}
