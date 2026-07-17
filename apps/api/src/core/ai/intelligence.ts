import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";
import { DEFAULT_INTAKE_PACK, getIndustryTerms } from "../industry-pack";

// ── Provider availability ─────────────────────────────────────────────────────

export type AIProvider = "claude" | "openai";

export const CLAUDE_AVAILABLE = Boolean(process.env.ANTHROPIC_API_KEY);
export const OPENAI_AVAILABLE = Boolean(process.env.OPENAI_API_KEY);
export const AI_AVAILABLE = CLAUDE_AVAILABLE || OPENAI_AVAILABLE;

// ── Lazy clients ──────────────────────────────────────────────────────────────

let _claude: Anthropic | null = null;
let _openai: OpenAI | null = null;

function getClaudeClient(): Anthropic {
  if (!_claude) {
    if (!process.env.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set");
    _claude = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _claude;
}

function getOpenAIClient(): OpenAI {
  if (!_openai) {
    if (!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set");
    _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _openai;
}

// ── Shared system prompt ──────────────────────────────────────────────────────

// Industry-agnostic system prompt (CLAUDE.md product principle #1). The platform
// serves many verticals — never assume hospitality. Domain vocabulary and currency
// come from the per-request context, not from a hardcoded "hotels in India / INR"
// assumption (F-20).
const SYSTEM_PROMPT = `You are an AI intelligence layer for business operations. You analyze operational data and produce concise, actionable intelligence for operators, managers, and owners across many industries.

Your outputs must be:
- Specific and data-driven (reference actual numbers from the context provided)
- Actionable (each insight should suggest what to do, not just what is happening)
- Concise (operators are busy — no filler sentences)
- Formatted as clean JSON when asked for structured output

Use the domain vocabulary and currency that appear in the context provided. Do not assume a specific industry or currency.`;

// ── Shared helper ─────────────────────────────────────────────────────────────

// Thrown when a provider returns something we can't parse into the expected shape.
// AI route handlers catch this to return a clean error instead of a generic 500 (F-12).
export class AiResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiResponseError";
  }
}

// Pulls a JSON object out of a free-text model response. Returns null (never throws)
// when no balanced-looking object is present or it doesn't parse — callers decide how
// to handle the absence (F-11: previously this threw a raw SyntaxError that bubbled
// to a generic 500).
export function extractJson(text: string): unknown | null {
  const match = /\{[\s\S]*\}/.exec(text);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch {
    return null;
  }
}

// Parses a provider response and guarantees a plain object, with the given required
// keys present. Throws AiResponseError on any shape problem so structurally-invalid AI
// output is rejected rather than cast through to the DB/client unchecked (F-11).
export function parseStructured<T>(text: string, requiredKeys: ReadonlyArray<keyof T & string>): T {
  const parsed = extractJson(text);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AiResponseError("AI response did not contain a JSON object");
  }
  const obj = parsed as Record<string, unknown>;
  const missing = requiredKeys.filter((k) => !(k in obj));
  if (missing.length > 0) {
    throw new AiResponseError(`AI response missing required field(s): ${missing.join(", ")}`);
  }
  return parsed as T;
}

function claudeTextContent(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
}

// ── Types ─────────────────────────────────────────────────────────────────────

// Industry vocabulary now lives in the industry pack (#160); getIndustryTerms is
// imported at the top of this file and used by the prompt builders below.

// Metrics that depend on an external source (PMS / POS / billing) are nullable:
// when no source is connected we pass null and the prompt says "not available"
// rather than feeding the model fabricated constants (F-17).
interface SmartInsightsData {
  tenantName: string;
  industry: string | null;
  date: string;
  openRequests: number;
  escalatedRequests: number;
  todayRevenue: number | null;
  newContacts: number;
  avgSentimentScore: number | null;
  topPendingCategories: string[];
}

// Renders a value the model should not invent when its source is absent.
const fmtInr = (v: number | null): string => (v == null ? "not available (no revenue source connected)" : `₹${v.toLocaleString("en-IN")}`);
const fmtScore = (v: number | null): string => (v == null ? "no feedback yet" : `${v}/100`);
const fmtNum = (v: number | null): string => (v == null ? "not available" : String(v));
const fmtPct = (v: number | null): string => (v == null ? "not available" : `${v}%`);

export interface SmartInsights {
  headline: string;
  operationalAlerts: string[];
  revenueHighlight: string;
  experienceNote: string;
  topPriority: string;
}

interface GuestHistoryData {
  guestName: string;
  totalStays: number;
  lastStayDate: string | null;
  totalSpendInr: number;
  preferredCategories: string[];
  openRequests: number;
  sentimentScore: number | null;
  segment: string;
  notes: string[];
}

export interface GuestIntelligence {
  arrivalBrief: string;
  keyPreferences: string[];
  upsellOpportunities: string[];
  attentionFlags: string[];
  vipScore: "standard" | "valued" | "vip" | "priority";
}

export interface EventClassification {
  // Category is a free string keyed by the tenant's industry pack (#159), not a
  // fixed hospitality union — the allowed values are supplied to the prompt at
  // classify time and validated/clamped downstream in the ingest pipeline.
  category: string;
  priority: "urgent" | "high" | "normal";
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  routingHint: string;
  slaMinutes: number;
}

interface RevenueData {
  hotelName: string;
  occupancyPct: number | null;
  adrInr: number | null;
  revParInr: number | null;
  upsellConversionPct: number;
  topCategories: Array<{ name: string; revenueInr: number }>;
  weekTrend: "up" | "flat" | "down";
  availableRooms: number | null;
}

export interface RevenueInsight {
  summary: string;
  recommendations: string[];
  quickWin: string;
  riskAlert: string | null;
}

// ── Prompt builders (shared across providers) ─────────────────────────────────

function insightsPrompt(data: SmartInsightsData): string {
  const t = getIndustryTerms(data.industry);
  return `Generate smart operational insights for ${data.tenantName} (${t.label}) on ${data.date}.

Operational data (do not invent figures marked "not available"; use the tenant's own vocabulary — ${t.requestPlural}, ${t.contactPlural}):
- Open ${t.requestPlural}: ${data.openRequests} (${data.escalatedRequests} escalated)
- Today's revenue so far: ${fmtInr(data.todayRevenue)}
- New ${t.contactPlural} today: ${data.newContacts}
- Sentiment score: ${fmtScore(data.avgSentimentScore)}
- Pending ${t.request} categories: ${data.topPendingCategories.join(", ") || "none"}

Return a JSON object with exactly these keys:
{
  "headline": "one-sentence executive summary of today's status",
  "operationalAlerts": ["up to 3 specific action items the team must address today"],
  "revenueHighlight": "one sentence on revenue position vs a typical day (say so plainly if revenue data is not available)",
  "experienceNote": "one sentence on ${t.contactPlural} satisfaction trend",
  "topPriority": "single most important thing for the operator or manager to handle first"
}`;
}

// Allowed categories are supplied by the caller from the tenant's industry pack
// (#159), and the operation vocabulary comes from getIndustryTerms — so the same
// prompt classifies a hotel, a plant or an IT helpdesk without hardcoded "hotel"/
// "guest" framing. Falls back to the hospitality pack's categories when none given
// (reused from industry-pack so the two can't drift).
function classifyPrompt(text: string, categories: string[] | undefined, industry: string | null | undefined): string {
  const t = getIndustryTerms(industry);
  const cats = (categories && categories.length ? categories : DEFAULT_INTAKE_PACK.categories)
    .map((c) => `"${c}"`)
    .join(" | ");
  return `An inbound message arrived for a ${t.label} operation. Classify the ${t.request} and extract key details.

Message: "${text}"

Return a JSON object with exactly these keys:
{
  "category": one of: ${cats},
  "priority": one of: "urgent" | "high" | "normal",
  "summary": "10-15 word summary of the request for the operations team",
  "sentiment": one of: "positive" | "neutral" | "negative",
  "routingHint": "which team or person should handle this",
  "slaMinutes": target resolution time in minutes as an integer
}`;
}

// Optional per-tenant classification config threaded from the ingest pipeline.
export interface ClassifyConfig {
  categories: string[];
  industry: string | null;
}

function guestPrompt(data: GuestHistoryData): string {
  return `Generate an arrival intelligence brief for an incoming guest.

Guest profile:
- Name: ${data.guestName}
- Segment: ${data.segment}
- Total stays: ${data.totalStays}
- Last stay: ${data.lastStayDate ?? "first time"}
- Lifetime spend: ₹${data.totalSpendInr.toLocaleString("en-IN")}
- Preferred services: ${data.preferredCategories.join(", ") || "unknown"}
- Current open requests: ${data.openRequests}
- Sentiment score: ${data.sentimentScore ?? "no data"}/100
- Notes: ${data.notes.join("; ") || "none"}

Return a JSON object with exactly these keys:
{
  "arrivalBrief": "2-3 sentence brief for the front desk on this guest",
  "keyPreferences": ["up to 3 preferences to prepare before arrival"],
  "upsellOpportunities": ["up to 3 specific upsell offers likely to convert for this guest"],
  "attentionFlags": ["any concerns or risks to be aware of — empty array if none"],
  "vipScore": one of: "standard" | "valued" | "vip" | "priority"
}`;
}

function revenuePrompt(data: RevenueData): string {
  return `Analyze revenue performance and provide specific, actionable recommendations for ${data.hotelName}.

Revenue data (do not invent figures marked "not available"; base recommendations on what is present, especially upsell performance):
- Occupancy: ${fmtPct(data.occupancyPct)}
- ADR: ${fmtInr(data.adrInr)}
- RevPAR: ${fmtInr(data.revParInr)}
- Upsell conversion rate: ${data.upsellConversionPct}%
- Weekly trend: ${data.weekTrend}
- Available rooms right now: ${fmtNum(data.availableRooms)}
- Top revenue categories: ${data.topCategories.map((c) => `${c.name} (₹${c.revenueInr.toLocaleString("en-IN")})`).join(", ") || "none yet"}

Return a JSON object with exactly these keys:
{
  "summary": "2-sentence revenue position summary with specific numbers",
  "recommendations": ["3-5 specific, numbered, actionable revenue recommendations with estimated impact"],
  "quickWin": "the single highest ROI action that can be taken today",
  "riskAlert": "a specific revenue risk to watch, or null if no immediate concern"
}`;
}

// ── Claude implementations ────────────────────────────────────────────────────

const CLAUDE_MODEL = process.env.CLAUDE_MODEL ?? "claude-opus-4-8";
const CLAUDE_PARAMS = {
  max_tokens: 1024,
  thinking: { type: "adaptive" as const },
  output_config: { effort: "high" as const }
};
const CLAUDE_SYSTEM = [{ type: "text" as const, text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" as const } }];

async function claudeCall(userContent: string): Promise<string> {
  const res = await getClaudeClient().messages.create({
    model: CLAUDE_MODEL,
    ...CLAUDE_PARAMS,
    system: CLAUDE_SYSTEM,
    messages: [{ role: "user", content: userContent }]
  });
  return claudeTextContent(res);
}

async function claudeSmartInsights(data: SmartInsightsData): Promise<SmartInsights> {
  return parseStructured<SmartInsights>(await claudeCall(insightsPrompt(data)), INSIGHTS_KEYS);
}

async function claudeClassifyEvent(text: string, cfg?: ClassifyConfig): Promise<EventClassification> {
  return parseStructured<EventClassification>(await claudeCall(classifyPrompt(text, cfg?.categories, cfg?.industry)), CLASSIFICATION_KEYS);
}

async function claudeGuestIntelligence(data: GuestHistoryData): Promise<GuestIntelligence> {
  return parseStructured<GuestIntelligence>(await claudeCall(guestPrompt(data)), GUEST_KEYS);
}

async function claudeRevenueInsights(data: RevenueData): Promise<RevenueInsight> {
  return parseStructured<RevenueInsight>(await claudeCall(revenuePrompt(data)), REVENUE_KEYS);
}

// ── OpenAI implementations ────────────────────────────────────────────────────

const OPENAI_MODEL = "gpt-4o";

async function openaiCall(userContent: string): Promise<string> {
  const res = await getOpenAIClient().chat.completions.create({
    model: OPENAI_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userContent }
    ],
    response_format: { type: "json_object" },
    max_tokens: 1024
  });
  return res.choices[0]?.message.content ?? "{}";
}

// Generic single-shot completion, provider-selectable. Used by the CRM AI layer
// (scoring / next-best-action). Callers must gate on CLAUDE_AVAILABLE/OPENAI_AVAILABLE
// and provide their own deterministic fallback when no key is configured.
export async function aiComplete(userContent: string, provider: AIProvider = "claude"): Promise<string> {
  return provider === "openai" ? openaiCall(userContent) : claudeCall(userContent);
}

// ── Research Studio: tiered completion (RS-1) ─────────────────────────────────
// Keeps research cost low by spending a small/cheap model on high-volume per-source
// extraction ("cheap") and reserving the premium model (with extended thinking) for
// the final structured synthesis ("premium"). Model ids are env-overridable so an
// operator can dial cost/quality without code changes. Callers MUST gate on
// CLAUDE_AVAILABLE / OPENAI_AVAILABLE and provide their own non-AI fallback.
const RESEARCH_CLAUDE_CHEAP = process.env.RESEARCH_CLAUDE_CHEAP_MODEL ?? "claude-haiku-4-5";
const RESEARCH_OPENAI_CHEAP = process.env.RESEARCH_OPENAI_CHEAP_MODEL ?? "gpt-4o-mini";

export async function aiCompleteTiered(
  userContent: string,
  opts: { provider?: AIProvider; tier?: "cheap" | "premium"; maxTokens?: number; system?: string; apiKey?: string } = {},
): Promise<string> {
  const provider = opts.provider ?? "claude";
  const tier = opts.tier ?? "premium";
  const maxTokens = opts.maxTokens ?? (tier === "cheap" ? 1024 : 4096);
  const system = opts.system ?? SYSTEM_PROMPT;

  if (provider === "openai") {
    // An explicit apiKey (a tenant's own, via Integrations) overrides the env client.
    const client = opts.apiKey ? new OpenAI({ apiKey: opts.apiKey }) : getOpenAIClient();
    const res = await client.chat.completions.create({
      model: tier === "cheap" ? RESEARCH_OPENAI_CHEAP : OPENAI_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: userContent },
      ],
      max_tokens: maxTokens,
    });
    return res.choices[0]?.message.content ?? "";
  }

  // Claude: the cheap tier skips extended thinking (faster + cheaper); the premium
  // tier keeps adaptive thinking + high effort for the final synthesis.
  const client = opts.apiKey ? new Anthropic({ apiKey: opts.apiKey }) : getClaudeClient();
  const res = await client.messages.create({
    model: tier === "cheap" ? RESEARCH_CLAUDE_CHEAP : CLAUDE_MODEL,
    max_tokens: maxTokens,
    ...(tier === "premium"
      ? { thinking: { type: "adaptive" as const }, output_config: { effort: "high" as const } }
      : {}),
    system: [{ type: "text" as const, text: system }],
    messages: [{ role: "user", content: userContent }],
  });
  return claudeTextContent(res);
}

