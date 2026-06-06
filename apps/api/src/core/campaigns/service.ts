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
import { asMinuteOfDay, parseSendDays } from "./schedule";
import { safeArray, safeObject } from "./json-utils";

// Parse an optional ISO datetime: null/empty → null; valid → Date; invalid → error sentinel.
const INVALID_DATE = Symbol("invalid_date");
function parseOptionalDate(v: unknown): Date | null | typeof INVALID_DATE {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return INVALID_DATE;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? INVALID_DATE : d;
}

// ── Create validation ─────────────────────────────────────────────────────────

export const SUPPORTED_CHANNELS = ["voice", "whatsapp", "email"] as const;
export type CampaignChannel = (typeof SUPPORTED_CHANNELS)[number];

// One A/B/N test arm, validated for create. `key` is assigned server-side
// (A, B, C, …) so it lines up with CampaignLead/CallRecord.abVariant.
export interface VariantValue {
  key: string;
  label: string;
  voice: string | null;
  persona: string | null;
  scriptOverride: string | null;
  weight: number;
}

export interface CampaignCreateValue {
  name: string;
  channels: string[];
  // voice
  scriptTemplate: string | null;
  variants: VariantValue[];
  outcomeTypes: string[];
  followUpRules: Record<string, string[]>;
  calendlyLink: string | null;
  agentName: string | null;
  // whatsapp
  whatsappContentSid: string | null;
  whatsappTemplateId: string | null;
  whatsappTemplateBody: string | null;
  whatsappVariables: string[];
  whatsappAgentEnabled: boolean;
  whatsappAgentPrompt: string | null;
  // email
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  // shared
  maxRetries: number;
  retryDelayHours: number;
  maxConcurrent: number;
  spendCapCalls: number | null;
  defaultCountryCode: string;
  segmentId: string | null;
  scheduledStartAt: Date | null;
  sendWindowStartMin: number | null;
  sendWindowEndMin: number | null;
  sendDays: number[];
  sendTimeZone: string | null;
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

// ── Variants (1..N A/B/N test arms) ────────────────────────────────────────────

const VARIANT_KEY_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
export const MAX_VARIANTS = 26;

// Stable per-campaign variant key by position: A, B, C, … (capped at 26).
export function variantKeyForIndex(i: number): string {
  return VARIANT_KEY_ALPHABET[i] ?? `V${i + 1}`;
}

const posInt = (v: unknown, fallback: number): number =>
  typeof v === "number" && Number.isInteger(v) && v > 0 ? v : fallback;

// Validates an explicit `variants` array (the dynamic A/B/N path). Keys are
// (re)assigned by position so they always match abVariant. When requireVoice is
// set (voice channel), every arm must carry a voice + persona.
export function validateVariants(
  input: unknown,
  opts: { requireVoice: boolean },
): Validated<VariantValue[]> {
  if (!Array.isArray(input)) return { ok: false, error: "variants must be an array" };
  if (input.length === 0) return { ok: false, error: "at least one variant is required" };
  if (input.length > MAX_VARIANTS) return { ok: false, error: `at most ${MAX_VARIANTS} variants are supported` };
  const out: VariantValue[] = [];
  for (let i = 0; i < input.length; i++) {
    const raw = input[i];
    if (typeof raw !== "object" || raw === null) return { ok: false, error: `variant ${i + 1} must be an object` };
    const r = raw as Record<string, unknown>;
    const voice = str(r.voice);
    const persona = str(r.persona);
    const label = str(r.label) ?? persona ?? `Variant ${variantKeyForIndex(i)}`;
    if (opts.requireVoice && (!voice || !persona)) {
      return { ok: false, error: `variant ${i + 1} (${label}) requires a voice and a persona` };
    }
    out.push({
      key: variantKeyForIndex(i),
      label,
      voice,
      persona,
      scriptOverride: str(r.scriptOverride),
      weight: posInt(r.weight, 1),
    });
  }
  return { ok: true, value: out };
}

// Synthesises the two A/B arms from the legacy voiceA/voiceB columns — used for
// backward-compatible create payloads and as the engine fallback for campaigns
// created before the variant table existed.
export function legacyVariants(c: {
  voiceA: string | null; voiceB: string | null;
  personaA: string | null; personaB: string | null;
  vapiAssistantIdA?: string | null; vapiAssistantIdB?: string | null;
}): Array<VariantValue & { vapiAssistantId: string | null }> {
  return [
    { key: "A", label: c.personaA ?? "Variant A", voice: c.voiceA, persona: c.personaA, scriptOverride: null, weight: 1, vapiAssistantId: c.vapiAssistantIdA ?? null },
    { key: "B", label: c.personaB ?? "Variant B", voice: c.voiceB, persona: c.personaB, scriptOverride: null, weight: 1, vapiAssistantId: c.vapiAssistantIdB ?? null },
  ];
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
  let variants: VariantValue[] = [];
  if (channels.includes("voice")) {
    if (body.variants !== undefined) {
      // New dynamic A/B/N path: an explicit list of variants.
      if (!scriptTemplate) return { ok: false, error: "voice channel requires: scriptTemplate" };
      const v = validateVariants(body.variants, { requireVoice: true });
      if (!v.ok) return v;
      variants = v.value;
    } else {
      // Backward-compatible legacy path: voiceA/voiceB/personaA/personaB.
      const voiceA = str(body.voiceA);
      const voiceB = str(body.voiceB);
      const personaA = str(body.personaA);
      const personaB = str(body.personaB);
      const missing = Object.entries({ scriptTemplate, voiceA, voiceB, personaA, personaB })
        .filter(([, v]) => v === null).map(([k]) => k);
      if (missing.length > 0) return { ok: false, error: `voice channel requires: ${missing.join(", ")}` };
      variants = legacyVariants({ voiceA, voiceB, personaA, personaB });
    }
  }

  const whatsappContentSid = str(body.whatsappContentSid);
  const whatsappTemplateId = str(body.whatsappTemplateId);
  if (channels.includes("whatsapp") && !whatsappContentSid && !whatsappTemplateId) {
    return { ok: false, error: "whatsapp channel requires an approved template (whatsappTemplateId) or a legacy whatsappContentSid" };
  }

  const emailSubjectTemplate = str(body.emailSubjectTemplate);
  const emailBodyTemplate = str(body.emailBodyTemplate);
  if (channels.includes("email") && (!emailSubjectTemplate || !emailBodyTemplate)) {
    return { ok: false, error: "email channel requires emailSubjectTemplate and emailBodyTemplate" };
  }

  const scheduledStartAt = parseOptionalDate(body.scheduledStartAt);
  if (scheduledStartAt === INVALID_DATE) return { ok: false, error: "scheduledStartAt must be an ISO datetime or null" };
  const sendWindowStartMin = body.sendWindowStartMin == null ? null : asMinuteOfDay(body.sendWindowStartMin);
  const sendWindowEndMin = body.sendWindowEndMin == null ? null : asMinuteOfDay(body.sendWindowEndMin);
  if (body.sendWindowStartMin != null && sendWindowStartMin === null) return { ok: false, error: "sendWindowStartMin must be 0–1439 (minutes from midnight)" };
  if (body.sendWindowEndMin != null && sendWindowEndMin === null) return { ok: false, error: "sendWindowEndMin must be 0–1439 (minutes from midnight)" };

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
      scriptTemplate, variants,
      outcomeTypes,
      followUpRules,
      calendlyLink: str(body.calendlyLink),
      agentName: str(body.agentName),
      whatsappContentSid,
      whatsappTemplateId,
      whatsappTemplateBody: str(body.whatsappTemplateBody),
      whatsappVariables,
      whatsappAgentEnabled: body.whatsappAgentEnabled === true,
      whatsappAgentPrompt: str(body.whatsappAgentPrompt),
      emailSubjectTemplate,
      emailBodyTemplate,
      maxRetries: intOr(body.maxRetries, 2),
      retryDelayHours: intOr(body.retryDelayHours, 24),
      maxConcurrent: intOr(body.maxConcurrent, 5), // 0 is preserved (provision but don't dial)
      spendCapCalls,
      defaultCountryCode: str(body.defaultCountryCode) ?? "+91",
      segmentId: str(body.segmentId), // optional targeting segment
      scheduledStartAt, sendWindowStartMin, sendWindowEndMin,
      sendDays: parseSendDays(body.sendDays),
      sendTimeZone: str(body.sendTimeZone),
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
    "whatsappContentSid", "whatsappTemplateId", "whatsappTemplateBody", "whatsappAgentPrompt", "emailSubjectTemplate", "emailBodyTemplate",
  ] as const;
  for (const f of nullableStrings) {
    if (f in body) data[f] = str(body[f]);
  }
  if (body.whatsappAgentEnabled !== undefined) data.whatsappAgentEnabled = body.whatsappAgentEnabled === true;

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
  if ("segmentId" in body) data.segmentId = str(body.segmentId); // string targets a segment; null clears it

