// Custom journey-flow authoring (self-serve "New Flow"). A flow is stored as an
// AutomationRule with ruleType "marketing" in its configJson; the GET /automations
// serializer surfaces its trigger/action/detail. The trigger/action vocabulary is
// industry-neutral CRM language so it reads sensibly for any vertical (the web New
// Flow modal mirrors these keys/labels). Newly created flows start with zero stats —
// executions/conversions accrue honestly as the engine (or attribution) records them.

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

// key → human label. Keys are stable and stored in configJson; labels are display-only.
export const FLOW_TRIGGERS: Record<string, string> = {
  new_lead: "New lead / enquiry lands",
  quote_sent: "Quote / estimate sent",
  quote_no_response: "Quote sent · no response",
  deal_stage_changed: "Deal changes stage",
  deal_won: "Deal won",
  deal_lost: "Deal lost / abandoned",
  order_delivered: "Order delivered",
  contact_dormant: "Contact goes dormant",
  task_overdue: "Task overdue",
};

export const FLOW_ACTIONS: Record<string, string> = {
  send_whatsapp: "Send a WhatsApp message",
  send_email: "Send an email",
  multi_touch_followup: "Start multi-touch follow-up",
  nurture_drip: "Send nurture content drip",
  create_task: "Create a follow-up task",
  notify_team: "Notify the team",
  ask_review: "Ask for a review / referral",
};

export const FLOW_CHANNELS = ["whatsapp", "email", "sms"] as const;
export type FlowChannel = (typeof FLOW_CHANNELS)[number];

const MAX_DELAY_HOURS = 24 * 365; // one year

export interface FlowCreateValue {
  name: string;
  trigger: string;
  action: string;
  channels: FlowChannel[];
  delayHours: number;
  detail: string | null;
  sequenceId: string | null;
  isActive: boolean;
}

// Actions that enroll the contact into a drip Sequence — a sequenceId may be attached.
export const SEQUENCE_ACTIONS = new Set(["multi_touch_followup", "nurture_drip"]);

function str(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}

export function validateFlowCreate(body: Record<string, unknown>): Result<FlowCreateValue> {
  const name = str(body.name);
  if (!name) return { ok: false, error: "name is required" };
  if (name.length > 120) return { ok: false, error: "name is too long (max 120)" };

  const trigger = str(body.trigger);
  if (!trigger || !(trigger in FLOW_TRIGGERS)) {
    return { ok: false, error: `trigger must be one of: ${Object.keys(FLOW_TRIGGERS).join(", ")}` };
  }
  const action = str(body.action);
  if (!action || !(action in FLOW_ACTIONS)) {
    return { ok: false, error: `action must be one of: ${Object.keys(FLOW_ACTIONS).join(", ")}` };
  }

  // channels: optional array; every entry must be a known channel.
  let channels: FlowChannel[] = [];
  if (body.channels !== undefined && body.channels !== null) {
    if (!Array.isArray(body.channels)) return { ok: false, error: "channels must be an array" };
    const seen = new Set<string>();
    for (const c of body.channels) {
      if (typeof c !== "string" || !FLOW_CHANNELS.includes(c as FlowChannel)) {
        return { ok: false, error: `channels must be a subset of: ${FLOW_CHANNELS.join(", ")}` };
      }
      seen.add(c);
    }
    channels = [...seen] as FlowChannel[];
  }

  // delayHours: optional non-negative integer.
  let delayHours = 0;
  if (body.delayHours !== undefined && body.delayHours !== null && body.delayHours !== "") {
    const n = Number(body.delayHours);
    if (!Number.isFinite(n) || n < 0 || n > MAX_DELAY_HOURS || !Number.isInteger(n)) {
      return { ok: false, error: `delayHours must be an integer between 0 and ${MAX_DELAY_HOURS}` };
    }
    delayHours = n;
  }

  const detail = str(body.detail);
  if (detail && detail.length > 300) return { ok: false, error: "detail is too long (max 300)" };

  // sequenceId only carries meaning for the enroll actions; ignored otherwise.
  const sequenceId = SEQUENCE_ACTIONS.has(action) ? str(body.sequenceId) : null;

  const isActive = body.isActive === undefined ? true : Boolean(body.isActive);

  return { ok: true, value: { name, trigger, action, channels, delayHours, detail, sequenceId, isActive } };
}

// Build the configJson payload the GET serializer + engine read back.
export function buildFlowConfig(v: FlowCreateValue): string {
  return JSON.stringify({
    ruleType: "marketing",
    custom: true,
    trigger: v.trigger,
    action: v.action,
    channels: v.channels,
    delayHours: v.delayHours,
    detail: v.detail,
    sequenceId: v.sequenceId,
    stats: { executions: 0, conversions: 0, revenueInr: 0 },
  });
}

// Stable, readable, unique-ish rule code from the flow name. A random suffix keeps
// two same-named flows distinct; the caller retries on the (tenantId, code) unique
// collision. `rand` is injected so tests are deterministic.
export function makeFlowCode(name: string, rand: () => string): string {
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "flow";
  return `flow_${slug}_${rand()}`;
}
