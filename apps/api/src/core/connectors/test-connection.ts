// Live-key validation (Phase 8): a cheap authenticated ping per provider so a
// tenant learns a key is wrong BEFORE launching a campaign, not from a wall of
// failed sends. Read-only requests only; secrets resolved the same way the real
// senders resolve them (tenant ConnectorConfig → env fallback) and never echoed
// back — the result carries a verdict and a human reason, nothing sensitive.

import { prisma } from "../../db/prisma";
import { decryptConfigValues } from "../crypto/secrets";

export interface TestResult {
  ok: boolean;
  detail: string;
}

const TIMEOUT_MS = 6000;

async function ping(url: string, init: RequestInit = {}): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...init, signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

async function tenantConfig(tenantId: string, connectorKey: string): Promise<Record<string, string>> {
  const cfg = await prisma.connectorConfig.findUnique({
    where: { tenantId_connectorKey: { tenantId, connectorKey } },
    select: { enabled: true, configJson: true },
  });
  if (!cfg?.enabled || !cfg.configJson) return {};
  try {
    return decryptConfigValues(JSON.parse(cfg.configJson) as Record<string, string>);
  } catch {
    return {};
  }
}

const verdict = (res: Response, okDetail: string): TestResult =>
  res.ok
    ? { ok: true, detail: okDetail }
    : res.status === 401 || res.status === 403
      ? { ok: false, detail: "The provider rejected the key (unauthorized) — check the credential" }
      : { ok: false, detail: `The provider responded with HTTP ${res.status}` };

type Checker = (tenantId: string) => Promise<TestResult>;

const CHECKERS: Record<string, Checker> = {
  whatsapp_twilio: async (tenantId) => {
    const cfg = await tenantConfig(tenantId, "whatsapp_twilio");
    const sid = cfg.accountSid || process.env.TWILIO_ACCOUNT_SID;
    const token = cfg.authToken || process.env.TWILIO_AUTH_TOKEN;
    if (!sid || !token) return { ok: false, detail: "Account SID / Auth Token not configured" };
    const res = await ping(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(sid)}.json`, {
      headers: { authorization: "Basic " + Buffer.from(`${sid}:${token}`).toString("base64") },
    });
    return verdict(res, "Twilio account reachable — credentials valid");
  },
  whatsapp_interakt: async (tenantId) => {
    const cfg = await tenantConfig(tenantId, "whatsapp_interakt");
    const key = cfg.apiKey || process.env.INTERAKT_API_KEY;
    if (!key) return { ok: false, detail: "Interakt API key not configured" };
    // Interakt has no dedicated ping; an authenticated GET distinguishes a bad key
    // (401) from a live one (2xx/404-on-empty are both authenticated responses).
    const res = await ping("https://api.interakt.ai/v1/public/apis/users/", {
      headers: { authorization: "Basic " + key },
    });
    if (res.status === 401 || res.status === 403) return { ok: false, detail: "Interakt rejected the key (unauthorized)" };
    return { ok: true, detail: "Interakt reachable — key accepted" };
  },
  email_resend: async (tenantId) => {
    const cfg = await tenantConfig(tenantId, "email_resend");
    const key = cfg.apiKey || process.env.RESEND_API_KEY;
    if (!key) return { ok: false, detail: "Resend API key not configured" };
    const res = await ping("https://api.resend.com/domains", { headers: { authorization: `Bearer ${key}` } });
    return verdict(res, "Resend reachable — key valid");
  },
  voice_vapi: async (tenantId) => {
    const cfg = await tenantConfig(tenantId, "voice_vapi");
    const key = cfg.apiKey || process.env.VAPI_API_KEY;
    if (!key) return { ok: false, detail: "Vapi API key not configured" };
    const res = await ping("https://api.vapi.ai/assistant?limit=1", { headers: { authorization: `Bearer ${key}` } });
    return verdict(res, "Vapi reachable — key valid");
  },
  ai_openai: async (tenantId) => {
    const cfg = await tenantConfig(tenantId, "ai_openai");
    const key = cfg.apiKey || process.env.OPENAI_API_KEY;
    if (!key) return { ok: false, detail: "OpenAI API key not configured" };
    const res = await ping("https://api.openai.com/v1/models?limit=1", { headers: { authorization: `Bearer ${key}` } });
    return verdict(res, "OpenAI reachable — key valid");
  },
  ai_anthropic: async (tenantId) => {
    const cfg = await tenantConfig(tenantId, "ai_anthropic");
    const key = cfg.apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) return { ok: false, detail: "Anthropic API key not configured" };
    const res = await ping("https://api.anthropic.com/v1/models?limit=1", {
      headers: { "x-api-key": key, "anthropic-version": "2023-06-01" },
    });
    return verdict(res, "Anthropic reachable — key valid");
  },
  search_tavily: async (tenantId) => {
    const cfg = await tenantConfig(tenantId, "search_tavily");
    const key = cfg.apiKey || process.env.TAVILY_API_KEY;
    if (!key) return { ok: false, detail: "Tavily API key not configured" };
    const res = await ping("https://api.tavily.com/search", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${key}` },
      body: JSON.stringify({ query: "ping", max_results: 1 }),
    });
    return verdict(res, "Tavily reachable — key valid");
  },
};

export const testableConnectorKeys = Object.keys(CHECKERS);

export async function testConnector(tenantId: string, connectorKey: string): Promise<TestResult | null> {
  const checker = CHECKERS[connectorKey];
  if (!checker) return null; // not a testable connector (file-export/PMS/etc.)
  try {
    return await checker(tenantId);
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return { ok: false, detail: aborted ? "The provider did not respond within 6s" : "Could not reach the provider" };
  }
}
