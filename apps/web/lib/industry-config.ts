import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, TrendingUp, Bell, Users, Megaphone,
  Zap, LineChart, Settings, FileText, ShoppingCart, Package,
  Calculator, CalendarDays, Plane, UtensilsCrossed,
  BarChart3, Brain, Warehouse, ClipboardList,
  Building2, Factory, HeartPulse, Globe, ChefHat, Mic, Handshake,
  Workflow, Plug, UserCheck
} from "lucide-react";

export type Industry = "hospitality" | "manufacturing" | "fnb" | "travel" | "healthcare";

// A single navigable destination. `description` is shown on a module's landing
// screen (E-2) and is ignored in the sidebar.
export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  description?: string;
}

// A top-level sidebar module (E-2). Modules with `children` are expandable and
// open a landing/overview screen at `href`; leaf modules link straight to `href`.
// `key` is a stable identifier (never industry-specific) used for landing lookup
// and active-state matching.
export interface NavModule {
  key: string;
  label: string;
  icon: LucideIcon;
  href: string;
  description?: string;
  children?: NavItem[];
}

export interface IndustryTerminology {
  entity: string;
  entityPlural: string;
  request: string;
  requestPlural: string;
  property: string;
  team: string;
}

export interface OnboardingQuestion {
  id: string;
  question: string;
  options: string[];
}

export interface IndustryConfig {
  id: Industry;
  name: string;
  tagline: string;
  description: string;
  overviewIcon: LucideIcon;
  accentColor: string;
  features: string[];
  modules: NavModule[];
  terminology: IndustryTerminology;
  onboardingQuestions: OnboardingQuestion[];
}

// ── Shared modules ────────────────────────────────────────────────────────────
// CRM, Marketing, Integrations and Settings are identical across every industry,
// so they're defined once and reused. Operations and Analytics differ per vertical
// (different request/revenue routes) and are built inline below.

const DASHBOARD_MODULE: NavModule = {
  key: "dashboard", label: "Dashboard", icon: LayoutDashboard, href: "/dashboard",
  description: "Smart Insights and your daily operating picture."
};

// CRM groups every customer-record surface. The first child is the vertical's
// primary entity database (guests / clients / patients …); the rest are shared.
function crmModule(records: { href: string; label: string; description: string }): NavModule {
  return {
    key: "crm", label: "CRM", icon: Handshake, href: "/crm",
    description: "Everyone you do business with — records, contacts, companies, deals and follow-ups in one place.",
    children: [
      { href: records.href, label: records.label, icon: UserCheck, description: records.description },
      { href: "/contacts", label: "Contacts", icon: Users, description: "People you do business with." },
      { href: "/companies", label: "Companies", icon: Building2, description: "Organizations and accounts." },
      { href: "/deals", label: "Deals", icon: Handshake, description: "Your pipeline and open opportunities." },
      { href: "/tasks", label: "Tasks", icon: ClipboardList, description: "Follow-ups and to-dos." }
    ]
  };
}

const MARKETING_MODULE: NavModule = {
  key: "marketing", label: "Marketing", icon: Megaphone, href: "/marketing",
  description: "Reach and re-engage your audience — campaigns, automations, sequences and templates.",
  children: [
    { href: "/campaigns", label: "Campaigns", icon: Mic, description: "Outbound campaigns, including upsell and re-engagement offers." },
    { href: "/automations", label: "Automations", icon: Zap, description: "Rules that run your operations around the clock." },
    { href: "/sequences", label: "Sequences", icon: Workflow, description: "Multi-step drip journeys." },
    { href: "/templates", label: "Templates", icon: FileText, description: "Reusable message templates." }
  ]
};

const INTEGRATIONS_MODULE: NavModule = {
  key: "integrations", label: "Integrations", icon: Plug, href: "/integrations",
  description: "Connect WhatsApp, your PMS/POS, payments and other tools."
};

