import type { LucideIcon } from "lucide-react";
import {
  LayoutDashboard, TrendingUp, Bell, Users, Megaphone, Database,
  Zap, LineChart, Settings, FileText, ShoppingCart, Package,
  Calculator, CalendarDays, Plane, UtensilsCrossed,
  BarChart3, Brain, Warehouse, ClipboardList, UserCheck,
  Building2, Factory, HeartPulse, Globe, ChefHat, Mic, Handshake
} from "lucide-react";

export type Industry = "hospitality" | "manufacturing" | "fnb" | "travel" | "healthcare";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
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
  navItems: NavItem[];
  terminology: IndustryTerminology;
  onboardingQuestions: OnboardingQuestion[];
}

export const INDUSTRY_CONFIGS: Record<Industry, IndustryConfig> = {
  hospitality: {
    id: "hospitality",
    name: "Hospitality",
    tagline: "Hotel & Resort Intelligence",
    description: "Hotels, resorts, boutique properties, serviced apartments",
    overviewIcon: Building2,
    accentColor: "#0f766e",
    features: ["Revenue Intelligence", "Service Request Queue", "Guest Database", "Night Audit AI", "Upsell Automation", "Sentiment Tracking"],
    navItems: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/revenue-intelligence", label: "Revenue Intelligence", icon: TrendingUp },
      { href: "/queue", label: "Service Requests", icon: Bell },
      { href: "/staff-performance", label: "Staff Performance", icon: Users },
      { href: "/upsell-campaigns", label: "Upsell Campaigns", icon: Megaphone },
      { href: "/guest-database", label: "Guest Database", icon: Database },
      { href: "/automations", label: "Automations", icon: Zap },
      { href: "/campaigns", label: "Campaigns", icon: Mic },
      { href: "/deals", label: "Deals", icon: Handshake },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/sentiment-trends", label: "Sentiment Trends", icon: LineChart },
      { href: "/night-audit", label: "Night Audit", icon: FileText },
      { href: "/settings", label: "Settings", icon: Settings }
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
    navItems: [
      { href: "/dashboard", label: "Command Centre", icon: LayoutDashboard },
      { href: "/orders", label: "Live Orders", icon: ClipboardList },
      { href: "/quotes", label: "Quote Builder", icon: Calculator },
      { href: "/materials", label: "Material Yield", icon: Warehouse },
      { href: "/customers", label: "Client Intelligence", icon: UserCheck },
      { href: "/automations", label: "Automations", icon: Zap },
      { href: "/campaigns", label: "Campaigns", icon: Mic },
      { href: "/deals", label: "Deals", icon: Handshake },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/ai-brain", label: "AI Brain", icon: Brain },
      { href: "/settings", label: "Settings", icon: Settings }
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
    navItems: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/orders", label: "Live Orders", icon: ShoppingCart },
      { href: "/menu", label: "Menu & Pricing", icon: UtensilsCrossed },
      { href: "/customers", label: "Customer Loyalty", icon: Users },
      { href: "/inventory", label: "Inventory", icon: Package },
      { href: "/automations", label: "Automations", icon: Zap },
      { href: "/campaigns", label: "Campaigns", icon: Mic },
      { href: "/deals", label: "Deals", icon: Handshake },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/analytics", label: "Revenue Analytics", icon: BarChart3 },
      { href: "/ai-brain", label: "AI Brain", icon: Brain },
      { href: "/settings", label: "Settings", icon: Settings }
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
    navItems: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/bookings", label: "Booking Pipeline", icon: Plane },
      { href: "/customers", label: "Client Database", icon: Users },
      { href: "/automations", label: "Automations", icon: Zap },
      { href: "/campaigns", label: "Campaigns", icon: Mic },
      { href: "/deals", label: "Deals", icon: Handshake },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/analytics", label: "Revenue Analytics", icon: BarChart3 },
      { href: "/ai-brain", label: "AI Brain", icon: Brain },
      { href: "/settings", label: "Settings", icon: Settings }
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
    navItems: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/appointments", label: "Appointments", icon: CalendarDays },
      { href: "/patients", label: "Patient Records", icon: Users },
      { href: "/automations", label: "Automations", icon: Zap },
      { href: "/campaigns", label: "Campaigns", icon: Mic },
      { href: "/deals", label: "Deals", icon: Handshake },
      { href: "/contacts", label: "Contacts", icon: Users },
      { href: "/companies", label: "Companies", icon: Building2 },
      { href: "/tasks", label: "Tasks", icon: ClipboardList },
      { href: "/analytics", label: "Analytics", icon: BarChart3 },
      { href: "/ai-brain", label: "AI Brain", icon: Brain },
      { href: "/settings", label: "Settings", icon: Settings }
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
