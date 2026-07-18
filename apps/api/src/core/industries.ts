// Canonical set of industries a tenant can be provisioned as (E-8).
//
// Industry is set by Eynis staff via the internal provisioning console, never by
// the customer. The API is the gatekeeper for persistence, so this list — not the
// web's `industry-config.ts` — is what actually constrains `Tenant.industry`.
// Keep the two in sync when adding a vertical.
export const VALID_INDUSTRIES = ["hospitality", "manufacturing", "fnb", "travel", "healthcare", "it_services"] as const;

export type IndustryKey = (typeof VALID_INDUSTRIES)[number];

export const INDUSTRY_LABELS: Record<IndustryKey, string> = {
  hospitality: "Hospitality",
  manufacturing: "Manufacturing",
  fnb: "Food & Beverage",
  travel: "Travel",
  healthcare: "Healthcare",
  it_services: "IT / Tech Corporate"
};

export const isValidIndustry = (value: unknown): value is IndustryKey =>
  typeof value === "string" && (VALID_INDUSTRIES as readonly string[]).includes(value);

export const industryOptions = (): Array<{ key: IndustryKey; label: string }> =>
  VALID_INDUSTRIES.map((key) => ({ key, label: INDUSTRY_LABELS[key] }));
