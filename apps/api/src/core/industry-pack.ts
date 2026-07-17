// Industry Pack — per-industry intake configuration (issue #159).
//
// The engine's spine (signal → classify → request + SLA → automation → dashboard)
// is industry-neutral in shape, but the *vocabulary* — intake categories, keyword
// routing, SLA defaults, upsell offer routing — was hardcoded to hospitality. This
// module lifts those literals into a config bundle keyed by `Tenant.industry`, so a
// non-hospitality tenant drives the full loop with no core code change (CLAUDE.md
// product principle #1).
//
// #159 ships two packs: the exact hospitality behaviour (zero regression) and a
// neutral generic pack for every other industry. Richer per-vertical packs
// (manufacturing #165, IT/corporate #166) and the full swappable IndustryPack
// framework with per-tenant DB overrides (#160) build on this shape.

export interface IntakePack {
  /** Industry key this pack serves (matches `Tenant.industry`). */
  industry: string;
  /** Allowed intake categories offered to the classifier + keyword fallback. */
  categories: string[];
  /** Category used when nothing else matches (keyword fallback + sanitiser default). */
  defaultCategory: string;
  /**
   * Ordered keyword→category rules for the no-AI fallback classifier. First rule
   * whose keyword appears in the message wins; if none match, `defaultCategory`.
   */
  keywordRules: Array<{ category: string; keywords: string[] }>;
  /** category → the team/department that should handle it (drives `routingHint`). */
  routing: Record<string, string>;
  sla: {
    /** priority → SLA minutes. */
    byPriority: Record<string, number>;
    /** SLA minutes when priority is unknown or an AI value is invalid. */
    defaultMinutes: number;
    /** SLA minutes for SRs auto-created by the automation engine. */
    autoMinutes: number;
  };
  offerRouting: {
    /** resolved-request category → upsell offer type. */
    byCategory: Record<string, string>;
    /** offer type when the category has no specific mapping. */
    default: string;
  };
}

// ── Hospitality — reproduces the pre-#159 hardcoded behaviour byte-for-byte. ────
// Every value below must match the literals it replaced (ingest.ts keyword ladder
// + SLA, automations/engine.ts offer routing + auto-SR SLA) so existing tests stay
// green and live hotel tenants see zero behavioural change.
const HOSPITALITY_PACK: IntakePack = {
  industry: "hospitality",
  categories: ["housekeeping", "maintenance", "fnb", "concierge", "front_desk", "other"],
  defaultCategory: "front_desk",
  keywordRules: [
    { category: "housekeeping", keywords: ["towel", "clean", "housekeep"] },
    { category: "maintenance", keywords: ["ac", "maintenance", "broken", "repair"] },
    { category: "fnb", keywords: ["food", "room service", "dining", "drink"] },
    { category: "front_desk", keywords: ["checkout", "check-out", "bill", "invoice"] },
    { category: "concierge", keywords: ["taxi", "tour", "recommend"] },
  ],
  routing: {
    housekeeping: "housekeeping",
    maintenance: "maintenance",
    fnb: "fnb",
    concierge: "concierge",
    front_desk: "front_desk",
    other: "front_desk",
  },
  sla: {
    byPriority: { urgent: 10, high: 20, normal: 45 },
    defaultMinutes: 45,
    autoMinutes: 30,
  },
  offerRouting: {
    byCategory: { fnb: "fnb_offer", housekeeping: "room_upgrade" },
    default: "late_checkout",
  },
};

// ── Generic — neutral default for any non-hospitality industry. ─────────────────
// Proves the abstraction: switching a tenant's industry changes vocabulary,
// routing and SLA with no core code change. Verticals that want a richer taxonomy
// add their own pack (#165 manufacturing, #166 IT/corporate).
const GENERIC_PACK: IntakePack = {
  industry: "generic",
  categories: ["support", "maintenance", "billing", "general", "other"],
  defaultCategory: "general",
  keywordRules: [
    { category: "maintenance", keywords: ["broken", "repair", "fault", "not working", "fix", "down"] },
    { category: "billing", keywords: ["bill", "invoice", "payment", "charge", "refund"] },
    { category: "support", keywords: ["help", "support", "question", "how do", "issue"] },
  ],
  routing: {
    support: "support",
    maintenance: "maintenance",
    billing: "billing",
    general: "general",
    other: "general",
  },
  sla: {
    byPriority: { urgent: 15, high: 30, normal: 60 },
    defaultMinutes: 60,
    autoMinutes: 30,
  },
  offerRouting: {
    byCategory: {},
    default: "follow_up",
  },
};

const PACKS: Record<string, IntakePack> = {
  hospitality: HOSPITALITY_PACK,
  generic: GENERIC_PACK,
};

/**
 * Resolve the intake pack for a tenant's industry. Unknown / null industries fall
 * back to the generic pack, so a tenant is never left without a working taxonomy.
 * Uses an own-property check so magic keys ("__proto__", "constructor") resolve to
 * the generic pack rather than an inherited Object.prototype value.
 */
export function getIntakePack(industry: string | null | undefined): IntakePack {
  return (industry && Object.prototype.hasOwnProperty.call(PACKS, industry) && PACKS[industry]) || GENERIC_PACK;
}

/**
 * Own-property map lookup with a fallback. Guards against untrusted keys
 * ("__proto__", "constructor", "toString") resolving to inherited members of a
 * plain-object map — those would slip past a plain `map[key] ?? dflt`.
 */
export function packLookup<T>(map: Record<string, T>, key: string, dflt: T): T {
  return Object.prototype.hasOwnProperty.call(map, key) ? map[key] : dflt;
}

/** The hospitality pack, exported so pack-aware helpers can default to it. */
export const DEFAULT_INTAKE_PACK = HOSPITALITY_PACK;
