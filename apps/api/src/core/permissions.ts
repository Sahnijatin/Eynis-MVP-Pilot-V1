export const PERMISSIONS = {
  INVITE_USERS:        "invite_users",
  MANAGE_USERS:        "manage_users",
  MANAGE_ROLES:        "manage_roles",
  CREATE_CUSTOM_ROLES: "create_custom_roles",
  MANAGE_BILLING:      "manage_billing",
  MANAGE_SETTINGS:     "manage_settings",
  VIEW_REPORTS:        "view_reports",
  MANAGE_REQUESTS:     "manage_requests",
  VIEW_REQUESTS:       "view_requests",
  MANAGE_AUTOMATIONS:  "manage_automations",
  VIEW_GUESTS:         "view_guests",
  MANAGE_GUESTS:       "manage_guests",
  NIGHT_AUDIT:         "night_audit",
  MANAGE_CONNECTORS:   "manage_connectors",
  MANAGE_CAMPAIGNS:    "manage_campaigns",
} as const;

export type Permission = (typeof PERMISSIONS)[keyof typeof PERMISSIONS];

export const ALL_PERMISSIONS = Object.values(PERMISSIONS) as Permission[];

export const DEFAULT_ROLE_PERMISSIONS: Record<string, Permission[]> = {
  admin: [...ALL_PERMISSIONS],
  manager: [
    "invite_users",
    "view_reports",
    "manage_requests",
    "view_requests",
    "manage_automations",
    "view_guests",
    "manage_guests",
    "night_audit",
    "manage_connectors",
    "manage_campaigns",
    "manage_settings",
  ],
  supervisor: [
    "view_reports",
    "manage_requests",
    "view_requests",
    "view_guests",
    "manage_guests",
    "manage_campaigns",
  ],
  agent:  ["view_requests", "manage_requests", "view_guests"],
  viewer: ["view_reports",  "view_requests",   "view_guests"],
};

// Old UserRole → new Role.key (for loading permissions from legacy JWT role)
export const LEGACY_ROLE_TO_KEY: Record<string, string> = {
  owner:        "admin",
  front_desk:   "manager",
  fnb_manager:  "supervisor",
  housekeeping: "agent",
};

// New Role.key → old UserRole string (kept in User.role for JWT backward compat)
export const ROLE_KEY_TO_LEGACY: Record<string, string> = {
  admin:      "owner",
  manager:    "front_desk",
  supervisor: "fnb_manager",
  agent:      "housekeeping",
  viewer:     "housekeeping",
};

export const SYSTEM_ROLE_DISPLAY_NAMES: Record<string, string> = {
  admin:      "Admin",
  manager:    "Manager",
  supervisor: "Supervisor",
  agent:      "Agent",
  viewer:     "Viewer",
};

export const SYSTEM_ROLE_KEYS = [
  "admin",
  "manager",
  "supervisor",
  "agent",
  "viewer",
] as const;

export type SystemRoleKey = (typeof SYSTEM_ROLE_KEYS)[number];
