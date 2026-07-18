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

// ── Manufacturing (#165) — first real non-hospitality vertical. ────────────────
// Subject = machine / line / asset; signals = downtime, maintenance, quality and
// safety events arriving via the cross-vertical webhook/CSV doors (#162). Keyword
// rules are ordered by urgency so a safety-critical or downtime message wins over a
// generic maintenance match; routing sends each category to its owning department.
const MANUFACTURING_PACK: IntakePack = {
  industry: "manufacturing",
  categories: ["safety", "downtime", "quality", "maintenance", "general"],
  defaultCategory: "maintenance",
  keywordRules: [
    { category: "safety", keywords: ["hazard", "injury", "unsafe", "leak", "fire", "gas", "accident", "spill"] },
    { category: "downtime", keywords: ["down", "stopped", "halt", "offline", "breakdown", "not running", "jam", "tripped"] },
    { category: "quality", keywords: ["defect", "reject", "scrap", "out of spec", "quality", "rework", "tolerance"] },
    { category: "maintenance", keywords: ["repair", "service", "broken", "worn", "lubricat", "spare", "vibration", "noise", "overheat"] },
  ],
  routing: {
    safety: "safety",
    downtime: "maintenance",
    quality: "quality",
    maintenance: "maintenance",
    general: "supervisor",
  },
  sla: {
    // Downtime/safety come in as urgent/high wording → tight response; a routine
    // maintenance note (normal) gets an hour.
    byPriority: { urgent: 10, high: 30, normal: 60 },
    defaultMinutes: 60,
    autoMinutes: 30,
  },
  offerRouting: {
    // No upsell flow on the plant floor; automations for manufacturing don't queue
    // offers, so this is never consulted, but kept well-formed.
    byCategory: {},
    default: "follow_up",
  },
};

const PACKS: Record<string, IntakePack> = {
  hospitality: HOSPITALITY_PACK,
  manufacturing: MANUFACTURING_PACK,
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

// ── Vocabulary (#160) ──────────────────────────────────────────────────────────
// The tenant-facing nouns for a vertical. Relocated here from ai/intelligence.ts so
// vocabulary is one facet of the industry pack rather than a parallel registry
// (CLAUDE.md product principle #1). Kept API-local so the API has no dependency on
// the web's industry-config.
export interface IndustryTerms {
  label: string; // human-readable industry name
  request: string; // singular unit of work ("service request", "order" …)
  requestPlural: string;
  contactPlural: string; // people the tenant serves ("guests", "patients" …)
}

const INDUSTRY_TERMS: Record<string, IndustryTerms> = {
  hospitality: { label: "Hospitality", request: "service request", requestPlural: "service requests", contactPlural: "guests" },
  manufacturing: { label: "Manufacturing", request: "order", requestPlural: "orders", contactPlural: "clients" },
  fnb: { label: "Food & Beverage", request: "order", requestPlural: "orders", contactPlural: "diners" },
  travel: { label: "Travel", request: "booking", requestPlural: "bookings", contactPlural: "travellers" },
  healthcare: { label: "Healthcare", request: "appointment", requestPlural: "appointments", contactPlural: "patients" },
};

export function getIndustryTerms(industry: string | null | undefined): IndustryTerms {
  return (industry && Object.prototype.hasOwnProperty.call(INDUSTRY_TERMS, industry) && INDUSTRY_TERMS[industry]) || {
    label: "Operations", request: "request", requestPlural: "requests", contactPlural: "contacts",
  };
}

// ── Automation set (#160) ──────────────────────────────────────────────────────
// The operational automation rules the engine evaluates every 60s. A pack declares
// WHICH rule codes are active for its vertical; the definitions below are the seed
// data used to provision those rows on a new tenant (see
// core/automations/provision.ts). Effects are already industry-aware via getIntakePack
// (#159); this makes the *set* of active rules pack-driven too.
export interface AutomationRuleDef {
  code: string;
  name: string;
  configJson: string;
}

export const OPERATIONAL_RULE_DEFS: Record<string, AutomationRuleDef> = {
  sla_breach_escalate: {
    code: "sla_breach_escalate",
    name: "SLA Breach → Auto-Escalate",
    configJson: JSON.stringify({ ruleType: "operational", trigger: { type: "sla_breach" }, action: { type: "escalate_sr" } }),
  },
  sentiment_low_flag: {
    code: "sentiment_low_flag",
    name: "Negative Sentiment → Flag for Review",
    // Category/priority of the created SR are derived from the tenant's intake pack
    // at run time (#159), so they are intentionally not hardcoded here.
    configJson: JSON.stringify({ ruleType: "operational", trigger: { type: "sentiment_low", params: { threshold: 2 } }, action: { type: "create_sr" } }),
  },
  checkin_welcome: {
    code: "checkin_welcome",
    name: "Check-in → Welcome WhatsApp",
    configJson: JSON.stringify({ ruleType: "operational", trigger: { type: "checkin_within_minutes", params: { minutes: 30 } }, action: { type: "send_whatsapp", params: { template: "welcome" } } }),
  },
  upsell_followup: {
    code: "upsell_followup",
    name: "Resolved Request → Queue Upsell",
    configJson: JSON.stringify({ ruleType: "operational", trigger: { type: "sr_resolved_within_hours", params: { hours: 2 } }, action: { type: "queue_offer" } }),
  },
};

// SLA escalation and sentiment flagging apply to any operations vertical; check-in
// welcome and upsell follow-up assume arrival/offer flows a hotel has, so they ship
// only in the hospitality pack. A new vertical picks its set by listing rule codes.
const HOSPITALITY_AUTOMATIONS = ["sla_breach_escalate", "sentiment_low_flag", "checkin_welcome", "upsell_followup"];
const GENERIC_AUTOMATIONS = ["sla_breach_escalate", "sentiment_low_flag"];

// ── Composed Industry Pack (#160) ──────────────────────────────────────────────
// The single per-tenant bundle: vocabulary + intake taxonomy + automation set,
// keyed by Tenant.industry. Standing up a new vertical is adding vocabulary +
// (optionally) an intake pack and an automation list — no engine change.
export interface IndustryPack {
  industry: string;
  label: string;
  vocabulary: IndustryTerms;
  intake: IntakePack;
  /** Active operational automation rule codes (keys of OPERATIONAL_RULE_DEFS). */
  automations: string[];
}

export function getIndustryPack(industry: string | null | undefined): IndustryPack {
  const vocabulary = getIndustryTerms(industry);
  const intake = getIntakePack(industry);
  const automations = industry === "hospitality" ? HOSPITALITY_AUTOMATIONS : GENERIC_AUTOMATIONS;
  return {
    industry: industry || "generic",
    label: vocabulary.label,
    vocabulary,
    intake,
    automations: [...automations], // copy so callers can't mutate the module constant
  };
}
