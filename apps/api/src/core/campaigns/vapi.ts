// Vapi.ai telephony client (Phase 3).
//
// Vapi is the swappable telephony connector — the same role Twilio plays for
// WhatsApp. This module covers the three operations the campaign engine needs:
// assistant provisioning (on campaign activate), call initiation (per lead from
// the worker), and webhook-secret verification (on the end-of-call callback).
//
// Keys-last friendly: with no VAPI_API_KEY configured, the network calls return
// a structured { ok: false, error } result (mirroring whatsapp-outbound.ts) so
// the rest of the system runs in dev/test without credentials. The pure payload
// builders and verification are fully unit-testable with no key at all.

import { prisma } from "../../db/prisma";
import { ensureDisclosure } from "./compliance";
import { verifyVapiSecret } from "../connectors/webhook-verify";

const VAPI_BASE_URL = "https://api.vapi.ai";

// Conversational model — Haiku is chosen for latency, per the BRD. The voice
// persona, not the model tier, carries the quality perception.
export const VAPI_LLM_MODEL = "claude-haiku-4-5-20251001";

// ── Types ───────────────────────────────────────────────────────────────────

export interface VapiCredentials {
  apiKey: string | null;
  phoneNumberId: string | null;
  webhookSecret: string | null;
}

export interface AssistantParams {
  campaignName: string;
  personaLabel: string; // e.g. "Enthusiastic"
  variant: "A" | "B";
  scriptTemplate: string; // system prompt with {variable} placeholders
  elevenLabsVoiceId: string;
  agentName: string;
  outcomeTypes: string[]; // campaign outcome taxonomy → structured-data enum
  apiDomain: string; // host for the serverUrl webhook
  webhookSecret: string | null;
}

export interface CallParams {
  vapiAssistantId: string;
  phoneNumberId: string;
  leadPhone: string;
  leadName: string;
  variableValues: Record<string, string>; // injected {variable} values
}

export type VapiResult<T> = { ok: true; data: T } | { ok: false; error: string };

// End-of-call webhook payload shape (the subset we consume in Phase 7).
export interface VapiWebhookEvent {
  type: string; // "call-started" | "end-of-call-report" | ...
  call?: { id?: string; startedAt?: string; endedAt?: string };
  durationSeconds?: number;
  transcript?: string;
  analysis?: { structuredData?: { outcome?: string; sentiment?: string; keyPoints?: string[] } };
}

const asStr = (v: unknown): string | null =>
  typeof v === "string" && v.trim().length > 0 ? v.trim() : null;

const parseConfig = (json: string): Record<string, unknown> => {
  try { return JSON.parse(json) as Record<string, unknown>; } catch { return {}; }
};

// ── Credential resolution (per-hotel ConnectorConfig → env fallback) ─────────

export async function resolveVapiCredentials(hotelId: string): Promise<VapiCredentials> {
  const cfg = await prisma.connectorConfig.findUnique({
    where: { hotelId_connectorKey: { hotelId, connectorKey: "voice_vapi" } },
    select: { configJson: true, enabled: true },
  }).catch(() => null);

  const parsed = cfg?.enabled ? parseConfig(cfg.configJson) : {};
  return {
    apiKey: asStr(parsed.apiKey) ?? asStr(process.env.VAPI_API_KEY),
    phoneNumberId: asStr(parsed.phoneNumberId) ?? asStr(process.env.VAPI_PHONE_NUMBER_ID),
    webhookSecret: asStr(parsed.webhookSecret) ?? asStr(process.env.VAPI_WEBHOOK_SECRET),
  };
}

export const isVapiConfigured = (creds: VapiCredentials): boolean => Boolean(creds.apiKey);

// ── Pure payload builders (no network, fully testable) ───────────────────────

// Builds the POST /assistant body. The script is always passed through
// ensureDisclosure() so a compliant AI disclosure cannot be omitted.
export function buildAssistantPayload(params: AssistantParams): Record<string, unknown> {
  return {
    name: `${params.campaignName} — ${params.personaLabel} (${params.variant})`,
    model: {
      provider: "anthropic",
      model: VAPI_LLM_MODEL,
      systemPrompt: ensureDisclosure(params.scriptTemplate),
    },
    voice: { provider: "11labs", voiceId: params.elevenLabsVoiceId },
    firstMessageMode: "assistant-speaks-first",
    firstMessage: `Hi {{customer.name}}, this is ${params.agentName}.`,
    endCallFunctionEnabled: true,
    serverUrl: `https://${params.apiDomain}/webhooks/vapi`,
    serverUrlSecret: params.webhookSecret ?? undefined,
    analysisPlan: {
      structuredDataSchema: {
        type: "object",
        properties: {
          outcome: { type: "string", enum: params.outcomeTypes },
          sentiment: { type: "string", enum: ["positive", "neutral", "negative"] },
          keyPoints: { type: "array", items: { type: "string" } },
        },
      },
    },
  };
}

export function buildCallPayload(params: CallParams): Record<string, unknown> {
  return {
    assistantId: params.vapiAssistantId,
    phoneNumberId: params.phoneNumberId,
    customer: { number: params.leadPhone, name: params.leadName },
    assistantOverrides: { variableValues: params.variableValues },
  };
}

// ── Network calls ─────────────────────────────────────────────────────────────

async function vapiPost<T>(
  creds: VapiCredentials,
  path: string,
  body: Record<string, unknown>,
): Promise<VapiResult<T>> {
  if (!isVapiConfigured(creds)) {
    return { ok: false, error: "Vapi not configured — set VAPI_API_KEY" };
  }
  try {
    const res = await fetch(`${VAPI_BASE_URL}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${creds.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text().catch(() => res.statusText);
      return { ok: false, error: `Vapi API error ${res.status}: ${err}` };
    }
    return { ok: true, data: (await res.json()) as T };
  } catch (e) {
    return { ok: false, error: `Vapi request failed: ${(e as Error).message}` };
  }
}

// Provisions a Vapi assistant; returns its id (stored as vapiAssistantIdA/B).
export async function createAssistant(
  creds: VapiCredentials,
  params: AssistantParams,
): Promise<VapiResult<{ id: string }>> {
  return vapiPost<{ id: string }>(creds, "/assistant", buildAssistantPayload(params));
}

// Initiates an outbound call; returns the Vapi call id (stored on CallRecord).
export async function initiateCall(
  creds: VapiCredentials,
  params: CallParams,
): Promise<VapiResult<{ id: string }>> {
  return vapiPost<{ id: string }>(creds, "/call/phone", buildCallPayload(params));
}

// ── Webhook verification ──────────────────────────────────────────────────────

// Verifies the x-vapi-secret header against the configured webhook secret.
// When VERIFY_WEBHOOKS is not enforced and no secret is configured, verification
// is skipped (returns ok) — matching checkWebhookSignature's dev-friendly stance.
export function verifyWebhook(opts: {
  provided: string | null;
  expected: string | null;
  enforce: boolean;
}): { ok: boolean; reason?: string } {
  const { provided, expected, enforce } = opts;
  if (!expected) {
    if (enforce) return { ok: false, reason: "Vapi webhook secret not configured — set VAPI_WEBHOOK_SECRET" };
    return { ok: true };
  }
  if (!provided) {
    if (enforce) return { ok: false, reason: "Missing x-vapi-secret header" };
    return { ok: true };
  }
  if (!verifyVapiSecret(provided, expected)) {
    if (enforce) return { ok: false, reason: "Vapi webhook secret mismatch" };
    console.warn("[Vapi] webhook secret mismatch — set VERIFY_WEBHOOKS=false to silence");
  }
  return { ok: true };
}
