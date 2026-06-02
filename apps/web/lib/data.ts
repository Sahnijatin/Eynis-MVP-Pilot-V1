import { getApiBaseUrl, getApiToken } from "./api";

export interface OverviewResponse {
  ok: boolean;
  metrics?: {
    openCount: number;
    resolvedTodayCount: number;
    escalatedOpenCount: number;
    slaBreachedOpenCount: number;
  };
}

export interface TrendsResponse {
  ok: boolean;
  series?: Array<{ date: string; created: number; resolved: number }>;
}

export interface QueueSummaryResponse {
  ok: boolean;
  totalOpen?: number;
  byPriority?: Record<string, number>;
}

export interface QueueResponse {
  ok: boolean;
  items?: Array<{
    id: string;
    category: string;
    status: string;
    summary: string;
    priority: string;
    slaDueAt: string | null;
    assignedToUserId: string | null;
    createdAt: string;
  }>;
  page?: { total: number; hasMore: boolean };
}

export interface UsersResponse {
  ok: boolean;
  items?: Array<{ id: string; fullName: string; email: string; role: string; isActive: boolean }>;
}

export interface RevenueAnalyticsResponse {
  ok: boolean;
  totals: {
    totalUpsellInr: number;
    acceptedOffers: number;
    sentOffers: number;
    lateCheckoutInr: number;
    leftOnTableInr: number;
  };
  byAutomationType: Array<{ key: string; sent: number; accepted: number; revenueInr: number }>;
  topConvertingOffers: Array<{ offerType: string; sent: number; accepted: number; conversionRate: number }>;
  funnel: {
    triggered: number;
    sent: number;
    opened: number;
    accepted: number;
    revenueInr: number;
  };
}

export interface StaffPerformanceResponse {
  ok: boolean;
  summary: {
    avgResolutionMinutes: number;
    completionRate: number;
    avgGuestRating: number;
    utilizationRate: number;
  };
  leaderboard: Array<{
    userId: string;
    fullName: string;
    role: string;
    completedTasks: number;
    avgResolutionMinutes: number;
  }>;
  workloadByRole: Array<{ role: string; openTasks: number; resolvedTasks: number }>;
  alerts: string[];
}

export interface ConnectorRegistryResponse {
  ok: boolean;
  items: Array<{
    key: string;
    category: string;
    enabled: boolean;
    status: "ready" | "disabled" | "planned";
    ingestModes: string[];
  }>;
}

export interface LiveFeedResponse {
  ok: boolean;
  items: Array<{
    id: string;
    category: string;
    status: string;
    summary: string;
    priority: string;
    createdAt: string;
    assignedToUserId: string | null;
    guest: { fullName: string } | null;
    assignedTo: { fullName: string } | null;
  }>;
}

