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

export interface CampaignCreateValue {
  name: string;
  scriptTemplate: string;
  voiceA: string;
  voiceB: string;
  personaA: string;
  personaB: string;
  outcomeTypes: string[];
  followUpRules: Record<string, string[]>;
  calendlyLink: string | null;
  agentName: string | null;
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
  const scriptTemplate = str(body.scriptTemplate);
  const voiceA = str(body.voiceA);
  const voiceB = str(body.voiceB);
  const personaA = str(body.personaA);
  const personaB = str(body.personaB);

  const missing = Object.entries({ name, scriptTemplate, voiceA, voiceB, personaA, personaB })
    .filter(([, v]) => v === null)
    .map(([k]) => k);
  if (missing.length > 0) {
    return { ok: false, error: `Missing required fields: ${missing.join(", ")}` };
  }

  const outcomeTypes = validateOutcomeTypes(body.outcomeTypes);
  if (outcomeTypes === null) return { ok: false, error: "outcomeTypes must be an array of strings" };

  const followUpRules = validateFollowUpRules(body.followUpRules);
  if (followUpRules === null) {
    return { ok: false, error: "followUpRules must be an object mapping outcome -> [channels]" };
  }

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
      name: name!,
      scriptTemplate: scriptTemplate!,
      voiceA: voiceA!,
      voiceB: voiceB!,
      personaA: personaA!,
      personaB: personaB!,
      outcomeTypes,
      followUpRules,
      calendlyLink: str(body.calendlyLink),
      agentName: str(body.agentName),
      maxRetries: intOr(body.maxRetries, 2),
      retryDelayHours: intOr(body.retryDelayHours, 24),
      maxConcurrent: intOr(body.maxConcurrent, 5) || 5,
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

  const stringFields: Array<keyof CampaignCreateValue> = [
    "name", "scriptTemplate", "voiceA", "voiceB", "personaA", "personaB", "defaultCountryCode",
  ];
  for (const f of stringFields) {
    if (body[f] !== undefined) {
      const v = str(body[f]);
      if (v === null) return { ok: false, error: `${f} must be a non-empty string` };
      data[f] = v;
    }
  }

  if ("calendlyLink" in body) data.calendlyLink = str(body.calendlyLink); // nullable
  if ("agentName" in body) data.agentName = str(body.agentName); // nullable

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

export function serializeCampaign<T extends { outcomeTypes: string; followUpRules: string }>(c: T) {
  return { ...c, outcomeTypes: safeArray(c.outcomeTypes), followUpRules: safeObject(c.followUpRules) };
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
