import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

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

interface HotelBriefingData {
  hotelName: string;
  date: string;
  openRequests: number;
  escalatedRequests: number;
  occupancyPct: number;
  todayRevenue: number;
  arrivingGuests: number;
  avgSentimentScore: number;
  topPendingCategories: string[];
}

export interface MorningBriefing {
  headline: string;
  operationalAlerts: string[];
  revenueHighlight: string;
  guestExperienceNote: string;
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
  category: "housekeeping" | "maintenance" | "fnb" | "concierge" | "front_desk" | "other";
  priority: "urgent" | "high" | "normal";
  summary: string;
  sentiment: "positive" | "neutral" | "negative";
  routingHint: string;
  slaMinutes: number;
}

interface RevenueData {
  hotelName: string;
  occupancyPct: number;
  adrInr: number;
  revParInr: number;
  upsellConversionPct: number;
  topCategories: Array<{ name: string; revenueInr: number }>;
  weekTrend: "up" | "flat" | "down";
  availableRooms: number;
}

export interface RevenueInsight {
  summary: string;
  recommendations: string[];
  quickWin: string;
  riskAlert: string | null;
}

// ── Prompt builders (shared across providers) ─────────────────────────────────

function briefingPrompt(data: HotelBriefingData): string {
  return `Generate a morning operations briefing for ${data.hotelName} on ${data.date}.

Hotel data:
- Occupancy: ${data.occupancyPct}%
- Open service requests: ${data.openRequests} (${data.escalatedRequests} escalated)
- Today's revenue so far: ₹${data.todayRevenue.toLocaleString("en-IN")}
- Guests arriving today: ${data.arrivingGuests}
- Guest sentiment score: ${data.avgSentimentScore}/100
- Pending request categories: ${data.topPendingCategories.join(", ")}

Return a JSON object with exactly these keys:
{
  "headline": "one-sentence executive summary of today's status",
  "operationalAlerts": ["up to 3 specific action items the team must address today"],
  "revenueHighlight": "one sentence on revenue position vs typical day",
  "guestExperienceNote": "one sentence on guest satisfaction trend",
  "topPriority": "single most important thing for the GM to handle first"
}`;
}

function classifyPrompt(tenantId: string, text: string): string {
  return `A guest message arrived at hotel ${tenantId}. Classify it and extract key details.

Guest message: "${text}"

Return a JSON object with exactly these keys:
{
  "category": one of: "housekeeping" | "maintenance" | "fnb" | "concierge" | "front_desk" | "other",
  "priority": one of: "urgent" | "high" | "normal",
  "summary": "10-15 word summary of the request for the operations team",
  "sentiment": one of: "positive" | "neutral" | "negative",
  "routingHint": "which team or person should handle this",
  "slaMinutes": target resolution time in minutes as an integer
}`;
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

Revenue data:
- Occupancy: ${data.occupancyPct}%
- ADR: ₹${data.adrInr.toLocaleString("en-IN")}
- RevPAR: ₹${data.revParInr.toLocaleString("en-IN")}
- Upsell conversion rate: ${data.upsellConversionPct}%
- Weekly trend: ${data.weekTrend}
- Available rooms right now: ${data.availableRooms}
- Top revenue categories: ${data.topCategories.map((c) => `${c.name} (₹${c.revenueInr.toLocaleString("en-IN")})`).join(", ")}

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

async function claudeMorningBriefing(data: HotelBriefingData): Promise<MorningBriefing> {
  return parseStructured<MorningBriefing>(await claudeCall(briefingPrompt(data)), BRIEFING_KEYS);
}

async function claudeClassifyEvent(tenantId: string, text: string): Promise<EventClassification> {
  return parseStructured<EventClassification>(await claudeCall(classifyPrompt(tenantId, text)), CLASSIFICATION_KEYS);
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

async function openaiMorningBriefing(data: HotelBriefingData): Promise<MorningBriefing> {
  return parseStructured<MorningBriefing>(await openaiCall(briefingPrompt(data)), BRIEFING_KEYS);
}

async function openaiClassifyEvent(tenantId: string, text: string): Promise<EventClassification> {
  return parseStructured<EventClassification>(await openaiCall(classifyPrompt(tenantId, text)), CLASSIFICATION_KEYS);
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
  occupancyPct: number;
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

Day summary:
- Occupancy: ${data.occupancyPct}%
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
const BRIEFING_KEYS = ["headline", "operationalAlerts", "revenueHighlight", "guestExperienceNote", "topPriority"] as const;
const CLASSIFICATION_KEYS = ["category", "priority", "summary", "sentiment", "routingHint", "slaMinutes"] as const;
const GUEST_KEYS = ["arrivalBrief", "keyPreferences", "upsellOpportunities", "attentionFlags", "vipScore"] as const;
const REVENUE_KEYS = ["summary", "recommendations", "quickWin", "riskAlert"] as const;
const NIGHT_AUDIT_KEYS = ["headline", "executiveSummary", "highlights", "concerns", "tomorrowRecommendations", "operationalScore"] as const;

// ── Public API ────────────────────────────────────────────────────────────────

export async function generateMorningBriefing(
  data: HotelBriefingData,
  provider: AIProvider = "claude"
): Promise<MorningBriefing> {
  return provider === "openai" ? openaiMorningBriefing(data) : claudeMorningBriefing(data);
}

export async function classifyInboundEvent(
  tenantId: string,
  text: string,
  provider: AIProvider = "claude"
): Promise<EventClassification> {
  return provider === "openai" ? openaiClassifyEvent(tenantId, text) : claudeClassifyEvent(tenantId, text);
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
