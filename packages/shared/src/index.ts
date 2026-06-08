/**
 * @deprecated Hospitality-specific legacy roles. New code should use the generic
 * {@link SystemRoleKey} (admin/manager/supervisor/agent/viewer) with the
 * permission-based RBAC. This union is retained only as a backward-compat alias
 * for existing JWTs and the `User.role` column during the role migration
 * (see docs/industry-agnostic-and-white-label-plan.md, Plan A3).
 */
export type UserRole = "owner" | "front_desk" | "housekeeping" | "fnb_manager";

/** Generic, industry-agnostic role keys — the canonical role vocabulary. */
export type SystemRoleKey = "admin" | "manager" | "supervisor" | "agent" | "viewer";

export const isSystemRoleKey = (key: string): key is SystemRoleKey =>
  key === "admin" || key === "manager" || key === "supervisor" || key === "agent" || key === "viewer";

// Plan-gated features used by the licensing layer (apps/api/src/core/license.ts).
export type LicenseFeature =
  | "custom_roles"
  | "advanced_analytics"
  | "ai_features"
  | "automations"
  | "night_audit"
  | "research_studio";

/** The tenant / organization — the billable, isolated account. */
export interface Tenant {
  id: string;
  name: string;
  timezone: string;
}

/** @deprecated Hospitality name for {@link Tenant}; retained as an alias during the rename. */
export type Hotel = Tenant;

/** The end-customer a tenant engages (industry-neutral name for the Guest entity). */
export interface Contact {
  id: string;
  tenantId: string;
  fullName: string;
  phoneE164: string;
  visitCount: number;
}

/** @deprecated Hospitality name for {@link Contact}; retained as an alias during the rename. */
export type Guest = Contact;

export interface ServiceRequest {
  id: string;
  tenantId: string;
  guestId: string;
  category: "housekeeping" | "maintenance" | "front_desk" | "concierge" | "fnb" | "other";
  status: "open" | "accepted" | "resolved" | "escalated";
  createdAt: string;
}

/** @deprecated Validates the legacy hospitality role union; prefer {@link isSystemRoleKey}. */
export const isValidRole = (role: string): role is UserRole =>
  role === "owner" ||
  role === "front_desk" ||
  role === "housekeeping" ||
  role === "fnb_manager";

// ── Voice Campaign compliance (Phase 1 foundation) ──────────────────────────
// These types encode the regulatory rules the voice-agent module must satisfy.
// They are deliberately schema-agnostic: Phase 2 wires the consent fields onto
// the CampaignLead model and the opted_out outcome into the call pipeline.

// How / where a lead's consent to be contacted was captured.
export type ConsentSource = "csv_import" | "web_form" | "api" | "verbal" | "double_opt_in";

// Reserved consent fields — added to the CampaignLead model in Phase 2.
export interface LeadConsent {
  consent: boolean;
  consentSource: ConsentSource | null;
  consentAt: string | null; // ISO-8601 timestamp, null until consent recorded
}

// The opt-out outcome is reserved across every campaign regardless of the
// tenant's custom outcome taxonomy. It is enforced tenant-wide and suppresses
// all follow-up (voice, WhatsApp, email).
export const RESERVED_OUTCOME_OPTED_OUT = "opted_out";

// Regulations the compliance layer is designed to satisfy.
export type ComplianceRegulation = "TCPA" | "GDPR" | "TRAI" | "CASL" | "PDPA";

export const isValidConsentSource = (source: string): source is ConsentSource =>
  source === "csv_import" ||
  source === "web_form" ||
  source === "api" ||
  source === "verbal" ||
  source === "double_opt_in";

// ── Connector catalog ──────────────────────────────────────────────────────────
// Single source of truth for the Integrations module (apps/web) and the runtime
// connector registry (apps/api). The static catalog (names, descriptions, what a
// connector needs) lives here so the Integrations page can render its tiles even
// when the per-tenant status call is unavailable; the API overlays env flags and
// per-tenant config/status at request time.

export type ConnectorCategory = "communication" | "email" | "voice" | "pms" | "pos" | "payments" | "search";

export interface ConnectorField {
  key: string;
  label: string;
  secret?: boolean;
  placeholder?: string;
}

export interface ConnectorCatalogItem {
  key: string;
  category: ConnectorCategory;
  name: string;
  description: string;
  icon: string;
  brandColor: string;
  planned: boolean;
  requiredFields: ConnectorField[];
  ingestModes: string[];
}