  // Scheduling / send window.
  if ("scheduledStartAt" in body) {
    const d = parseOptionalDate(body.scheduledStartAt);
    if (d === INVALID_DATE) return { ok: false, error: "scheduledStartAt must be an ISO datetime or null" };
    data.scheduledStartAt = d;
  }
  for (const f of ["sendWindowStartMin", "sendWindowEndMin"] as const) {
    if (f in body) {
      if (body[f] === null) { data[f] = null; continue; }
      const m = asMinuteOfDay(body[f]);
      if (m === null) return { ok: false, error: `${f} must be 0–1439 (minutes from midnight) or null` };
      data[f] = m;
    }
  }
  if ("sendDays" in body) data.sendDays = JSON.stringify(parseSendDays(body.sendDays));
  if ("sendTimeZone" in body) data.sendTimeZone = str(body.sendTimeZone);

  if (Object.keys(data).length === 0) return { ok: false, error: "No updatable fields provided" };
  return { ok: true, value: data };
}

// ── Response serialisation ────────────────────────────────────────────────────
// Parses the JSON-as-String fields back into structured values for API
// responses. Secrets (vapiAssistantIds) are kept — they are not sensitive.

export function serializeCampaign<
  T extends { outcomeTypes: string; followUpRules: string; channels?: string; whatsappVariables?: string; sendDays?: string },