const SETTINGS_MODULE: NavModule = {
  key: "settings", label: "Settings", icon: Settings, href: "/settings",
  description: "Workspace, team, roles, branding and billing."
};

// The Reports sub-item is shared, but its destination differs per vertical so it
// is added inside each Analytics module below.
const REPORTS_ITEM: NavItem = {
  href: "/reports", label: "Reports", icon: FileText,
  description: "Generated operational reports and exports."
};

// Sentiment Trends is shared across every industry (E-14): any vertical has
// customer/contact sentiment from calls and inbound messages. Industry-neutral
// copy — no "guest" — so it reads correctly for plants, outlets, clinics, etc.
const SENTIMENT_ITEM: NavItem = {
  href: "/sentiment-trends", label: "Sentiment Trends", icon: LineChart,
  description: "Customer sentiment over time, from calls and messages."
};

export const INDUSTRY_CONFIGS: Record<Industry, IndustryConfig> = {
  hospitality: {
    id: "hospitality",
    name: "Hospitality",
    tagline: "Hotel & Resort Intelligence",
    description: "Hotels, resorts, boutique properties, serviced apartments",
    overviewIcon: Building2,
    accentColor: "#0f766e",
    features: ["Revenue Intelligence", "Service Request Queue", "Guest Database", "Night Audit AI", "Upsell Automation", "Sentiment Tracking"],
    modules: [
      DASHBOARD_MODULE,
      { key: "operations", label: "Service Requests", icon: Bell, href: "/queue", description: "The live request queue and operational feed." },
      crmModule({ href: "/guest-database", label: "Guest Database", description: "Your full guest records and history." }),
      MARKETING_MODULE,
      {
        key: "analytics", label: "Analytics", icon: BarChart3, href: "/analytics",
        description: "Revenue, sentiment, team performance and reports.",
        children: [
          { href: "/revenue-intelligence", label: "Revenue Intelligence", icon: TrendingUp, description: "Occupancy, ADR/RevPAR and revenue opportunities." },
          SENTIMENT_ITEM,
          { href: "/staff-performance", label: "Staff Performance", icon: Users, description: "Team responsiveness and resolution metrics." },
          REPORTS_ITEM
        ]
      },
      INTEGRATIONS_MODULE,
      SETTINGS_MODULE
    ],
    terminology: {
      entity: "Guest", entityPlural: "Guests",
      request: "Service Request", requestPlural: "Service Requests",
      property: "Hotel", team: "Staff"
    },
    onboardingQuestions: [
      { id: "size", question: "How many rooms does your property have?", options: ["Under 20", "20–50", "51–150", "150+"] },
      { id: "pms", question: "Which PMS are you using?", options: ["Hotelogix", "eZee", "Opera", "None / Other"] }
    ]
  },

  manufacturing: {
    id: "manufacturing",
    name: "Manufacturing",
    tagline: "Production Intelligence Platform",
    description: "Furniture, industrial goods, custom fabrication, product manufacturing",
    overviewIcon: Factory,
    accentColor: "#1d4ed8",
    features: ["Live Order Command Centre", "Quote & Margin Engine", "Material Yield Tracker", "Client Intelligence", "Vendor Slip Alerts", "AI Brain"],
    modules: [
      { ...DASHBOARD_MODULE, label: "Command Centre" },
      {
        key: "operations", label: "Operations", icon: ClipboardList, href: "/orders",
        description: "Live orders, quotes and material yield.",
        children: [
          { href: "/orders", label: "Live Orders", icon: ClipboardList, description: "Orders in production and their status." },
          { href: "/quotes", label: "Quote Builder", icon: Calculator, description: "Build and track quotes and margins." },
          { href: "/materials", label: "Material Yield", icon: Warehouse, description: "Stock, BOM variance and reorder alerts." }
        ]
      },
      crmModule({ href: "/customers", label: "Client Intelligence", description: "Your full client records and history." }),
      MARKETING_MODULE,
      {
        key: "analytics", label: "Analytics", icon: BarChart3, href: "/analytics",
        description: "Revenue analytics, AI Brain and reports.",
        children: [
          { href: "/analytics/revenue", label: "Revenue Analytics", icon: TrendingUp, description: "Revenue, margin and trend analysis." },
          { href: "/ai-brain", label: "AI Brain", icon: Brain, description: "Conversational intelligence over your operation." },
          SENTIMENT_ITEM,
          REPORTS_ITEM
        ]
      },
      INTEGRATIONS_MODULE,
      SETTINGS_MODULE
    ],
    terminology: {
      entity: "Client", entityPlural: "Clients",
      request: "Order", requestPlural: "Orders",
      property: "Plant", team: "Workforce"
    },
    onboardingQuestions: [
      { id: "product", question: "What do you manufacture?", options: ["Furniture", "Industrial Equipment", "Consumer Goods", "Custom Fabrication"] },
      { id: "volume", question: "Monthly order volume?", options: ["Under 50", "50–200", "200–500", "500+"] }
    ]
  },

  fnb: {
    id: "fnb",
    name: "Food & Beverage",
    tagline: "Restaurant & Outlet Intelligence",
    description: "Restaurants, cafes, cloud kitchens, food chains",
    overviewIcon: ChefHat,
    accentColor: "#ea580c",
    features: ["Live Order Tracking", "Menu & Margin Analytics", "Customer Loyalty", "Inventory Alerts", "Revenue Analytics", "AI Suggestions"],
    modules: [
      DASHBOARD_MODULE,
      {
        key: "operations", label: "Operations", icon: ShoppingCart, href: "/orders",
        description: "Live orders, menu and inventory.",
        children: [
          { href: "/orders", label: "Live Orders", icon: ShoppingCart, description: "Orders in progress across outlets." },
          { href: "/menu", label: "Menu & Pricing", icon: UtensilsCrossed, description: "Menu items, pricing and margins." },
          { href: "/inventory", label: "Inventory", icon: Package, description: "Stock levels and reorder alerts." }
        ]
      },
      crmModule({ href: "/customers", label: "Customer Loyalty", description: "Your full diner records and loyalty." }),
      MARKETING_MODULE,
      {
        key: "analytics", label: "Analytics", icon: BarChart3, href: "/analytics",
        description: "Revenue analytics, AI Brain and reports.",
        children: [
          { href: "/analytics/revenue", label: "Revenue Analytics", icon: TrendingUp, description: "Sales, margin and trend analysis." },
          { href: "/ai-brain", label: "AI Brain", icon: Brain, description: "Conversational intelligence over your outlets." },
          SENTIMENT_ITEM,
          REPORTS_ITEM
        ]
      },
      INTEGRATIONS_MODULE,
      SETTINGS_MODULE
    ],
    terminology: {
      entity: "Diner", entityPlural: "Diners",
      request: "Order", requestPlural: "Orders",
      property: "Outlet", team: "Team"
    },
    onboardingQuestions: [
      { id: "type", question: "Type of F&B business?", options: ["Fine Dining", "Casual Restaurant", "Cloud Kitchen", "Cafe / QSR"] },
      { id: "outlets", question: "Number of outlets?", options: ["1", "2–5", "6–20", "20+"] }
    ]
  },

  travel: {
    id: "travel",
    name: "Travel",
    tagline: "Travel Agency & Tour Intelligence",
    description: "Travel agencies, tour operators, DMCs, corporate travel",
    overviewIcon: Globe,
    accentColor: "#7c3aed",
    features: ["Booking Pipeline", "Client Database", "Visa & Document Tracker", "Revenue Analytics", "Departure Alerts", "AI Brain"],
    modules: [
      DASHBOARD_MODULE,
      { key: "operations", label: "Bookings", icon: Plane, href: "/bookings", description: "Your booking pipeline and departures." },
      crmModule({ href: "/customers", label: "Client Database", description: "Your full traveller records and history." }),
      MARKETING_MODULE,
      {
        key: "analytics", label: "Analytics", icon: BarChart3, href: "/analytics",
        description: "Revenue analytics, AI Brain and reports.",
        children: [
          { href: "/analytics/revenue", label: "Revenue Analytics", icon: TrendingUp, description: "Bookings revenue and trend analysis." },
          { href: "/ai-brain", label: "AI Brain", icon: Brain, description: "Conversational intelligence over your bookings." },
          SENTIMENT_ITEM,
          REPORTS_ITEM
        ]
      },
      INTEGRATIONS_MODULE,
      SETTINGS_MODULE
    ],
    terminology: {
      entity: "Traveller", entityPlural: "Travellers",
      request: "Booking", requestPlural: "Bookings",
      property: "Agency", team: "Team"
    },
    onboardingQuestions: [
      { id: "type", question: "Type of travel business?", options: ["Tour Operator", "Travel Agency", "DMC", "Corporate Travel"] },
      { id: "volume", question: "Monthly booking volume?", options: ["Under 20", "20–100", "100–500", "500+"] }
    ]
  },

  healthcare: {
    id: "healthcare",
    name: "Healthcare",
    tagline: "Clinic & Practice Intelligence",
    description: "Clinics, hospitals, diagnostic centers, healthcare practices",
    overviewIcon: HeartPulse,
    accentColor: "#0891b2",
    features: ["Appointment Scheduling", "Patient Records", "Follow-up Automation", "No-show Tracking", "Revenue Analytics", "AI Brain"],
    modules: [
      DASHBOARD_MODULE,
      { key: "operations", label: "Appointments", icon: CalendarDays, href: "/appointments", description: "Today's schedule and patient flow." },
      crmModule({ href: "/patients", label: "Patient Records", description: "Your full patient records and history." }),
      MARKETING_MODULE,
      {
        key: "analytics", label: "Analytics", icon: BarChart3, href: "/analytics",
        description: "Revenue analytics, AI Brain and reports.",
        children: [
          { href: "/analytics/revenue", label: "Revenue Analytics", icon: TrendingUp, description: "Practice revenue and trend analysis." },
          { href: "/ai-brain", label: "AI Brain", icon: Brain, description: "Conversational intelligence over your practice." },
          SENTIMENT_ITEM,
          REPORTS_ITEM
        ]
      },
      INTEGRATIONS_MODULE,
      SETTINGS_MODULE
    ],
    terminology: {
      entity: "Patient", entityPlural: "Patients",
      request: "Appointment", requestPlural: "Appointments",
      property: "Clinic", team: "Clinical Team"
    },
    onboardingQuestions: [
      { id: "type", question: "Type of practice?", options: ["General Practice", "Specialty Clinic", "Diagnostic Center", "Hospital"] },
      { id: "load", question: "Daily patient load?", options: ["Under 20", "20–50", "50–100", "100+"] }
    ]
  }
};

export function getIndustryConfig(industry: string | null | undefined): IndustryConfig {
  if (industry && industry in INDUSTRY_CONFIGS) {
    return INDUSTRY_CONFIGS[industry as Industry];
  }
  return INDUSTRY_CONFIGS.hospitality;
}

// Look up a module by its stable key (used by the landing screens).
export function getModule(config: IndustryConfig, key: string): NavModule | undefined {
  return config.modules.find((m) => m.key === key);
}

// Flatten the module tree to its leaf destinations — used where a flat list of
// pages is wanted (e.g. the onboarding "modules included" preview). A leaf module
// (no children) contributes itself; a parent contributes its children.
export function flattenModuleLinks(modules: NavModule[]): NavItem[] {
  return modules.flatMap((m) =>
    m.children && m.children.length > 0
      ? m.children
      : [{ href: m.href, label: m.label, icon: m.icon, description: m.description }]
  );
}