export const CONNECTOR_CATEGORY_LABELS: Record<ConnectorCategory, string> = {
  communication: "Communication",
  email: "Email",
  voice: "Voice",
  pms: "PMS",
  pos: "POS",
  payments: "Payments",
  search: "Search",
};

// The env flag that gates a connector's default availability, derived from its key
// (e.g. whatsapp_twilio → CONNECTOR_WHATSAPP_TWILIO_ENABLED).
export const connectorEnvFlag = (key: string): string => `CONNECTOR_${key.toUpperCase()}_ENABLED`;

export const CONNECTOR_CATALOG: ConnectorCatalogItem[] = [
  {
    key: "whatsapp_interakt", category: "communication", name: "WhatsApp · Interakt",
    description: "Receive and reply to customer messages on WhatsApp via Interakt.",
    icon: "💬", brandColor: "#25D366", planned: false, ingestModes: ["webhook", "outbound_api"],
    requiredFields: [{ key: "apiKey", label: "Interakt API Key", secret: true, placeholder: "your_interakt_api_key" }],
  },
  {
    key: "whatsapp_twilio", category: "communication", name: "WhatsApp · Twilio",
    description: "Two-way WhatsApp messaging through your Twilio account.",
    icon: "💬", brandColor: "#F22F46", planned: false, ingestModes: ["webhook", "outbound_api"],
    requiredFields: [
      { key: "accountSid", label: "Account SID", placeholder: "ACxxxxxxxx" },
      { key: "authToken", label: "Auth Token", secret: true, placeholder: "your_auth_token" },
      { key: "fromNumber", label: "WhatsApp From Number", placeholder: "whatsapp:+14155238886" },
    ],
  },
  {
    key: "pms_hotelogix", category: "pms", name: "Hotelogix PMS",
    description: "Sync reservations and guest profiles from Hotelogix.",
    icon: "🏨", brandColor: "#2563eb", planned: true, ingestModes: ["api", "webhook"],
    requiredFields: [{ key: "apiKey", label: "API Key", secret: true }, { key: "propertyId", label: "Property ID" }],
  },
  {
    key: "pms_ezee", category: "pms", name: "eZee PMS",
    description: "Sync reservations and guest profiles from eZee.",
    icon: "🏨", brandColor: "#2563eb", planned: true, ingestModes: ["api"],
    requiredFields: [{ key: "apiKey", label: "API Key", secret: true }, { key: "hotelCode", label: "Hotel Code" }],
  },
  {
    key: "pos_petpooja", category: "pos", name: "Petpooja POS",
    description: "Pull orders and menu data from Petpooja.",
    icon: "🍽️", brandColor: "#ea580c", planned: true, ingestModes: ["api"],
    requiredFields: [{ key: "apiKey", label: "API Key", secret: true }, { key: "restaurantId", label: "Restaurant ID" }],
  },
  {
    key: "payments_razorpay", category: "payments", name: "Razorpay",
    description: "Collect payments and send payment links via Razorpay.",
    icon: "💳", brandColor: "#0f766e", planned: true, ingestModes: ["api", "payment_link"],
    requiredFields: [{ key: "keyId", label: "Key ID" }, { key: "keySecret", label: "Key Secret", secret: true }],
  },
  {
    key: "voice_vapi", category: "voice", name: "Voice Agent · Vapi",
    description: "AI voice calls for outreach and reminders via Vapi.",
    icon: "📞", brandColor: "#7c3aed", planned: false, ingestModes: ["api", "webhook"],
    requiredFields: [{ key: "apiKey", label: "Vapi API Key", secret: true }, { key: "assistantId", label: "Assistant ID" }],
  },
  {
    key: "email_resend", category: "email", name: "Email · Resend",
    description: "Send transactional and campaign email from your own domain via Resend.",
    icon: "✉️", brandColor: "#0891b2", planned: false, ingestModes: ["outbound_api"],
    requiredFields: [
      { key: "apiKey", label: "Resend API Key", secret: true, placeholder: "re_xxxxxxxx" },
      { key: "fromAddress", label: "From Address", placeholder: "campaigns@yourdomain.com" },
      { key: "fromName", label: "From Name", placeholder: "Your Brand" },
    ],
  },
  {
    key: "search_tavily", category: "search", name: "Web Search · Tavily",
    description: "Hosted web search for Research Studio. Optional — works alongside (or instead of) the self-hosted SearXNG default.",
    icon: "🔎", brandColor: "#6366f1", planned: false, ingestModes: ["api"],
    requiredFields: [{ key: "apiKey", label: "Tavily API Key", secret: true, placeholder: "tvly-xxxxxxxx" }],
  },
];