async function openaiSmartInsights(data: SmartInsightsData): Promise<SmartInsights> {
  return parseStructured<SmartInsights>(await openaiCall(insightsPrompt(data)), INSIGHTS_KEYS);
}

async function openaiClassifyEvent(text: string, cfg?: ClassifyConfig): Promise<EventClassification> {
  return parseStructured<EventClassification>(await openaiCall(classifyPrompt(text, cfg?.categories, cfg?.industry)), CLASSIFICATION_KEYS);
}

async function openaiGuestIntelligence(data: GuestHistoryData): Promise<GuestIntelligence> {
  return parseStructured<GuestIntelligence>(await openaiCall(guestPrompt(data)), GUEST_KEYS);
}

async function openaiRevenueInsights(data: RevenueData): Promise<RevenueInsight> {
  return parseStructured<RevenueInsight>(await openaiCall(revenuePrompt(data)), REVENUE_KEYS);
}

// ── Night Audit ───────────────────────────────────────────────────────────────

export interface NightAuditData {
  hotelName: string;
  reportDate: string;
  occupancyPct: number | null;
  checkIns: number;
  checkOuts: number;
  inHouseGuests: number;
  resolvedRequests: number;
  escalatedRequests: number;
  openRequests: number;
  avgResolutionMins: number;
  automationExecutions: number;
  automationSuccesses: number;
  whatsappMessages: number;
  upsellRevenue: number;
  negativeEvents: number;
  topIssueCategory: string;
}

