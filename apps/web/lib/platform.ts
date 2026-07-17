// Single source of truth for the platform / reseller brand name shown to tenants
// who haven't set their own brand (standard tier) and on the shared platform host.
// Overridable via PLATFORM_BRAND_NAME so a white-label reseller — or a pilot —
// never sees the literal "Eynis". Mirrors the API's PLATFORM_NAME
// (apps/api/src/core/{email,export}/*). Server-side only (reads process.env);
// pass the resolved value into client components as a prop.
export function platformBrand(): string {
  return process.env.PLATFORM_BRAND_NAME?.trim() || "Eynis";
}
