// Voice Campaign service helpers (Phase 4).
//
// Pure, testable business logic behind the /campaigns/* endpoints: input
// validation, the allow-listed update builder, stats summarisation, and the
// A/B assistant-provisioning orchestrator (dependency-injected so it can be
// tested without real Vapi keys).

import {
  buildAssistantPayload,
  type AssistantParams,
  type VapiCredentials,
  type VapiResult,
} from "./vapi";

// ── Create validation ─────────────────────────────────────────────────────────

export const SUPPORTED_CHANNELS = ["voice", "whatsapp", "email"] as const;
export type CampaignChannel = (typeof SUPPORTED_CHANNELS)[number];

export interface CampaignCreateValue {
  name: string;
  channels: string[];
  // voice
  scriptTemplate: string | null;
  voiceA: string | null;
  voiceB: string | null;
  personaA: string | null;
  personaB: string | null;
  outcomeTypes: string[];
  followUpRules: Record<string, string[]>;
  calendlyLink: string | null;
  agentName: string | null;
  // whatsapp
  whatsappContentSid: string | null;
  whatsappTemplateBody: string | null;
  whatsappVariables: string[];
  // email
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  // shared
  maxRetries: number;
  retryDelayHours: number;
  maxConcurrent: number;
  spendCapCalls: number | null;
  defaultCountryCode: string;
}

type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const intOr = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : fallback;

// outcome→channels map, e.g. { interested: ["whatsapp","email"] }. Channels are
// constrained to the supported set.
const FOLLOWUP_CHANNELS = new Set(["whatsapp", "email"]);

// Validates the campaign's delivery channels. Defaults to ["voice"] for
// backward compatibility when omitted; rejects unknown or empty sets.
export function validateChannels(input: unknown): string[] | null {
  if (input === undefined || input === null) return ["voice"];
  if (!Array.isArray(input)) return null;
  const set = new Set<string>();
  for (const c of input) {
    if (typeof c !== "string" || !(SUPPORTED_CHANNELS as readonly string[]).includes(c)) return null;
    set.add(c);
  }
  return set.size === 0 ? null : [...set];
}

export function validateStringList(input: unknown): string[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return null;
  return input.filter((v) => typeof v === "string" && v.trim().length > 0).map((v) => (v as string).trim());
}

export function validateFollowUpRules(input: unknown): Record<string, string[]> | null {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) return null;
  const out: Record<string, string[]> = {};
  for (const [outcome, channels] of Object.entries(input as Record<string, unknown>)) {
    if (!Array.isArray(channels)) return null;
    const clean = channels.filter((c) => typeof c === "string" && FOLLOWUP_CHANNELS.has(c)) as string[];
    out[outcome] = clean;
  }
  return out;
}

export function validateOutcomeTypes(input: unknown): string[] | null {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) return null;
  const clean = input.filter((o) => typeof o === "string" && o.trim().length > 0) as string[];
  return clean.map((o) => o.trim());
}