>(c: T) {
  return {
    ...c,
    outcomeTypes: safeArray(c.outcomeTypes),
    followUpRules: safeObject(c.followUpRules),
    ...(c.channels !== undefined ? { channels: safeArray(c.channels) } : {}),
    ...(c.whatsappVariables !== undefined ? { whatsappVariables: safeArray(c.whatsappVariables) } : {}),
    ...(c.sendDays !== undefined ? { sendDays: safeArray(c.sendDays).map(Number) } : {}),
  };
}

// ── Stats summarisation (pure) ────────────────────────────────────────────────

export interface OutcomeCount { outcome: string | null; count: number }

export function outcomeBreakdown(rows: OutcomeCount[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) out[r.outcome ?? "unknown"] = r.count;
  return out;
}

// ── A/B/N assistant provisioning (dependency-injected for testability) ───────

export interface ProvisionableCampaign {
  name: string;
  scriptTemplate: string;
  outcomeTypes: string[];
}

// The subset of a variant needed to build its assistant.
export interface ProvisionVariant {
  key: string;
  label: string;
  voice: string | null;
  persona: string | null;
  scriptOverride: string | null;
}

export function assistantParamsForVariant(
  campaign: ProvisionableCampaign,
  variant: ProvisionVariant,
  opts: { apiDomain: string; agentName: string; webhookSecret: string | null },
): AssistantParams {
  return {
    campaignName: campaign.name,
    personaLabel: variant.persona ?? variant.label,
    variant: variant.key,
    // A variant may override the campaign-level script; otherwise the shared one.
    scriptTemplate: variant.scriptOverride ?? campaign.scriptTemplate,
    elevenLabsVoiceId: variant.voice ?? "",
    agentName: opts.agentName,
    outcomeTypes: campaign.outcomeTypes,
    apiDomain: opts.apiDomain,
    webhookSecret: opts.webhookSecret,
  };
}

export interface ProvisionDeps {
  campaign: ProvisionableCampaign;
  variants: ProvisionVariant[];
  creds: VapiCredentials;
  apiDomain: string;
  agentName: string;
  createAssistant: (creds: VapiCredentials, params: AssistantParams) => Promise<VapiResult<{ id: string }>>;
  // Optional cleanup hook: invoked to delete already-created assistants if a
  // later variant fails, so a partial provisioning leaves no orphans at Vapi.
  deleteAssistant?: (creds: VapiCredentials, assistantId: string) => Promise<VapiResult<{ id: string }>>;
}

// Provisions one assistant per variant, sequentially. If any variant fails, all
// previously-created assistants are best-effort deleted. Returns a key→assistantId
// map or an error — never partial state.
export async function provisionVariantAssistants(
  deps: ProvisionDeps,
): Promise<{ ok: true; assistants: Record<string, string> } | { ok: false; error: string }> {
  const opts = { apiDomain: deps.apiDomain, agentName: deps.agentName, webhookSecret: deps.creds.webhookSecret };
  const created: string[] = [];
  const assistants: Record<string, string> = {};
  for (const variant of deps.variants) {
    const r = await deps.createAssistant(deps.creds, assistantParamsForVariant(deps.campaign, variant, opts));
    if (!r.ok) {
      if (deps.deleteAssistant) {
        for (const id of created) await deps.deleteAssistant(deps.creds, id).catch(() => undefined);
      }
      return { ok: false, error: `Variant ${variant.key} (${variant.label}) provisioning failed: ${r.error}` };
    }
    created.push(r.data.id);
    assistants[variant.key] = r.data.id;
  }
  return { ok: true, assistants };
}

// Re-export so route code has one import surface.
export { buildAssistantPayload };
