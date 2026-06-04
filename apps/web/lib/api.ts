import { resolveUserContext } from "./user-context";

const getDemoEnv = () => ({
  apiBaseUrl: process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000",
  tenantId: process.env.EYNIS_DEMO_HOTEL_ID ?? "eynis-riviera-1",
  email: process.env.EYNIS_DEMO_OWNER_EMAIL ?? "vikram@theriviera.com",
  role: process.env.EYNIS_DEMO_OWNER_ROLE ?? "owner"
});

async function fetchToken(apiBaseUrl: string, tenantId: string, email: string, role: string): Promise<string | null> {
  // 3s timeout: if the API is unreachable we MUST NOT hang the server render.
  // Hanging here is what makes a logged-in user land on a blank shell.
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 3000);
  try {
    const response = await fetch(apiBaseUrl + "/auth/token", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tenantId, email, role }),
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

// The demo/showcase fallback is opt-in: it serves a shared demo hotel's data to any
// caller, so it must never be reachable in a real multi-tenant deployment.
const demoFallbackAllowed = () =>
  String(process.env.EYNIS_ALLOW_DEMO_FALLBACK ?? "").toLowerCase() === "true";

export async function getApiToken() {
  const staticToken = String(process.env.EYNIS_API_TOKEN ?? "").trim();
  if (staticToken) return staticToken;

  const apiBaseUrl = getApiBaseUrl();

  // Resolve from Clerk metadata or DB lookup
  const ctx = await resolveUserContext();
  if (ctx.exists && ctx.tenantId && ctx.email && ctx.role) {
    const token = await fetchToken(apiBaseUrl, ctx.tenantId, ctx.email, ctx.role);
    if (token) return token;
    // The user resolved to a real hotel but token issuance failed (API blip/timeout).
    // We MUST NOT fall back to the demo tenant here — doing so would serve another
    // hotel's data to a logged-in user. Surface the error to the boundary instead.
    throw new Error("Failed to fetch auth token for the current user");
  }

  // No real workspace resolved. Only serve the shared demo hotel when explicitly
  // allowed (showcase/dev); otherwise fail closed.
  if (!demoFallbackAllowed()) {
    throw new Error("No workspace resolved for the current user");
  }
  const env = getDemoEnv();
  const token = await fetchToken(apiBaseUrl, env.tenantId, env.email, env.role);
  if (!token) throw new Error("Failed to fetch auth token for web route");
  return token;
}

export function getApiBaseUrl() {
  return process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000";
}
