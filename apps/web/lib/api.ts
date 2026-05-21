const getEnv = () => ({
  apiBaseUrl: process.env.EYNIS_API_BASE_URL ?? "http://localhost:4000",
  hotelId: process.env.EYNIS_DEMO_HOTEL_ID ?? "eynis-riviera-1",
  email: process.env.EYNIS_DEMO_OWNER_EMAIL ?? "vikram@theriviera.com",
  role: process.env.EYNIS_DEMO_OWNER_ROLE ?? "owner"
});

export async function getApiToken() {
  const staticToken = String(process.env.EYNIS_API_TOKEN ?? "").trim();
  if (staticToken) return staticToken;

  const env = getEnv();
  const response = await fetch(env.apiBaseUrl + "/auth/token", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      hotelId: env.hotelId,
      email: env.email,
      role: env.role
    }),
    cache: "no-store"
  });
  if (!response.ok) {
    throw new Error("Failed to fetch auth token for web route");
  }
  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    throw new Error("Token response missing token");
  }
  return payload.token;
}

export function getApiBaseUrl() {
  return getEnv().apiBaseUrl;
}