export function validateCampaignCreate(body: Record<string, unknown>): Validated<CampaignCreateValue> {
  const name = str(body.name);
  if (!name) return { ok: false, error: "Missing required field: name" };

  const channels = validateChannels(body.channels);
  if (channels === null) {
    return { ok: false, error: `channels must be a non-empty array of: ${SUPPORTED_CHANNELS.join(", ")}` };
  }

  // Per-channel required fields.
  const scriptTemplate = str(body.scriptTemplate);
  const voiceA = str(body.voiceA);
  const voiceB = str(body.voiceB);
  const personaA = str(body.personaA);
  const personaB = str(body.personaB);
  if (channels.includes("voice")) {
    const missing = Object.entries({ scriptTemplate, voiceA, voiceB, personaA, personaB })
      .filter(([, v]) => v === null).map(([k]) => k);
    if (missing.length > 0) return { ok: false, error: `voice channel requires: ${missing.join(", ")}` };
  }

  const whatsappContentSid = str(body.whatsappContentSid);
  if (channels.includes("whatsapp") && !whatsappContentSid) {
    return { ok: false, error: "whatsapp channel requires whatsappContentSid (an approved template id)" };
  }

  const emailSubjectTemplate = str(body.emailSubjectTemplate);
  const emailBodyTemplate = str(body.emailBodyTemplate);
  if (channels.includes("email") && (!emailSubjectTemplate || !emailBodyTemplate)) {
    return { ok: false, error: "email channel requires emailSubjectTemplate and emailBodyTemplate" };
  }

  const outcomeTypes = validateOutcomeTypes(body.outcomeTypes);
  if (outcomeTypes === null) return { ok: false, error: "outcomeTypes must be an array of strings" };

  const followUpRules = validateFollowUpRules(body.followUpRules);
  if (followUpRules === null) {
    return { ok: false, error: "followUpRules must be an object mapping outcome -> [channels]" };
  }

  const whatsappVariables = validateStringList(body.whatsappVariables);
  if (whatsappVariables === null) return { ok: false, error: "whatsappVariables must be an array of strings" };

  const spendRaw = body.spendCapCalls;
  const spendCapCalls =
    spendRaw === undefined || spendRaw === null
      ? null
      : typeof spendRaw === "number" && Number.isInteger(spendRaw) && spendRaw > 0
        ? spendRaw
        : NaN;
  if (Number.isNaN(spendCapCalls)) return { ok: false, error: "spendCapCalls must be a positive integer" };

  return {
    ok: true,
    value: {
      name,
      channels,
      scriptTemplate, voiceA, voiceB, personaA, personaB,
      outcomeTypes,
      followUpRules,
      calendlyLink: str(body.calendlyLink),
      agentName: str(body.agentName),
      whatsappContentSid,
      whatsappTemplateBody: str(body.whatsappTemplateBody),
      whatsappVariables,
      emailSubjectTemplate,
      emailBodyTemplate,
      maxRetries: intOr(body.maxRetries, 2),
      retryDelayHours: intOr(body.retryDelayHours, 24),
      maxConcurrent: intOr(body.maxConcurrent, 5), // 0 is preserved (provision but don't dial)
      spendCapCalls,
      defaultCountryCode: str(body.defaultCountryCode) ?? "+91",
    },
  };
}

// ── Update builder (allow-listed fields only) ─────────────────────────────────
// Excludes status (changed via activate/pause/complete) and vapiAssistantIds
// (set on activation). Returns Prisma-ready data with JSON fields serialised.

export function buildCampaignUpdate(body: Record<string, unknown>): Validated<Record<string, unknown>> {
  const data: Record<string, unknown> = {};

  // Required-non-empty if present.
  for (const f of ["name", "defaultCountryCode"] as const) {
    if (body[f] !== undefined) {
      const v = str(body[f]);
      if (v === null) return { ok: false, error: `${f} must be a non-empty string` };
      data[f] = v;
    }
  }

  // Nullable string fields (per-channel templates etc. — null clears them).
  const nullableStrings = [
    "scriptTemplate", "voiceA", "voiceB", "personaA", "personaB", "calendlyLink", "agentName",
    "whatsappContentSid", "whatsappTemplateBody", "emailSubjectTemplate", "emailBodyTemplate",
  ] as const;
  for (const f of nullableStrings) {
    if (f in body) data[f] = str(body[f]);
  }

  if (body.channels !== undefined) {
    const c = validateChannels(body.channels);
    if (c === null) return { ok: false, error: `channels must be a non-empty array of: ${SUPPORTED_CHANNELS.join(", ")}` };
    data.channels = JSON.stringify(c);
  }
  if (body.whatsappVariables !== undefined) {
    const w = validateStringList(body.whatsappVariables);
    if (w === null) return { ok: false, error: "whatsappVariables must be an array of strings" };
    data.whatsappVariables = JSON.stringify(w);
  }
  if (body.outcomeTypes !== undefined) {
    const o = validateOutcomeTypes(body.outcomeTypes);
    if (o === null) return { ok: false, error: "outcomeTypes must be an array of strings" };
    data.outcomeTypes = JSON.stringify(o);
  }
  if (body.followUpRules !== undefined) {
    const r = validateFollowUpRules(body.followUpRules);
    if (r === null) return { ok: false, error: "followUpRules must be an object mapping outcome -> [channels]" };
    data.followUpRules = JSON.stringify(r);
  }

  for (const f of ["maxRetries", "retryDelayHours", "maxConcurrent"] as const) {
    if (body[f] !== undefined) {
      const v = body[f];
      if (typeof v !== "number" || !Number.isInteger(v) || v < 0) {
        return { ok: false, error: `${f} must be a non-negative integer` };
      }
      data[f] = v;
    }
  }
  if ("spendCapCalls" in body) {
    const v = body.spendCapCalls;
    if (v === null) data.spendCapCalls = null;
    else if (typeof v === "number" && Number.isInteger(v) && v > 0) data.spendCapCalls = v;
    else return { ok: false, error: "spendCapCalls must be a positive integer or null" };
  }

  if (Object.keys(data).length === 0) return { ok: false, error: "No updatable fields provided" };
  return { ok: true, value: data };
}

