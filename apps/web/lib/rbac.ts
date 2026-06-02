// Platform-level org roles — separate from the hotel operational roles (owner/front_desk/etc.)

export type OrgRole =
  | "org_admin"
  | "org_manager"
  | "org_supervisor"
  | "org_agent"
  | "org_viewer";

export type Permission =
  | "view_dashboard"
  | "view_analytics"
  | "view_reports"
  | "manage_requests"
  | "manage_inventory"
  | "manage_menu"
  | "manage_clients"
  | "manage_automations"
  | "manage_team"
  | "manage_roles"
  | "manage_billing"
  | "manage_settings"
  | "view_ai_brain";

export const PERMISSION_LABELS: Record<Permission, string> = {
  view_dashboard:    "View Dashboard",
  view_analytics:    "View Analytics",
  view_reports:      "View Reports",
  manage_requests:   "Manage Requests / Orders",
  manage_inventory:  "Manage Inventory",
  manage_menu:       "Manage Menu / Catalog",
  manage_clients:    "Manage Clients / Guests",
  manage_automations:"Manage Automations",
  manage_team:       "Manage Team Members",
  manage_roles:      "Manage Roles & Permissions",
  manage_billing:    "Manage Billing & Plans",
  manage_settings:   "Manage Settings",
  view_ai_brain:     "AI Brain Access",
};

export interface OrgRoleDefinition {
  key: OrgRole;
  defaultDisplayName: string;
  description: string;
  permissions: Permission[];
  isSystemRole: true;
  iconColor: string;
  iconBg: string;
}

export const SYSTEM_ROLES: OrgRoleDefinition[] = [
  {
    key: "org_admin",
    defaultDisplayName: "Admin",
    description: "Full access — manages team, roles, billing, and every feature",
    permissions: [
      "view_dashboard", "view_analytics", "view_reports",
      "manage_requests", "manage_inventory", "manage_menu", "manage_clients",
      "manage_automations", "manage_team", "manage_roles",
      "manage_billing", "manage_settings", "view_ai_brain"
    ],
    isSystemRole: true,
    iconColor: "#dc2626",
    iconBg: "#fee2e2",
  },
  {
    key: "org_manager",
    defaultDisplayName: "Manager",
    description: "Broad operational access — cannot manage roles or billing",
    permissions: [
      "view_dashboard", "view_analytics", "view_reports",
      "manage_requests", "manage_inventory", "manage_menu", "manage_clients",
      "manage_automations", "manage_team", "manage_settings", "view_ai_brain"
    ],
    isSystemRole: true,
    iconColor: "#1d4ed8",
    iconBg: "#dbeafe",
  },
  {
    key: "org_supervisor",
    defaultDisplayName: "Supervisor",
    description: "Team lead — operational tasks, analytics, and client oversight",
    permissions: [
      "view_dashboard", "view_analytics", "view_reports",
      "manage_requests", "manage_inventory", "manage_clients"
    ],
    isSystemRole: true,
    iconColor: "#d97706",
    iconBg: "#fef3c7",
  },
  {
    key: "org_agent",
    defaultDisplayName: "Agent",
    description: "Frontline staff — handles day-to-day requests, inventory, and clients",
    permissions: [
      "view_dashboard",
      "manage_requests", "manage_inventory", "manage_menu", "manage_clients"
    ],
    isSystemRole: true,
    iconColor: "#059669",
    iconBg: "#d1fae5",
  },
  {
    key: "org_viewer",
    defaultDisplayName: "Viewer",
    description: "Read-only — can view dashboard and analytics, no data entry",
    permissions: [
      "view_dashboard", "view_analytics", "view_reports"
    ],
    isSystemRole: true,
    iconColor: "#64748b",
    iconBg: "#f1f5f9",
  },
];

// Route → required permission. First match wins.
export const ROUTE_PERMISSIONS: Array<{ pattern: string; permission: Permission }> = [
  { pattern: "/settings",            permission: "manage_settings" },
  { pattern: "/automations",         permission: "manage_automations" },
  { pattern: "/analytics",           permission: "view_analytics" },
  { pattern: "/revenue-intelligence",permission: "view_analytics" },
  { pattern: "/sentiment-trends",    permission: "view_analytics" },
  { pattern: "/upsell-campaigns",    permission: "view_analytics" },
  { pattern: "/staff-performance",   permission: "view_reports" },
  { pattern: "/night-audit",         permission: "view_reports" },
  { pattern: "/ai-brain",            permission: "view_ai_brain" },
  { pattern: "/menu",                permission: "manage_menu" },
  { pattern: "/inventory",           permission: "manage_inventory" },
  { pattern: "/materials",           permission: "manage_inventory" },
  { pattern: "/customers",           permission: "manage_clients" },
  { pattern: "/guest-database",      permission: "manage_clients" },
  { pattern: "/patients",            permission: "manage_clients" },
  { pattern: "/quotes",              permission: "manage_requests" },
  { pattern: "/orders",              permission: "manage_requests" },
  { pattern: "/queue",               permission: "manage_requests" },
  { pattern: "/bookings",            permission: "manage_requests" },
  { pattern: "/appointments",        permission: "manage_requests" },
];

export function getRoleDefinition(key: OrgRole): OrgRoleDefinition {
  return SYSTEM_ROLES.find(r => r.key === key)!;
}

export function hasPermission(role: OrgRole, permission: Permission): boolean {
  return getRoleDefinition(role)?.permissions.includes(permission) ?? false;
}

export function canAccessRoute(role: OrgRole, pathname: string): boolean {
  for (const { pattern, permission } of ROUTE_PERMISSIONS) {
    if (pathname === pattern || pathname.startsWith(pattern + "/")) {
      return hasPermission(role, permission);
    }
  }
  return true; // No restriction = accessible to all roles
}

export function getAllowedNavItems<T extends { href: string }>(
  items: T[],
  role: OrgRole
): T[] {
  return items.filter(item => canAccessRoute(role, item.href));
}

export const ORG_ROLE_LABELS: Record<OrgRole, string> = {
  org_admin:      "Admin",
  org_manager:    "Manager",
  org_supervisor: "Supervisor",
  org_agent:      "Agent",
  org_viewer:     "Viewer",
};
