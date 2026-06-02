export type UserRole = "owner" | "front_desk" | "housekeeping" | "fnb_manager";

// Plan-gated features used by the licensing layer (apps/api/src/core/license.ts).
export type LicenseFeature =
  | "custom_roles"
  | "advanced_analytics"
  | "ai_features"
  | "automations"
  | "night_audit";

export interface Hotel {
  id: string;
  name: string;
  timezone: string;
}

export interface Guest {
  id: string;
  hotelId: string;
  fullName: string;
  phoneE164: string;
  visitCount: number;
}

export interface ServiceRequest {
  id: string;
  hotelId: string;
  guestId: string;
  category: "housekeeping" | "maintenance" | "front_desk" | "concierge" | "fnb" | "other";
  status: "open" | "accepted" | "resolved" | "escalated";
  createdAt: string;
}

export const isValidRole = (role: string): role is UserRole =>
  role === "owner" ||
  role === "front_desk" ||
  role === "housekeeping" ||
  role === "fnb_manager";
