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
  | "night_audit";

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
