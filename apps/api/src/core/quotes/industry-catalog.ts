// Industry template catalog — one source of truth for the "starter kit" that every
// new workspace is provisioned with, across all three quoting workstreams:
//   1. Quoting + costing:   starter materials (InventoryItem) + preset QuoteTemplates.
//   2. Follow-up + chatbot:  a follow-up Sequence, its MessageTemplates, and the
//                            two-way WhatsApp sales-agent prompt.
//   3. (Busy export needs no per-industry seed — it renders whatever quote exists.)
//
// This module is PURE DATA + types (no Prisma, no I/O) so it is trivially testable and
// reusable. `seedIndustryDefaults` (core/quotes/provision.ts) reads it to write rows.
//
// Design notes:
// - The costing engine (core/quotes/costing.ts) already supports non-dimensional cost
//   bases (`fixed`, `hours`), so service verticals (healthcare, travel, F&B) price by
//   headcount/visits/nights with NO engine change — furniture keeps `area`/`length`.
// - Rates are authored in whole rupees for readability; the seeder converts to paise.
// - Copy strings may contain two kinds of placeholder:
//     {company}          → replaced at seed time with the real workspace name.
//     {lead.firstName}   → left intact; resolved at send time by the sequence runner.

export type Industry = "hospitality" | "manufacturing" | "fnb" | "travel" | "healthcare";

export const INDUSTRIES: Industry[] = ["hospitality", "manufacturing", "fnb", "travel", "healthcare"];

export type CostBasis = "area" | "length" | "perimeter" | "volume" | "fixed" | "hours";
export type ComponentKind = "material" | "labor" | "hardware" | "finish" | "other";

// A starter inventory row. `unit` is the display unit (sqft/rft/unit/night/plate/…).
export interface CatalogMaterial {
  name: string;
  category: string;
  unit: string;
  rateInr: number; // ₹ per unit
}

// A default component of a template. Links to a CatalogMaterial by `material` for
// provenance + rate; if unlinked, `rateInr` supplies the rate inline so the template
// still prices on a workspace with an empty inventory.
export interface CatalogComponent {
  name: string;
  kind?: ComponentKind;
  costBasis: CostBasis;
  material?: string; // name of a CatalogMaterial in the same industry (provenance + rate)
  materialUnit?: string; // display unit override; defaults to the linked material's unit
  rateInr?: number; // inline ₹/unit when there is no material link
  lengthMm?: number;
  widthMm?: number;
  heightMm?: number;
  quantity?: number;
  wastagePct?: number;
  laborHours?: number;
}

export interface CatalogTemplate {
  name: string;
  category: string;
  description: string; // company name is prepended at seed time
  overheadPct: number;
  marginPct: number;
  marginFloorPct: number;
  laborRateInr: number; // ₹/hour
  components: CatalogComponent[];
}

export interface CatalogMessageTemplate {
  key: string; // stable suffix, referenced by sequence steps
  name: string;
  channel: "whatsapp" | "email";
  category: string; // marketing | utility
  subject?: string; // email only
  body: string;
}

export interface CatalogSequenceStep {
  order: number;
  waitDays: number;
  channel: "whatsapp" | "email";
  templateKey: string; // references a CatalogMessageTemplate.key
}

export interface IndustryCatalog {
  // The customer-facing noun for a quote in this vertical (used for nav + copy).
  quoteNoun: string; // "quote" | "estimate" | "proposal"
  materials: CatalogMaterial[];
  templates: CatalogTemplate[];
  messageTemplates: CatalogMessageTemplate[];
  sequence: { name: string; steps: CatalogSequenceStep[] };
  agent: { name: string; prompt: string };
}

// A standard 3-touch follow-up: WhatsApp now → email nudge in 2 days → WhatsApp
// check-in in 5 days. Auto-stops the moment the customer replies (exitOn is set by the
// seeder). Every industry reuses this cadence with vertical-worded templates.
function standardSequence(name: string): { name: string; steps: CatalogSequenceStep[] } {
  return {
    name,
    steps: [
      { order: 0, waitDays: 0, channel: "whatsapp", templateKey: "wa_sent" },
      { order: 1, waitDays: 2, channel: "email", templateKey: "em_nudge" },
      { order: 2, waitDays: 5, channel: "whatsapp", templateKey: "wa_checkin" },
    ],
  };
}