// ── Response serialisation ────────────────────────────────────────────────────
// Parses the JSON-as-String fields back into structured values for API
// responses. Secrets (vapiAssistantIds) are kept — they are not sensitive.

const safeArray = (json: string): string[] => {
  try { const v = JSON.parse(json); return Array.isArray(v) ? v : []; } catch { return []; }
};
const safeObject = (json: string): Record<string, unknown> => {
  try { const v = JSON.parse(json); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

export function serializeCampaign<
  T extends { outcomeTypes: string; followUpRules: string; channels?: string; whatsappVariables?: string },
>(c: T) {
  return {
    ...c,
    outcomeTypes: safeArray(c.outcomeTypes),
    followUpRules: safeObject(c.followUpRules),
    ...(c.channels !== undefined ? { channels: safeArray(c.channels) } : {}),
    ...(c.whatsappVariables !== undefined ? { whatsappVariables: safeArray(c.whatsappVariables) } : {}),
  };
}

// ── Stats summarisation (pure) ────────────────────────────────────────────────

export interface OutcomeCount { outcome: string | null; count: number }

export function outcomeBreakdown(rows: OutcomeCount[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.outcome ?? "unknown"] = r.count;
  return out;
}

// ── A/B assistant provisioning (dependency-injected for testability) ─────────

export interface ProvisionableCampaign {
  name: string;
  scriptTemplate: string;
  voiceA: string; voiceB: string;
  personaA: string; personaB: string;
  outcomeTypes: string[];
}

export function assistantParamsForVariant(
  campaign: ProvisionableCampaign,
  variant: "A" | "B",
  opts: { apiDomain: string; agentName: string; webhookSecret: string | null },
): AssistantParams {
  return {
    campaignName: campaign.name,
    personaLabel: variant === "A" ? campaign.personaA : campaign.personaB,
    variant,
    scriptTemplate: campaign.scriptTemplate,
    elevenLabsVoiceId: variant === "A" ? campaign.voiceA : campaign.voiceB,
    agentName: opts.agentName,
    outcomeTypes: campaign.outcomeTypes,
    apiDomain: opts.apiDomain,
    webhookSecret: opts.webhookSecret,
  };
}

export interface ProvisionDeps {
  campaign: ProvisionableCampaign;
  creds: VapiCredentials;
  apiDomain: string;
  agentName: string;
  createAssistant: (creds: VapiCredentials, params: AssistantParams) => Promise<VapiResult<{ id: string }>>;
  // Optional cleanup hook: invoked to delete variant A if variant B fails, so a
  // partial provisioning leaves no orphaned assistant in the Vapi account.
  deleteAssistant?: (creds: VapiCredentials, assistantId: string) => Promise<VapiResult<{ id: string }>>;
}

// Provisions both A/B assistants sequentially. If variant B fails after A
// succeeded, A is best-effort deleted so no orphan is left behind. Returns both
// ids or an error — never partial state.
export async function provisionCampaignAssistants(
  deps: ProvisionDeps,
): Promise<{ ok: true; vapiAssistantIdA: string; vapiAssistantIdB: string } | { ok: false; error: string }> {
  const opts = { apiDomain: deps.apiDomain, agentName: deps.agentName, webhookSecret: deps.creds.webhookSecret };
  const a = await deps.createAssistant(deps.creds, assistantParamsForVariant(deps.campaign, "A", opts));
  if (!a.ok) return { ok: false, error: `Variant A provisioning failed: ${a.error}` };

  const b = await deps.createAssistant(deps.creds, assistantParamsForVariant(deps.campaign, "B", opts));
  if (!b.ok) {
    if (deps.deleteAssistant) await deps.deleteAssistant(deps.creds, a.data.id).catch(() => undefined);
    return { ok: false, error: `Variant B provisioning failed: ${b.error}` };
  }
  return { ok: true, vapiAssistantIdA: a.data.id, vapiAssistantIdB: b.data.id };
}

// Re-export so route code has one import surface.
export { buildAssistantPayload };