export interface NightAuditResult {
  headline: string;
  executiveSummary: string;
  highlights: string[];
  concerns: string[];
  tomorrowRecommendations: string[];
  operationalScore: number;
}

function nightAuditPrompt(data: NightAuditData): string {
  return `Generate a night audit report for ${data.hotelName} for ${data.reportDate}.

Day summary (do not invent figures marked "not available"):
- Occupancy: ${fmtPct(data.occupancyPct)}
- Check-ins today: ${data.checkIns}, Check-outs: ${data.checkOuts}, In-house: ${data.inHouseGuests}
- Service requests: ${data.resolvedRequests} resolved, ${data.escalatedRequests} escalated, ${data.openRequests} still open
- Average resolution time: ${data.avgResolutionMins} minutes
- Automation engine: ${data.automationExecutions} executions, ${data.automationSuccesses} successful
- WhatsApp messages processed: ${data.whatsappMessages}
- Upsell revenue generated: ₹${data.upsellRevenue.toLocaleString("en-IN")}
- Negative guest sentiment events: ${data.negativeEvents}
- Most common request category: ${data.topIssueCategory}

Return a JSON object with exactly these keys:
{
  "headline": "one-line executive summary for the night audit",
  "executiveSummary": "2-3 sentence narrative of how the day performed overall",
  "highlights": ["2-4 positive outcomes worth noting"],
  "concerns": ["1-3 issues that need attention before tomorrow"],
  "tomorrowRecommendations": ["3-5 specific, actionable items for the next shift to act on"],
  "operationalScore": an integer 1-10 rating of today's operational performance
}`;
}