export interface GuestsResponse {
  ok: boolean;
  items: Array<{
    id: string;
    fullName: string;
    phoneE164: string;
    visitCount: number;
    segment: string;
    status: string;
    lastStay: string;
    totalRequests: number;
    createdAt: string;
  }>;
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface AutomationsResponse {
  ok: boolean;
  items: Array<{
    id: string;
    code: string;
    name: string;
    isActive: boolean;
    ruleType: "marketing" | "operational";
    executions: number;
    conversions: number;
    revenueInr: number;
    lastFiredAt: string | null;
    createdAt: string;
  }>;
  summary: {
    totalAutomations: number;
    activeFlows: number;
    avgConversion: number;
    revenueAttributed: number;
    totalExecutions: number;
  };
}

export interface AutomationExecutionsResponse {
  ok: boolean;
  items: Array<{
    id: string;
    ruleId: string;
    ruleCode: string;
    triggerType: string;
    triggerEntityId: string | null;
    actionType: string;
    actionResult: string;
    resultDetail: string | null;
    executedAt: string;
  }>;
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

export interface GuestProfileResponse {
  ok: boolean;
  guest?: {
    id: string;
    fullName: string;
    phoneE164: string;
    visitCount: number;
    segment: string;
    totalSpendInr: number;
    createdAt: string;
    currentStay: { id: string; roomNumber: string; checkInAt: string; checkOutAt: string } | null;
    stays: Array<{ id: string; roomNumber: string; checkInAt: string; checkOutAt: string }>;
    serviceRequests: Array<{
      id: string; category: string; status: string; summary: string;
      priority: string; createdAt: string; resolvedAt: string | null;
      assignedTo: { fullName: string } | null;
    }>;
    connectorEvents: Array<{
      id: string; connectorKey: string; aiCategory: string | null;
      aiSummary: string | null; aiSentiment: string | null;
      replyStatus: string | null; createdAt: string;
    }>;
  };
}

export interface SentimentResponse {
  ok: boolean;
  netScore: number;
  totalFeedback: number;
  surveyCompletionRate: number;
  breakdown: { positive: number; neutral: number; negative: number };
  bySource: Array<{ source: string; count: number }>;
  drivers: Array<{ term: string; weight: number; sentiment: string }>;
  timeSeries: Array<{ day: number; score: number }>;
  alert: { type: string; message: string };
}

export interface UpsellCampaignsResponse {
  ok: boolean;
  items: Array<{
    id: string;
    name: string;
    status: string;
    trigger: string;
    recipients: number;
    conversions: number;
    conversionRate: number;
    revenueInr: number;
    createdAt: string;
  }>;
  total: number;
  weeklyData: Array<{ day: string; executions: number; conversions: number }>;
}

export interface TeamUser {
  id: string;
  fullName: string;
  email: string;
  role: string;
  roleId: string | null;
  isActive: boolean;
  systemRole: { id: string; key: string; displayName: string } | null;
}

export interface TeamUsersResponse {
  ok: boolean;
  users?: TeamUser[];
  usedSeats?: number;
  maxSeats?: number;
}

export interface TeamRole {
  id: string;
  key: string;
  displayName: string;
  permissions: string[];
  isSystem: boolean;
  isCustom: boolean;
  userCount: number;
}

export interface TeamRolesResponse {
  ok: boolean;
  roles?: TeamRole[];
}

export interface TeamLicenseResponse {
  ok: boolean;
  license?: {
    plan: string;
    maxSeats: number;
    usedSeats: number;
    renewsAt: string | null;
  };
}

// 5s hard timeout on every server-side API call. If the API is down or slow
// the page must still render — never block streaming long enough for the user
// to see a blank shell. Callers handle non-OK / aborted responses gracefully.
async function authedFetch(path: string) {
  const token = await getApiToken();
  const headers = { Authorization: "Bearer " + token };
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    return await fetch(getApiBaseUrl() + path, { headers, cache: "no-store", signal: ctrl.signal });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchDashboardData() {
  const [overviewRes, trendsRes, queueSummaryRes, liveFeedRes] = await Promise.all([
    authedFetch("/dashboard/overview"),
    authedFetch("/dashboard/trends?days=14"),
    authedFetch("/dashboard/queue-summary"),
    authedFetch("/dashboard/live-feed")
  ]);
  return {
    overview: (await overviewRes.json()) as OverviewResponse,
    trends: (await trendsRes.json()) as TrendsResponse,
    queueSummary: (await queueSummaryRes.json()) as QueueSummaryResponse,
    liveFeed: (await liveFeedRes.json()) as LiveFeedResponse
  };
}

export async function fetchQueueData(filters: {
  status?: string;
  slaState?: string;
  assignedToMe?: string;
  sortBy?: string;
  sortOrder?: string;
}) {
  const query = new URLSearchParams({
    limit: "20",
    sortBy: filters.sortBy || "createdAt",
    sortOrder: filters.sortOrder || "desc"
  });
  if (filters.status) query.set("status", filters.status);
  if (filters.slaState) query.set("slaState", filters.slaState);
  if (filters.assignedToMe === "true") query.set("assignedToMe", "true");

  const [queueRes, usersRes] = await Promise.all([
    authedFetch("/service-requests?" + query.toString()),
    authedFetch("/users?isActive=true&limit=100")
  ]);
  return {
    queue: (await queueRes.json()) as QueueResponse,
    users: (await usersRes.json()) as UsersResponse
  };
}

export async function fetchRevenueAnalytics() {
  const res = await authedFetch("/analytics/revenue-intelligence");
  return (await res.json()) as RevenueAnalyticsResponse;
}

export async function fetchStaffPerformance() {
  const res = await authedFetch("/analytics/staff-performance");
  return (await res.json()) as StaffPerformanceResponse;
}

export async function fetchConnectorRegistry() {
  const res = await authedFetch("/connectors/registry");
  return (await res.json()) as ConnectorRegistryResponse;
}

export async function fetchLiveFeed() {
  const res = await authedFetch("/dashboard/live-feed");
  return (await res.json()) as LiveFeedResponse;
}

export async function fetchGuests(params: { search?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  const res = await authedFetch("/guests?" + query.toString());
  return (await res.json()) as GuestsResponse;
}

export async function fetchAutomations() {
  const res = await authedFetch("/automations");
  return (await res.json()) as AutomationsResponse;
}

export async function fetchAutomationExecutions(limit = 20): Promise<AutomationExecutionsResponse> {
  const res = await authedFetch(`/automations/executions?limit=${limit}`);
  return (await res.json()) as AutomationExecutionsResponse;
}

export async function fetchGuestProfile(guestId: string): Promise<GuestProfileResponse> {
  try {
    const res = await authedFetch(`/guests/${encodeURIComponent(guestId)}`);
    return (await res.json()) as GuestProfileResponse;
  } catch {
    return { ok: false };
  }
}

export async function fetchSentiment() {
  const res = await authedFetch("/analytics/sentiment");
  return (await res.json()) as SentimentResponse;
}

export interface ConnectorEventsResponse {
  ok: boolean;
  items: Array<{
    id: string;
    connectorKey: string;
    eventType: string;
    guestPhone: string | null;
    guestName: string | null;
    aiProvider: string | null;
    aiCategory: string | null;
    aiPriority: string | null;
    aiSummary: string | null;
    aiSentiment: string | null;
    aiRoutingHint: string | null;
    serviceRequestId: string | null;
    replySentAt: string | null;
    replyStatus: string | null;
    createdAt: string;
  }>;
  page: { limit: number; offset: number; total: number; hasMore: boolean };
}

export async function fetchConnectorEvents(limit = 10): Promise<ConnectorEventsResponse> {
  const res = await authedFetch(`/connectors/events?limit=${limit}`);
  return (await res.json()) as ConnectorEventsResponse;
}

export async function fetchUpsellCampaigns() {
  const res = await authedFetch("/analytics/upsell-campaigns");
  return (await res.json()) as UpsellCampaignsResponse;
}

export interface AIProvidersResponse {
  ok: boolean;
  claude: boolean;
  openai: boolean;
}

export async function fetchAIProviders(): Promise<AIProvidersResponse> {
  try {
    const res = await authedFetch("/ai/providers");
    return (await res.json()) as AIProvidersResponse;
  } catch {
    return { ok: false, claude: false, openai: false };
  }
}

export interface MorningBriefingResponse {
  ok: boolean;
  provider?: string;
  briefing?: {
    headline: string;
    operationalAlerts: string[];
    revenueHighlight: string;
    guestExperienceNote: string;
    topPriority: string;
  };
  error?: string;
}

export async function fetchMorningBriefing(provider: "claude" | "openai" = "claude"): Promise<MorningBriefingResponse> {
  try {
    const res = await authedFetch(`/ai/morning-briefing?provider=${provider}`);
    return (await res.json()) as MorningBriefingResponse;
  } catch {
    return { ok: false, error: "Unable to reach AI service" };
  }
}

export interface GuestIntelligenceResponse {
  ok: boolean;
  guestId?: string;
  guestName?: string;
  intelligence?: {
    arrivalBrief: string;
    keyPreferences: string[];
    upsellOpportunities: string[];
    attentionFlags: string[];
    vipScore: "standard" | "valued" | "vip" | "priority";
  };
  error?: string;
}

export async function fetchGuestIntelligence(guestId: string, provider: "claude" | "openai" = "claude"): Promise<GuestIntelligenceResponse> {
  try {
    const res = await authedFetch(`/ai/guest-intelligence/${encodeURIComponent(guestId)}?provider=${provider}`);
    return (await res.json()) as GuestIntelligenceResponse;
  } catch {
    return { ok: false, error: "Unable to reach AI service" };
  }
}

export interface NightAuditReport {
  headline: string;
  executiveSummary: string;
  highlights: string[];
  concerns: string[];
  tomorrowRecommendations: string[];
  operationalScore: number;
}

export interface NightAuditResponse {
  ok: boolean;
  reportDate?: string;
  provider?: string;
  generatedAt?: string;
  report?: NightAuditReport;
  error?: string;
}

// NOTE: the night-audit fetch helpers (which call the relative /api/night-audit
// proxy) live in the night-audit client component, NOT here. This module imports
// server-only code via ./api (Clerk), so importing any runtime value from it into
// a Client Component breaks `next build` with a "server-only" error. Only the
// types above are safe to import from here (via `import type`).

export async function fetchTeamUsers(): Promise<TeamUsersResponse> {
  const res = await authedFetch("/team/users");
  return (await res.json()) as TeamUsersResponse;
}

export async function fetchTeamRoles(): Promise<TeamRolesResponse> {
  const res = await authedFetch("/team/roles");
  return (await res.json()) as TeamRolesResponse;
}

export async function fetchTeamLicense(): Promise<TeamLicenseResponse> {
  const res = await authedFetch("/team/license");
  return (await res.json()) as TeamLicenseResponse;
}