export const INDUSTRY_CATALOG: Record<Industry, IndustryCatalog> = {
  // ── Manufacturing (furniture) ─────────────────────────────────────────────────
  // Dimension-driven bill-of-materials costing — the original Tempus set.
  manufacturing: {
    quoteNoun: "quote",
    materials: [
      { name: "Sheesham Wood", category: "Wood", unit: "sqft", rateInr: 320 },
      { name: "Teak Wood", category: "Wood", unit: "sqft", rateInr: 480 },
      { name: "Plywood 18mm", category: "Board", unit: "sqft", rateInr: 95 },
      { name: "Laminate Sheet", category: "Board", unit: "sqft", rateInr: 65 },
      { name: "MDF 18mm", category: "Board", unit: "sqft", rateInr: 55 },
      { name: "Steel Leg (powder-coated)", category: "Hardware", unit: "unit", rateInr: 380 },
      { name: "Brass Handle", category: "Hardware", unit: "unit", rateInr: 120 },
      { name: "Soft-close Hinge", category: "Hardware", unit: "unit", rateInr: 90 },
      { name: "PU Finish", category: "Finish", unit: "sqft", rateInr: 40 },
    ],
    templates: [
      {
        name: "Dining Table", category: "Furniture",
        description: "Solid-wood top with legs and apron",
        overheadPct: 15, marginPct: 45, marginFloorPct: 30, laborRateInr: 150,
        components: [
          { name: "Table top", material: "Sheesham Wood", costBasis: "area", materialUnit: "sqft", lengthMm: 1800, widthMm: 900, wastagePct: 10, laborHours: 3 },
          { name: "Legs", material: "Steel Leg (powder-coated)", kind: "hardware", costBasis: "fixed", materialUnit: "unit", quantity: 4, laborHours: 1 },
          { name: "Apron", material: "Plywood 18mm", costBasis: "length", materialUnit: "rft", lengthMm: 5000, wastagePct: 5, laborHours: 1 },
          { name: "Handles / hardware", material: "Brass Handle", kind: "hardware", costBasis: "fixed", materialUnit: "unit", quantity: 0 },
          { name: "PU finish", material: "PU Finish", kind: "finish", costBasis: "area", materialUnit: "sqft", lengthMm: 1800, widthMm: 900, laborHours: 1 },
        ],
      },
      {
        name: "Office Desk", category: "Furniture",
        description: "Laminate desk with steel legs and drawer unit",
        overheadPct: 15, marginPct: 40, marginFloorPct: 28, laborRateInr: 150,
        components: [
          { name: "Desk top", material: "Plywood 18mm", costBasis: "area", materialUnit: "sqft", lengthMm: 1500, widthMm: 750, wastagePct: 8, laborHours: 2 },
          { name: "Laminate", material: "Laminate Sheet", kind: "finish", costBasis: "area", materialUnit: "sqft", lengthMm: 1500, widthMm: 750, wastagePct: 8, laborHours: 1 },
          { name: "Legs", material: "Steel Leg (powder-coated)", kind: "hardware", costBasis: "fixed", materialUnit: "unit", quantity: 4 },
          { name: "Soft-close hinges", material: "Soft-close Hinge", kind: "hardware", costBasis: "fixed", materialUnit: "unit", quantity: 4 },
        ],
      },
      {
        name: "Wardrobe (2-door)", category: "Furniture",
        description: "MDF carcass with laminate finish and soft-close doors",
        overheadPct: 18, marginPct: 42, marginFloorPct: 30, laborRateInr: 160,
        components: [
          { name: "Carcass", material: "MDF 18mm", costBasis: "area", materialUnit: "sqft", lengthMm: 2100, widthMm: 1200, wastagePct: 10, laborHours: 5 },
          { name: "Doors", material: "MDF 18mm", costBasis: "area", materialUnit: "sqft", lengthMm: 2100, widthMm: 600, quantity: 2, wastagePct: 8, laborHours: 3 },
          { name: "Laminate", material: "Laminate Sheet", kind: "finish", costBasis: "area", materialUnit: "sqft", lengthMm: 2100, widthMm: 1200, wastagePct: 8 },
          { name: "Handles", material: "Brass Handle", kind: "hardware", costBasis: "fixed", materialUnit: "unit", quantity: 2 },
          { name: "Hinges", material: "Soft-close Hinge", kind: "hardware", costBasis: "fixed", materialUnit: "unit", quantity: 6 },
        ],
      },
    ],
    messageTemplates: [
      { key: "wa_sent", name: "Quote sent (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, thanks for your interest in {company}! Your quote is ready. Reply here with any questions and we'll be happy to help." },
      { key: "em_nudge", name: "Quote nudge (Email)", channel: "email", category: "marketing",
        subject: "Your {company} quote", body: "<p>Hi {lead.firstName},</p><p>Just checking in on the quote we sent. Happy to adjust materials, finish, or dimensions — reply and we'll revise it.</p><p>— Team {company}</p>" },
      { key: "wa_checkin", name: "Quote check-in (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, following up on your {company} quote. Would you like to go ahead, or shall we tweak anything?" },
    ],
    sequence: standardSequence("Quote follow-up"),
    agent: {
      name: "Inbound Sales (WhatsApp Agent)",
      prompt: "You are {company}'s friendly furniture sales assistant. Answer questions about custom furniture (tables, desks, wardrobes), materials (sheesham, teak, plywood, MDF), finishes, timelines and rough pricing. Ask for the piece, dimensions and material to prepare a quote. Offer to have a human follow up with a formal quote. Be concise and warm.",
    },
  },

  // ── Healthcare (clinic / dental) ──────────────────────────────────────────────
  // Service costing: procedures priced by fixed consumables + clinician hours.
  healthcare: {
    quoteNoun: "estimate",
    materials: [
      { name: "Titanium Implant Fixture", category: "Consumable", unit: "unit", rateInr: 18000 },
      { name: "Zirconia Crown", category: "Consumable", unit: "unit", rateInr: 8000 },
      { name: "Composite Filling Material", category: "Consumable", unit: "unit", rateInr: 600 },
      { name: "Root Canal Kit", category: "Consumable", unit: "unit", rateInr: 1500 },
      { name: "Anaesthesia + Consumables", category: "Consumable", unit: "unit", rateInr: 400 },
      { name: "Dental Lab Charges", category: "Lab", unit: "unit", rateInr: 3500 },
      { name: "Digital X-ray / Scan", category: "Diagnostic", unit: "unit", rateInr: 500 },
    ],
    templates: [
      {
        name: "Dental Implant", category: "Treatment",
        description: "Single tooth implant with abutment and crown",
        overheadPct: 20, marginPct: 35, marginFloorPct: 25, laborRateInr: 2500,
        components: [
          { name: "Implant fixture", material: "Titanium Implant Fixture", costBasis: "fixed", materialUnit: "unit", quantity: 1 },
          { name: "Crown + abutment", material: "Zirconia Crown", costBasis: "fixed", materialUnit: "unit", quantity: 1 },
          { name: "Lab work", material: "Dental Lab Charges", costBasis: "fixed", materialUnit: "unit", quantity: 1 },
          { name: "Surgery + consumables", material: "Anaesthesia + Consumables", kind: "labor", costBasis: "hours", materialUnit: "hour", quantity: 1, laborHours: 1.5 },
        ],
      },
      {
        name: "Root Canal + Crown", category: "Treatment",
        description: "Root canal treatment with a zirconia crown",
        overheadPct: 20, marginPct: 35, marginFloorPct: 25, laborRateInr: 2200,
        components: [
          { name: "Root canal kit", material: "Root Canal Kit", costBasis: "fixed", materialUnit: "unit", quantity: 1 },
          { name: "Crown", material: "Zirconia Crown", costBasis: "fixed", materialUnit: "unit", quantity: 1 },
          { name: "Procedure time", kind: "labor", costBasis: "hours", materialUnit: "hour", laborHours: 1 },
        ],
      },
      {
        name: "Consultation + Cleaning", category: "Treatment",
        description: "Check-up, scaling & polishing, and a digital X-ray",
        overheadPct: 18, marginPct: 40, marginFloorPct: 25, laborRateInr: 2000,
        components: [
          { name: "Consultation", kind: "labor", costBasis: "hours", materialUnit: "hour", laborHours: 0.5 },
          { name: "Scaling & polishing", material: "Anaesthesia + Consumables", costBasis: "fixed", materialUnit: "unit", quantity: 1, laborHours: 0.5 },
          { name: "Digital X-ray", material: "Digital X-ray / Scan", costBasis: "fixed", materialUnit: "unit", quantity: 1 },
        ],
      },
    ],
    messageTemplates: [
      { key: "wa_sent", name: "Estimate sent (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, this is {company}. Your treatment estimate is ready — reply here with any questions and our team will guide you." },
      { key: "em_nudge", name: "Estimate nudge (Email)", channel: "email", category: "marketing",
        subject: "Your {company} treatment estimate",
        body: "<p>Hi {lead.firstName},</p><p>Just following up on the treatment estimate we shared. We're happy to explain the plan or discuss options — simply reply.</p><p>— Team {company}</p>" },
      { key: "wa_checkin", name: "Estimate check-in (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, checking in from {company}. Would you like to book an appointment for the treatment we estimated?" },
    ],
    sequence: standardSequence("Estimate follow-up"),
    agent: {
      name: "Inbound Enquiries (WhatsApp Agent)",
      prompt: "You are {company}'s helpful clinic assistant. Answer questions about treatments, procedures, approximate costs, timings and appointment availability. Ask what the patient needs so we can prepare an estimate. Be reassuring, never give a firm diagnosis, and offer to have a clinician follow up. Be concise and warm.",
    },
  },

  // ── Food & Beverage (catering / bulk orders) ──────────────────────────────────
  // Per-head and per-plate costing via `fixed` quantity (= guest count).
  fnb: {
    quoteNoun: "quote",
    materials: [
      { name: "Veg Thali (per plate)", category: "Menu", unit: "plate", rateInr: 180 },
      { name: "Non-veg Thali (per plate)", category: "Menu", unit: "plate", rateInr: 260 },
      { name: "Live Counter (per head)", category: "Menu", unit: "head", rateInr: 120 },
      { name: "Dessert Station (per head)", category: "Menu", unit: "head", rateInr: 80 },
      { name: "Beverage Package (per head)", category: "Menu", unit: "head", rateInr: 60 },
      { name: "Service Staff", category: "Labour", unit: "hour", rateInr: 250 },
    ],
    templates: [
      {
        name: "Catering Package (per head)", category: "Catering",
        description: "Veg buffet with beverages and on-site service staff",
        overheadPct: 12, marginPct: 30, marginFloorPct: 18, laborRateInr: 250,
        components: [
          { name: "Veg thali", material: "Veg Thali (per plate)", costBasis: "fixed", materialUnit: "plate", quantity: 50 },
          { name: "Beverage package", material: "Beverage Package (per head)", costBasis: "fixed", materialUnit: "head", quantity: 50 },
          { name: "Service staff", material: "Service Staff", kind: "labor", costBasis: "hours", materialUnit: "hour", laborHours: 8 },
        ],
      },
      {
        name: "Event Menu (Buffet)", category: "Catering",
        description: "Full buffet with a live counter and dessert station",
        overheadPct: 12, marginPct: 32, marginFloorPct: 18, laborRateInr: 250,
        components: [
          { name: "Non-veg buffet", material: "Non-veg Thali (per plate)", costBasis: "fixed", materialUnit: "plate", quantity: 100 },
          { name: "Live counter", material: "Live Counter (per head)", costBasis: "fixed", materialUnit: "head", quantity: 100 },
          { name: "Dessert station", material: "Dessert Station (per head)", costBasis: "fixed", materialUnit: "head", quantity: 100 },
          { name: "Service staff", material: "Service Staff", kind: "labor", costBasis: "hours", materialUnit: "hour", laborHours: 16 },
        ],
      },
      {
        name: "Bulk / Corporate Order", category: "Catering",
        description: "Boxed meals for corporate or bulk orders",
        overheadPct: 10, marginPct: 28, marginFloorPct: 15, laborRateInr: 250,
        components: [
          { name: "Veg meal box", material: "Veg Thali (per plate)", costBasis: "fixed", materialUnit: "plate", quantity: 40 },
          { name: "Non-veg meal box", material: "Non-veg Thali (per plate)", costBasis: "fixed", materialUnit: "plate", quantity: 20 },
        ],
      },
    ],
    messageTemplates: [
      { key: "wa_sent", name: "Quote sent (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, thanks for choosing {company}! Your catering quote is ready. Reply with your date and guest count and we'll lock it in." },
      { key: "em_nudge", name: "Quote nudge (Email)", channel: "email", category: "marketing",
        subject: "Your {company} catering quote", body: "<p>Hi {lead.firstName},</p><p>Following up on the catering quote we sent. Happy to adjust the menu, headcount or add-ons — just reply.</p><p>— Team {company}</p>" },
      { key: "wa_checkin", name: "Quote check-in (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, checking in from {company} on your catering quote. Shall we confirm the booking for your date?" },
    ],
    sequence: standardSequence("Quote follow-up"),
    agent: {
      name: "Inbound Orders (WhatsApp Agent)",
      prompt: "You are {company}'s friendly catering assistant. Answer questions about menus (veg/non-veg), per-head pricing, minimum orders, event dates and delivery. Ask for the date, guest count and menu preference to prepare a quote. Offer to have the team confirm availability. Be concise and warm.",
    },
  },

  // ── Travel (tours / corporate travel) ─────────────────────────────────────────
  // Per-person packages via `fixed` quantity (= number of travellers).
  travel: {
    quoteNoun: "quote",
    materials: [
      { name: "Flight Seat (domestic)", category: "Transport", unit: "seat", rateInr: 5500 },
      { name: "Hotel Night (3-star, room-night)", category: "Stay", unit: "night", rateInr: 3500 },
      { name: "Hotel Night (4-star, room-night)", category: "Stay", unit: "night", rateInr: 6000 },
      { name: "Airport Transfer", category: "Transport", unit: "trip", rateInr: 1200 },
      { name: "Sightseeing / Entry (per person)", category: "Activity", unit: "person", rateInr: 800 },
      { name: "Tour Guide (per day)", category: "Service", unit: "day", rateInr: 3000 },
      { name: "Travel Insurance (per person)", category: "Service", unit: "person", rateInr: 500 },
    ],
    templates: [
      {
        name: "Tour Package (per person)", category: "Package",
        description: "Flights, hotel nights, transfers and sightseeing",
        overheadPct: 10, marginPct: 20, marginFloorPct: 12, laborRateInr: 0,
        components: [
          { name: "Flights", material: "Flight Seat (domestic)", costBasis: "fixed", materialUnit: "seat", quantity: 2 },
          { name: "Hotel (3 nights)", material: "Hotel Night (3-star, room-night)", costBasis: "fixed", materialUnit: "night", quantity: 3 },
          { name: "Sightseeing", material: "Sightseeing / Entry (per person)", costBasis: "fixed", materialUnit: "person", quantity: 2 },
          { name: "Airport transfers", material: "Airport Transfer", costBasis: "fixed", materialUnit: "trip", quantity: 2 },
        ],
      },
      {
        name: "Corporate Travel Package", category: "Package",
        description: "Business travel with 4-star stay and transfers",
        overheadPct: 10, marginPct: 18, marginFloorPct: 12, laborRateInr: 0,
        components: [
          { name: "Flights", material: "Flight Seat (domestic)", costBasis: "fixed", materialUnit: "seat", quantity: 1 },
          { name: "Hotel (2 nights)", material: "Hotel Night (4-star, room-night)", costBasis: "fixed", materialUnit: "night", quantity: 2 },
          { name: "Airport transfers", material: "Airport Transfer", costBasis: "fixed", materialUnit: "trip", quantity: 2 },
          { name: "Travel insurance", material: "Travel Insurance (per person)", costBasis: "fixed", materialUnit: "person", quantity: 1 },
        ],
      },
    ],
    messageTemplates: [
      { key: "wa_sent", name: "Quote sent (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, thanks for planning with {company}! Your travel quote is ready. Reply with your dates and traveller count and we'll finalise it." },
      { key: "em_nudge", name: "Quote nudge (Email)", channel: "email", category: "marketing",
        subject: "Your {company} travel quote", body: "<p>Hi {lead.firstName},</p><p>Following up on the itinerary and quote we shared. Happy to adjust hotels, dates or activities — just reply.</p><p>— Team {company}</p>" },
      { key: "wa_checkin", name: "Quote check-in (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, checking in from {company} on your travel quote. Shall we go ahead and hold the bookings?" },
    ],
    sequence: standardSequence("Quote follow-up"),
    agent: {
      name: "Inbound Enquiries (WhatsApp Agent)",
      prompt: "You are {company}'s helpful travel assistant. Answer questions about destinations, packages, per-person pricing, hotels, flights and dates. Ask for the destination, dates and number of travellers to prepare a quote. Offer to have a consultant confirm availability. Be concise and warm.",
    },
  },

  // ── Hospitality (banquets / room blocks) ──────────────────────────────────────
  hospitality: {
    quoteNoun: "proposal",
    materials: [
      { name: "Banquet Hall (per day)", category: "Venue", unit: "day", rateInr: 40000 },
      { name: "Room Night (Deluxe)", category: "Stay", unit: "night", rateInr: 5500 },
      { name: "Per-plate Catering (Veg)", category: "Catering", unit: "plate", rateInr: 1200 },
      { name: "Per-plate Catering (Non-veg)", category: "Catering", unit: "plate", rateInr: 1600 },
      { name: "Decor Package", category: "Decor", unit: "package", rateInr: 25000 },
      { name: "AV / Sound (per day)", category: "AV", unit: "day", rateInr: 15000 },
    ],
    templates: [
      {
        name: "Banquet / Event Package", category: "Event",
        description: "Hall, per-plate catering, decor and AV for an event",
        overheadPct: 15, marginPct: 30, marginFloorPct: 20, laborRateInr: 0,
        components: [
          { name: "Banquet hall", material: "Banquet Hall (per day)", costBasis: "fixed", materialUnit: "day", quantity: 1 },
          { name: "Catering (veg)", material: "Per-plate Catering (Veg)", costBasis: "fixed", materialUnit: "plate", quantity: 150 },
          { name: "Decor", material: "Decor Package", costBasis: "fixed", materialUnit: "package", quantity: 1 },
          { name: "AV / sound", material: "AV / Sound (per day)", costBasis: "fixed", materialUnit: "day", quantity: 1 },
        ],
      },
      {
        name: "Room Block", category: "Stay",
        description: "Block of deluxe room-nights for a group",
        overheadPct: 12, marginPct: 28, marginFloorPct: 18, laborRateInr: 0,
        components: [
          { name: "Deluxe room-nights", material: "Room Night (Deluxe)", costBasis: "fixed", materialUnit: "night", quantity: 20 },
        ],
      },
    ],
    messageTemplates: [
      { key: "wa_sent", name: "Proposal sent (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, thanks for considering {company}! Your event proposal is ready. Reply with your date and guest count and we'll hold the venue." },
      { key: "em_nudge", name: "Proposal nudge (Email)", channel: "email", category: "marketing",
        subject: "Your {company} event proposal", body: "<p>Hi {lead.firstName},</p><p>Following up on the proposal we shared. Happy to adjust the menu, decor or room block — just reply.</p><p>— Team {company}</p>" },
      { key: "wa_checkin", name: "Proposal check-in (WhatsApp)", channel: "whatsapp", category: "utility",
        body: "Hi {lead.firstName}, checking in from {company} on your event proposal. Shall we confirm the date for you?" },
    ],
    sequence: standardSequence("Proposal follow-up"),
    agent: {
      name: "Inbound Enquiries (WhatsApp Agent)",
      prompt: "You are {company}'s warm front-desk assistant. Answer questions about banquet halls, room blocks, per-plate catering, decor, dates and availability. Ask for the event date, guest count and requirements to prepare a proposal. Offer to have the events team confirm availability. Be concise and welcoming.",
    },
  },
};

// Resolve a catalog for an industry string, defaulting to manufacturing (the vertical
// the quoting engine was built for) when the value is unknown/null.
export function getIndustryCatalog(industry: string | null | undefined): IndustryCatalog {
  if (industry && industry in INDUSTRY_CATALOG) return INDUSTRY_CATALOG[industry as Industry];
  return INDUSTRY_CATALOG.manufacturing;
}

// Replace the {company} placeholder with the real workspace name. Leaves runtime
// placeholders like {lead.firstName} untouched.
export function fillCompany(text: string, companyName: string): string {
  return text.replace(/\{company\}/g, companyName);
}
