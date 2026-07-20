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
  byStatus?: Record<string, number>;
  byPriority?: Record<string, number>;
  byCategory?: Record<string, number>;
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
    avgGuestRating: number | null; // null when there's no sentiment feedback yet
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

export interface ConnectorField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

export interface ConnectorRegistryItem {
  key: string;
  category: string;
  categoryLabel: string;
  name: string;
  description: string;
  icon: string;
  brandColor: string;
  requiredFields: ConnectorField[];
  planned: boolean;
  enabled: boolean;
  status: "connected" | "disabled" | "planned";
  source: "hotel_config" | "env";
  ingestModes: string[];
  config: Record<string, string>;
}

export interface ConnectorRegistryResponse {
  ok: boolean;
  items: ConnectorRegistryItem[];
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
  surveyCompletionRate: number | null;
  breakdown: { positive: number; neutral: number; negative: number };
  bySource: Array<{ source: string; count: number }>;
  drivers: Array<{ term: string; weight: number; sentiment: string }>;
  timeSeries: Array<{ day: number; score: number | null }>;
  alert: { type: string; message: string } | null;
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

// Graceful-empty fetch (improvement plan 3.4): any transport error, timeout, or
// non-OK status resolves to the caller's typed empty shape instead of throwing
// into the route error boundary — a flaky API shows an honest empty state, not
// a crash page. Use for list/summary reads; keep bespoke handling where the
// caller needs the error detail.
async function fetchOr<T>(path: string, empty: T): Promise<T> {
  try {
    const res = await authedFetch(path);
    if (!res.ok) return empty;
    return (await res.json()) as T;
  } catch {
    return empty;
  }
}

export async function fetchDashboardData() {
  const [overview, trends, queueSummary, liveFeed] = await Promise.all([
    fetchOr<OverviewResponse | null>("/dashboard/overview", null),
    fetchOr<TrendsResponse | null>("/dashboard/trends?days=14", null),
    fetchOr<QueueSummaryResponse | null>("/dashboard/queue-summary", null),
    fetchOr<LiveFeedResponse | null>("/dashboard/live-feed", null)
  ]);
  return { overview, trends, queueSummary, liveFeed };
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

// Optional `from`/`to` reporting window (E-15) → query string; empty when neither.
function rangeQs(from?: string, to?: string): string {
  const qs = new URLSearchParams();
  if (from) qs.set("from", from);
  if (to) qs.set("to", to);
  const s = qs.toString();
  return s ? `?${s}` : "";
}

// Revenue + staff analytics now back real pages (#128). Both degrade to a safe,
// zeroed shape on any error so the page renders an honest empty state instead of
// throwing into the workspace error boundary.
export async function fetchRevenueAnalytics(from?: string, to?: string): Promise<RevenueAnalyticsResponse> {
  const empty: RevenueAnalyticsResponse = {
    ok: false,
    totals: { totalUpsellInr: 0, acceptedOffers: 0, sentOffers: 0, lateCheckoutInr: 0, leftOnTableInr: 0 },
    byAutomationType: [], topConvertingOffers: [],
    funnel: { triggered: 0, sent: 0, opened: 0, accepted: 0, revenueInr: 0 },
  };
  try {
    const res = await authedFetch(`/analytics/revenue-intelligence${rangeQs(from, to)}`);
    if (!res.ok) return empty;
    return { ...empty, ...(await res.json()) as Partial<RevenueAnalyticsResponse> };
  } catch {
    return empty;
  }
}

export async function fetchStaffPerformance(from?: string, to?: string): Promise<StaffPerformanceResponse> {
  const empty: StaffPerformanceResponse = {
    ok: false,
    summary: { avgResolutionMinutes: 0, completionRate: 0, avgGuestRating: null, utilizationRate: 0 },
    leaderboard: [], workloadByRole: [], alerts: [],
  };
  try {
    const res = await authedFetch(`/analytics/staff-performance${rangeQs(from, to)}`);
    if (!res.ok) return empty;
    return { ...empty, ...(await res.json()) as Partial<StaffPerformanceResponse> };
  } catch {
    return empty;
  }
}

export interface SavedReportItem {
  id: string;
  name: string;
  description: string | null;
  source: string;
  shared: boolean;
  isOwner: boolean;
  createdAt: string;
  updatedAt: string;
}

// Saved custom reports the current user can see (own + shared) — E-16. Degrades to
// an empty list on any error so the Reports landing still renders.
export async function fetchReports(): Promise<{ ok: boolean; items: SavedReportItem[] }> {
  try {
    const res = await authedFetch("/reports");
    if (!res.ok) return { ok: false, items: [] };
    return (await res.json()) as { ok: boolean; items: SavedReportItem[] };
  } catch {
    return { ok: false, items: [] };
  }
}

// ── Research Studio (RS-1) ──────────────────────────────────────────────────
export interface ResearchTemplateItem {
  id: string;
  name: string;
  description: string | null;
  subjectType: string;
  isBuiltIn: boolean;
  sectionCount: number;
  sourceCount: number;
  updatedAt: string | null;
  isOwner: boolean;
}
export interface ResearchRunItem {
  id: string;
  templateName: string;
  subjectType: string;
  subjectLabel: string | null;
  status: string;
  progress: number;
  stage: string | null;
  score: number | null;
  error: string | null;
  createdAt: string;
  completedAt: string | null;
}
export interface ResearchSourceCatalog {
  sources: Array<{ key: string; label: string; cost: string; hint: string; needs?: string }>;
  subjectTypes: string[];
  outputs: string[];
  searchConfigured?: boolean;
  aiConfigured?: boolean;
}

export async function fetchResearchTemplates(): Promise<{ ok: boolean; items: ResearchTemplateItem[]; error?: string }> {
  try {
    const res = await authedFetch("/research/templates");
    const data = (await res.json()) as { ok: boolean; items?: ResearchTemplateItem[]; error?: string };
    return { ok: res.ok && data.ok, items: data.items ?? [], error: data.error };
  } catch {
    return { ok: false, items: [] };
  }
}

export async function fetchResearchRuns(): Promise<{ ok: boolean; items: ResearchRunItem[] }> {
  try {
    const res = await authedFetch("/research/runs");
    if (!res.ok) return { ok: false, items: [] };
    return (await res.json()) as { ok: boolean; items: ResearchRunItem[] };
  } catch {
    return { ok: false, items: [] };
  }
}

export interface ResearchTrigger { stageId: string; templateId: string; fast?: boolean }

export async function fetchResearchTriggers(): Promise<{ ok: boolean; triggers: ResearchTrigger[] }> {
  try {
    const res = await authedFetch("/research/triggers");
    if (!res.ok) return { ok: false, triggers: [] };
    return (await res.json()) as { ok: boolean; triggers: ResearchTrigger[] };
  } catch {
    return { ok: false, triggers: [] };
  }
}

export async function fetchResearchSources(): Promise<ResearchSourceCatalog | null> {
  try {
    const res = await authedFetch("/research/sources");
    if (!res.ok) return null;
    return (await res.json()) as ResearchSourceCatalog;
  } catch {
    return null;
  }
}

export async function fetchConnectorRegistry() {
  return fetchOr<ConnectorRegistryResponse>("/connectors/registry", { ok: false, items: [] });
}

export async function fetchLiveFeed() {
  return fetchOr<LiveFeedResponse>("/dashboard/live-feed", { ok: false, items: [] });
}

export async function fetchGuests(params: { search?: string; limit?: number; offset?: number } = {}) {
  const query = new URLSearchParams();
  if (params.search) query.set("search", params.search);
  if (params.limit) query.set("limit", String(params.limit));
  if (params.offset) query.set("offset", String(params.offset));
  return fetchOr<GuestsResponse>("/guests?" + query.toString(), { ok: false, items: [], page: { limit: 0, offset: 0, total: 0, hasMore: false } });
}

export async function fetchAutomations() {
  return fetchOr<AutomationsResponse>("/automations", {
    ok: false,
    items: [],
    summary: { totalAutomations: 0, activeFlows: 0, avgConversion: 0, revenueAttributed: 0, totalExecutions: 0 },
  });
}

export async function fetchAutomationExecutions(limit = 20): Promise<AutomationExecutionsResponse> {
  return fetchOr<AutomationExecutionsResponse>(`/automations/executions?limit=${limit}`, { ok: false, items: [], page: { limit: 0, offset: 0, total: 0, hasMore: false } });
}

export async function fetchGuestProfile(guestId: string): Promise<GuestProfileResponse> {
  try {
    const res = await authedFetch(`/guests/${encodeURIComponent(guestId)}`);
    return (await res.json()) as GuestProfileResponse;
  } catch {
    return { ok: false };
  }
}

export async function fetchSentiment(from?: string, to?: string): Promise<SentimentResponse> {
  // Degrade gracefully: a 403 (e.g. analytics not in the tenant's plan), a 5xx,
  // or a network error must render the page's empty state, never throw and trip
  // the workspace error boundary ("Couldn't load this page").
  const empty: SentimentResponse = {
    ok: false, netScore: 0, totalFeedback: 0, surveyCompletionRate: null,
    breakdown: { positive: 0, neutral: 0, negative: 0 },
    bySource: [], drivers: [], timeSeries: [], alert: null,
  };
  try {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const suffix = qs.toString() ? `?${qs.toString()}` : "";
    const res = await authedFetch(`/analytics/sentiment${suffix}`);
    if (!res.ok) return empty;
    const data = (await res.json()) as Partial<SentimentResponse>;
    return { ...empty, ...data };
  } catch {
    return empty;
  }
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

export async function fetchUpsellCampaigns(): Promise<UpsellCampaignsResponse> {
  // Same graceful-degradation contract as fetchSentiment — never throw on a 403/
  // 5xx/network failure; render the empty state instead.
  const empty: UpsellCampaignsResponse = { ok: false, items: [], total: 0, weeklyData: [] };
  try {
    const res = await authedFetch("/analytics/upsell-campaigns");
    if (!res.ok) return empty;
    const data = (await res.json()) as Partial<UpsellCampaignsResponse>;
    return { ...empty, ...data };
  } catch {
    return empty;
  }
}

export interface InventoryItem {
  id: string;
  name: string;
  category: string;
  stock: number;
  unit: string;
  reorderLevel: number;
  unitCostPaise: number;
  unitCostInr: number; // rupees (may be fractional) — derived from paise
  status: "ok" | "warning" | "critical";
  updatedAt: string;
}

export interface InventoryYieldRow {
  id: string;
  name: string;
  category: string;
  unit: string;
  stock: number;
  reorderLevel: number;
  unitCostPaise: number;
  status: "ok" | "warning" | "critical";
  receivedQty: number;
  usedQty: number;
  wasteQty: number;
  wasteRatioPct: number;
  committedQty: number;
}
export interface InventoryResponse {
  ok: boolean;
  items: InventoryItem[];
}

export async function fetchInventory() {
  return fetchOr<InventoryResponse>("/inventory/items", { ok: false, items: [] });
}

// ── Customer intelligence (Phase 7) ──────────────────────────────────────────
export interface ContactIntelRow {
  id: string;
  fullName: string;
  phoneE164: string;
  email: string | null;
  acceptedTotalPaise: number;
  acceptedCount: number;
  lastAcceptedAt: string | null;
  pendingQuotes: number;
  openOrders: number;
}

export async function fetchContactIntel(): Promise<{ ok: boolean; items: ContactIntelRow[] }> {
  return fetchOr("/contacts/intel", { ok: false, items: [] });
}

// ── Orders (fulfillment pipeline, Phase 7) ────────────────────────────────────
export interface OrderRow {
  id: string;
  number: string;
  stage: "new" | "production" | "qc" | "dispatch" | "delivered";
  valuePaise: number;
  quoteNumber: string;
  title: string;
  contactName: string | null;
  companyName: string | null;
  promisedDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}
export interface OrderStageSummary { stage: OrderRow["stage"]; count: number; valuePaise: number }

export async function fetchOrders(): Promise<{ ok: boolean; items: OrderRow[]; summary: OrderStageSummary[] }> {
  return fetchOr("/orders?limit=200", { ok: false, items: [], summary: [] });
}

export async function fetchInventoryYield(days = 90) {
  return fetchOr<{ ok: boolean; windowDays: number; items: InventoryYieldRow[] }>(
    `/inventory/yield?days=${days}`,
    { ok: false, windowDays: days, items: [] },
  );
}

// ── Quotes (component-based costing) ──────────────────────────────────────────
export interface QuoteLineItem {
  id: string;
  groupName: string;
  name: string;
  kind: string;
  costBasis: string;
  lengthMm: number | null;
  widthMm: number | null;
  heightMm: number | null;
  quantity: number;
  inventoryItemId: string | null;
  materialUnit: string;
  unitRatePaise: number;
  unitRateInr: number;
  wastagePct: number;
  laborHours: number;
  laborRatePaise: number;
  computedQty: number;
  materialCostPaise: number;
  laborCostPaise: number;
  lineCostPaise: number;
  lineCostInr: number;
  sortOrder: number;
}
export interface Quote {
  id: string;
  number: string;
  title: string;
  status: "draft" | "sent" | "accepted" | "rejected" | "expired";
  contactId: string | null;
  companyId: string | null;
  dealId: string | null;
  templateId: string | null;
  currency: string;
  overheadPct: number;
  marginPct: number;
  marginFloorPct: number;
  discountPaise: number;
  materialCostPaise: number;
  laborCostPaise: number;
  overheadPaise: number;
  subtotalCostPaise: number;
  marginPaise: number;
  totalPaise: number;
  totalInr: number;
  marginPctActual: number;
  gstPercent: number;
  gstPaise: number;
  grandTotalPaise: number;
  grandTotalInr: number;
  notes: string | null;
  terms: string | null;
  validUntil: string | null;
  sentAt: string | null;
  acceptedAt: string | null;
  rejectedAt: string | null;
  rejectedReason: string | null;
  createdAt: string;
  updatedAt: string;
  contactName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  seller: QuoteSeller;
  billTo: QuoteBillTo;
  lineImages: Record<string, string[]>; // per-piece image data URLs, keyed by groupName
  hsn: Record<string, string>; // per-piece HSN/SAC codes, keyed by groupName
  qty: Record<string, number>; // per-piece quantities, keyed by groupName
  lineItems: QuoteLineItem[];
}

// Per-quote quotation letterhead snapshot (all fields optional — entered in the builder).
export interface QuoteSeller {
  name?: string; address?: string; phone?: string; email?: string; gstin?: string; pan?: string;
  bankAccountName?: string; bankAccountNumber?: string; bankName?: string; bankBranch?: string; ifsc?: string; upi?: string;
  signatory?: string;
}
export interface QuoteBillTo {
  name?: string; address?: string; pin?: string; phone?: string; gstin?: string; stateCode?: string;
}
export interface QuoteTemplateComponent {
  id: string;
  name: string;
  kind: string;
  costBasis: string;
  inventoryItemId: string | null;
  materialUnit: string;
  defaultRatePaise: number;
  defaultLengthMm: number | null;
  defaultWidthMm: number | null;
  defaultHeightMm: number | null;
  defaultQuantity: number;
  wastagePct: number;
  laborHours: number;
  sortOrder: number;
}
export interface QuoteTemplate {
  id: string;
  name: string;
  category: string;
  description: string | null;
  isActive: boolean;
  overheadPct: number;
  marginPct: number;
  marginFloorPct: number;
  laborRatePaise: number;
  components: QuoteTemplateComponent[];
}

export async function fetchQuotes(): Promise<{ ok: boolean; items: Quote[] }> {
  try {
    const res = await authedFetch("/quotes?limit=100");
    if (!res.ok) return { ok: false, items: [] };
    return (await res.json()) as { ok: boolean; items: Quote[] };
  } catch {
    return { ok: false, items: [] };
  }
}
export async function fetchQuoteTemplates(): Promise<{ ok: boolean; items: QuoteTemplate[] }> {
  try {
    const res = await authedFetch("/quote-templates");
    if (!res.ok) return { ok: false, items: [] };
    return (await res.json()) as { ok: boolean; items: QuoteTemplate[] };
  } catch {
    return { ok: false, items: [] };
  }
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
  return fetchOr<TeamUsersResponse>("/team/users", { ok: false });
}

export async function fetchTeamRoles(): Promise<TeamRolesResponse> {
  return fetchOr<TeamRolesResponse>("/team/roles", { ok: false });
}

export async function fetchTeamLicense(): Promise<TeamLicenseResponse> {
  return fetchOr<TeamLicenseResponse>("/team/license", { ok: false });
}

export interface MenuItemRow {
  id: string; name: string; category: string; description: string | null;
  isAvailable: boolean; pricePaise: number; priceInr: number; costPaise: number; costInr: number; marginPct: number;
}
export async function fetchMenuItems(): Promise<{ ok: boolean; items: MenuItemRow[] }> {
  return fetchOr<{ ok: boolean; items: MenuItemRow[] }>("/menu/items", { ok: false, items: [] });
}

export interface BookingRow {
  id: string; number: string; clientName: string; destination: string; departureDate: string | null;
  pax: number; status: string; notes: string | null;
  valuePaise: number; valueInr: number; paidPaise: number; paidInr: number; paidPct: number;
}
export async function fetchBookings(): Promise<{ ok: boolean; items: BookingRow[] }> {
  return fetchOr<{ ok: boolean; items: BookingRow[] }>("/bookings", { ok: false, items: [] });
}

export interface PatientRow {
  id: string; name: string; phone: string | null; email: string | null; dateOfBirth: string | null; age: number | null;
  condition: string | null; bloodGroup: string | null; insurance: string | null; status: string; notes: string | null;
}
export async function fetchPatients(): Promise<{ ok: boolean; items: PatientRow[] }> {
  return fetchOr<{ ok: boolean; items: PatientRow[] }>("/patients", { ok: false, items: [] });
}

export interface AppointmentRow {
  id: string; patientId: string | null; patientName: string; provider: string; type: string | null;
  scheduledAt: string; durationMin: number; status: string; notes: string | null;
}
export async function fetchAppointments(date?: string): Promise<{ ok: boolean; items: AppointmentRow[] }> {
  return fetchOr<{ ok: boolean; items: AppointmentRow[] }>(`/appointments${date ? `?date=${encodeURIComponent(date)}` : ""}`, { ok: false, items: [] });
}

export interface TenantProfile { name: string; timezone: string; address: string | null; phone: string | null }
export async function fetchTenantProfile(): Promise<TenantProfile | null> {
  // Admin-only (manage_settings); non-admins get null, which the UI treats as
  // "no editable property details".
  const res = await fetchOr<{ ok: boolean; profile?: TenantProfile }>("/tenant/profile", { ok: false });
  return res.ok && res.profile ? res.profile : null;
}

// ── Voice / multi-channel campaigns ───────────────────────────────────────────

export interface CampaignSummary {
  id: string;
  name: string;
  status: string;
  channels: string[];
  createdAt: string;
  stats?: { totalLeads: number; totalCalls: number };
}

export interface CampaignVariant {
  key: string;
  label: string;
  voice: string | null;
  persona: string | null;
  scriptOverride: string | null;
  weight: number;
  vapiAssistantId: string | null;
}

export interface CampaignDetail extends CampaignSummary {
  scriptTemplate: string | null;
  variants: CampaignVariant[];
  agentName: string | null;
  calendlyLink: string | null;
  outcomeTypes: string[];
  followUpRules: Record<string, string[]>;
  whatsappContentSid: string | null;
  whatsappTemplateId: string | null;
  whatsappTemplateBody: string | null;
  whatsappVariables: string[];
  emailSubjectTemplate: string | null;
  emailBodyTemplate: string | null;
  maxRetries: number;
  retryDelayHours: number;
  maxConcurrent: number;
  spendCapCalls: number | null;
  defaultCountryCode: string;
  segmentId: string | null;
  scheduledStartAt: string | null;
  sendWindowStartMin: number | null;
  sendWindowEndMin: number | null;
  sendDays: number[];
  sendTimeZone: string | null;
}

export interface CampaignLeadRow {
  id: string;
  firstName: string;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  company: string | null;
  abVariant: string | null;
  status: string;
  tags: string[];
  callAttempts: number;
  consent: boolean;
  optedOut: boolean;
  createdAt: string;
}

export interface SegmentRules {
  status?: string[];
  consent?: boolean;
  optedOut?: boolean;
  tagsAny?: string[];
  tagsAll?: string[];
  tagsNot?: string[];
  company?: string;
  jobTitle?: string;
  search?: string;
}

export interface LeadSegmentRow {
  id: string;
  name: string;
  rules: SegmentRules;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSegments(): Promise<{ ok: boolean; items: LeadSegmentRow[] }> {
  return fetchOr("/segments", { ok: false, items: [] });
}

export interface SequenceStepRow {
  order: number;
  waitMinutes: number;
  channel: "whatsapp" | "email";
  whatsappContentSid: string | null;
  whatsappTemplateId: string | null;
  whatsappTemplateBody: string | null;
  whatsappVariables: string[];
  emailSubject: string | null;
  emailBody: string | null;
}

export interface SequenceRow {
  id: string;
  name: string;
  status: "draft" | "active" | "archived";
  exitOn: string[];
  steps?: SequenceStepRow[];
  stepCount?: number;
  enrollmentCount?: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchSequences(): Promise<{ ok: boolean; items: SequenceRow[] }> {
  return fetchOr("/sequences", { ok: false, items: [] });
}

export interface MessageTemplateRow {
  id: string;
  name: string;
  channel: "whatsapp" | "email";
  category: string;
  language: string;
  subject: string | null;
  body: string;
  variables: string[];
  status: "draft" | "submitted" | "approved" | "rejected";
  providerTemplateId: string | null;
  rejectionReason: string | null;
  createdAt: string;
  updatedAt: string;
}

export async function fetchTemplates(): Promise<{ ok: boolean; items: MessageTemplateRow[] }> {
  return fetchOr("/templates", { ok: false, items: [] });
}

export async function fetchCampaigns(): Promise<{ ok: boolean; items: CampaignSummary[] }> {
  return fetchOr("/campaigns?limit=100", { ok: false, items: [] });
}

export async function fetchCampaign(id: string): Promise<{
  ok: boolean;
  campaign?: CampaignDetail;
  stats?: {
    totalLeads: number;
    totalCalls: number;
    outcomeBreakdown: Record<string, number>;
    leadStatusBreakdown: Record<string, number>;
  };
}> {
  const res = await authedFetch(`/campaigns/${encodeURIComponent(id)}`);
  return await res.json();
}

export async function fetchCampaignLeads(
  id: string,
  params: { status?: string; abVariant?: string; limit?: number; offset?: number } = {},
): Promise<{ ok: boolean; items: CampaignLeadRow[]; page?: { total: number; hasMore: boolean } }> {
  const q = new URLSearchParams({ limit: String(params.limit ?? 50), offset: String(params.offset ?? 0) });
  if (params.status) q.set("status", params.status);
  if (params.abVariant) q.set("abVariant", params.abVariant);
  const res = await authedFetch(`/campaigns/${encodeURIComponent(id)}/leads?${q.toString()}`);
  return await res.json();
}

// ── CRM: Deals, Pipeline & Forecast (Increment A) ───────────────────────────
export interface DealRow {
  id: string;
  title: string;
  value: number | null;
  currency: string;
  pipelineId: string;
  stageId: string;
  stageName: string | null;
  contactId: string | null;
  contactName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  status: string;
  expectedCloseAt: string | null;
  closedAt: string | null;
  lostReason: string | null;
  source: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PipelineStage {
  id: string;
  name: string;
  order: number;
  probability: number;
  isWon: boolean;
  isLost: boolean;
}

export interface PipelineRow {
  id: string;
  name: string;
  isDefault: boolean;
  stages: PipelineStage[];
}

export interface ForecastSummary {
  currency: string;
  openCount: number;
  openValue: number;
  weightedForecast: number;
  byStage: Array<{ stageId: string; stageName: string; order: number; count: number; value: number; weighted: number }>;
  byPeriod: { thisMonth: number; thisQuarter: number };
  wonCount: number;
  lostCount: number;
  winRate: number;
}

export async function fetchPipelines(): Promise<{ ok: boolean; items: PipelineRow[] }> {
  return fetchOr("/pipelines", { ok: false, items: [] });
}

export async function fetchDeals(params: { pipelineId?: string } = {}): Promise<{ ok: boolean; items: DealRow[] }> {
  const q = new URLSearchParams({ limit: "500" });
  if (params.pipelineId) q.set("pipelineId", params.pipelineId);
  return fetchOr("/deals?" + q.toString(), { ok: false, items: [] });
}

export async function fetchForecast(pipelineId?: string): Promise<{ ok: boolean; forecast?: ForecastSummary }> {
  const path = "/deals/forecast" + (pipelineId ? "?pipelineId=" + encodeURIComponent(pipelineId) : "");
  return fetchOr(path, { ok: false });
}

// ── CRM: Contacts & Companies (Increment B) ─────────────────────────────────
export interface ContactRow {
  id: string;
  fullName: string;
  phoneE164: string;
  email: string | null;
  visitCount: number;
  companyId: string | null;
  companyName: string | null;
  ownerId: string | null;
  ownerName: string | null;
  lifecycleStage: string;
  leadStatus: string | null;
  leadScore: number | null;
  source: string | null;
  tags: string[];
  notes: string | null;
  dealCount?: number;
  lastActivityAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyRow {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  ownerId: string | null;
  ownerName: string | null;
  tags: string[];
  notes: string | null;
  contactCount?: number;
  dealCount?: number;
  createdAt: string;
  updatedAt: string;
}

export async function fetchContacts(params: { search?: string; lifecycleStage?: string; companyId?: string } = {}): Promise<{ ok: boolean; items: ContactRow[]; page?: { total: number; hasMore: boolean } }> {
  const q = new URLSearchParams({ limit: "200" });
  if (params.search) q.set("search", params.search);
  if (params.lifecycleStage) q.set("lifecycleStage", params.lifecycleStage);
  if (params.companyId) q.set("companyId", params.companyId);
  const res = await authedFetch("/contacts?" + q.toString());
  return (await res.json()) as { ok: boolean; items: ContactRow[]; page?: { total: number; hasMore: boolean } };
}

export async function fetchCompanies(params: { search?: string } = {}): Promise<{ ok: boolean; items: CompanyRow[] }> {
  const q = new URLSearchParams({ limit: "200" });
  if (params.search) q.set("search", params.search);
  const res = await authedFetch("/companies?" + q.toString());
  return (await res.json()) as { ok: boolean; items: CompanyRow[] };
}

// ── CRM: Activities, Tasks & AI Suggestions (Increment C) ───────────────────
export interface TimelineItem {
  id: string;
  kind: string;
  title: string;
  body: string | null;
  direction: string | null;
  sentiment: string | null;
  status: string | null;
  at: string;
  meta?: Record<string, unknown>;
}

export interface TaskRow {
  id: string;
  type: string;
  title: string;
  body: string | null;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  contactId: string | null;
  contactName: string | null;
  userName: string | null;
  createdAt: string;
}

export interface DealSuggestionRow {
  id: string;
  dealId: string;
  dealTitle: string;
  fromStageName: string | null;
  suggestedStageId: string;
  suggestedStageName: string | null;
  reason: string;
  confidence: number | null;
  source: string;
  status: string;
  createdAt: string;
}

export async function fetchTasks(params: { status?: string; mine?: boolean } = {}): Promise<{ ok: boolean; items: TaskRow[] }> {
  const q = new URLSearchParams();
  if (params.status) q.set("status", params.status);
  if (params.mine) q.set("mine", "true");
  const res = await authedFetch("/tasks" + (q.toString() ? "?" + q.toString() : ""));
  return (await res.json()) as { ok: boolean; items: TaskRow[] };
}

export async function fetchDealSuggestions(status = "pending"): Promise<{ ok: boolean; items: DealSuggestionRow[] }> {
  const res = await authedFetch("/deals/suggestions?status=" + encodeURIComponent(status));
  return (await res.json()) as { ok: boolean; items: DealSuggestionRow[] };
}