async function claudeNightAudit(data: NightAuditData): Promise<NightAuditResult> {
  return parseStructured<NightAuditResult>(await claudeCall(nightAuditPrompt(data)), NIGHT_AUDIT_KEYS);
}

async function openaiNightAudit(data: NightAuditData): Promise<NightAuditResult> {
  return parseStructured<NightAuditResult>(await openaiCall(nightAuditPrompt(data)), NIGHT_AUDIT_KEYS);
}

// Required-key sets used to validate each provider response shape (F-11).
const INSIGHTS_KEYS = ["headline", "operationalAlerts", "revenueHighlight", "experienceNote", "topPriority"] as const;
const CLASSIFICATION_KEYS = ["category", "priority", "summary", "sentiment", "routingHint", "slaMinutes"] as const;
const GUEST_KEYS = ["arrivalBrief", "keyPreferences", "upsellOpportunities", "attentionFlags", "vipScore"] as const;
const REVENUE_KEYS = ["summary", "recommendations", "quickWin", "riskAlert"] as const;
const NIGHT_AUDIT_KEYS = ["headline", "executiveSummary", "highlights", "concerns", "tomorrowRecommendations", "operationalScore"] as const;

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateSmartInsights(
  data: SmartInsightsData,
  provider: AIProvider = "claude"
): Promise<SmartInsights> {
  return provider === "openai" ? openaiSmartInsights(data) : claudeSmartInsights(data);
}

export async function classifyInboundEvent(
  tenantId: string,
  text: string,
  provider: AIProvider = "claude",
  cfg?: ClassifyConfig
): Promise<EventClassification> {
  return provider === "openai" ? openaiClassifyEvent(text, cfg) : claudeClassifyEvent(text, cfg);
}

export async function generateGuestIntelligence(
  data: GuestHistoryData,
  provider: AIProvider = "claude"
): Promise<GuestIntelligence> {
  return provider === "openai" ? openaiGuestIntelligence(data) : claudeGuestIntelligence(data);
}

export async function generateRevenueInsights(
  data: RevenueData,
  provider: AIProvider = "claude"
): Promise<RevenueInsight> {
  return provider === "openai" ? openaiRevenueInsights(data) : claudeRevenueInsights(data);
}

export async function generateNightAuditReport(
  data: NightAuditData,
  provider: AIProvider = "claude"
): Promise<NightAuditResult> {
  return provider === "openai" ? openaiNightAudit(data) : claudeNightAudit(data);
}
