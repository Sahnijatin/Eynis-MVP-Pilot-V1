// White-label tier (E-9). How much a tenant may customise their instance. Set by
// Eynis staff via the internal provisioning console (shared with E-8/E-10), NOT
// self-serve. Distinct from billing (License.plan).
//
//   standard    — your logo / name / colors on our product; "powered by" stays.
//   white_label — full: hide "powered by", custom font + extended theme tokens,
//                 un-branded artifacts (emails/reports carry only the tenant brand).
export const WHITELABEL_TIERS = ["standard", "white_label"] as const;

export type WhitelabelTier = (typeof WHITELABEL_TIERS)[number];

export const TIER_LABELS: Record<WhitelabelTier, string> = {
  standard: "Standard",
  white_label: "White-label"
};

export const isValidTier = (value: unknown): value is WhitelabelTier =>
  typeof value === "string" && (WHITELABEL_TIERS as readonly string[]).includes(value);

export const tierOptions = (): Array<{ key: WhitelabelTier; label: string }> =>
  WHITELABEL_TIERS.map((key) => ({ key, label: TIER_LABELS[key] }));

// The single gate: does this tier unlock the full white-label feature set
// (hide "powered by", custom font + extended tokens, un-branded artifacts)?
export const allowsFullWhiteLabel = (tier: string | null | undefined): boolean => tier === "white_label";
