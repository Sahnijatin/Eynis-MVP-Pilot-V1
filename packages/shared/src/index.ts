export type UserRole = "owner" | "front_desk" | "housekeeping" | "fnb_manager";

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
