// Per-tenant AI credentials for Research Studio. A tenant can bring its own
// OpenAI / Anthropic key via Integrations (connectors "ai_openai" / "ai_anthropic");
// otherwise we fall back to the platform env keys. Returns the effective key (tenant
// → env) for each provider, or null if neither is configured.

import { prisma } from "../../db/prisma";
import type { AIProvider } from "../ai/intelligence";

export interface AiCredentials {
  openaiKey: string | null;
  anthropicKey: string | null;
}

// Pick the AI provider from the resolved credentials: an explicit
// RESEARCH_AI_PROVIDER wins (if that provider's key exists), else prefer Claude when
// available, else OpenAI. Shared by synthesis and the agentic search planner.
export function chooseProvider(creds: AiCredentials): AIProvider {
  const pref = process.env.RESEARCH_AI_PROVIDER?.trim().toLowerCase();
  if (pref === "openai" && creds.openaiKey) return "openai";
  if (pref === "claude" && creds.anthropicKey) return "claude";
  return creds.anthropicKey ? "claude" : "openai";
}

export const providerKey = (creds: AiCredentials, provider: AIProvider): string | null =>
  provider === "openai" ? creds.openaiKey : creds.anthropicKey;

const asStr = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

async function connectorKey(tenantId: string, connectorKey: string): Promise<string | null> {
  const cfg = await prisma.connectorConfig
    .findUnique({
      where: { tenantId_connectorKey: { tenantId, connectorKey } },
      select: { configJson: true, enabled: true },
    })
    .catch(() => null);
  if (!cfg?.enabled) return null;
  try {
    const parsed = JSON.parse(cfg.configJson) as Record<string, unknown>;
    return asStr(parsed.apiKey);
  } catch {
    return null;
  }
}

export async function resolveAiCredentials(tenantId: string): Promise<AiCredentials> {
  const [openaiTenant, anthropicTenant] = await Promise.all([
    connectorKey(tenantId, "ai_openai"),
    connectorKey(tenantId, "ai_anthropic"),
  ]);
  return {
    openaiKey: openaiTenant ?? asStr(process.env.OPENAI_API_KEY),
    anthropicKey: anthropicTenant ?? asStr(process.env.ANTHROPIC_API_KEY),
  };
}

export const aiConfigured = (creds: AiCredentials): boolean => Boolean(creds.openaiKey || creds.anthropicKey);
