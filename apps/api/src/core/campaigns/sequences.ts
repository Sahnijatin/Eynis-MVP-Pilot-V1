// Drip sequence helpers (pure): step validation, exit-condition parsing, and
// next-run computation. Kept free of DB/HTTP so the rules are unit-testable.

export const SEQUENCE_CHANNELS = ["whatsapp", "email"] as const;
export type SequenceChannel = (typeof SEQUENCE_CHANNELS)[number];

export const EXIT_CONDITIONS = ["opted_out", "replied", "booked"] as const;
export type ExitCondition = (typeof EXIT_CONDITIONS)[number];

export interface SequenceStepInput {
  order: number;
  waitMinutes: number;
  channel: SequenceChannel;
  whatsappContentSid: string | null;
  whatsappTemplateBody: string | null;
  whatsappVariables: string[];
  emailSubject: string | null;
  emailBody: string | null;
}

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};
const intOrNull = (v: unknown): number | null =>
  typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : null;

// Validate the ordered step list submitted on create/update. Assigns `order` by
// position. Each step must name a supported channel and carry the template
// fields that channel needs.
export function validateSequenceSteps(raw: unknown): Validated<SequenceStepInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: "steps must be a non-empty array" };
  const steps: SequenceStepInput[] = [];
  for (let i = 0; i < raw.length; i++) {
    const s = raw[i] as Record<string, unknown>;
    if (!s || typeof s !== "object") return { ok: false, error: `step ${i} must be an object` };
    const channel = str(s.channel);
    if (!channel || !SEQUENCE_CHANNELS.includes(channel as SequenceChannel)) {
      return { ok: false, error: `step ${i}: channel must be one of ${SEQUENCE_CHANNELS.join(", ")}` };
    }
    const waitMinutes = s.waitMinutes === undefined ? 0 : intOrNull(s.waitMinutes);
    if (waitMinutes === null) return { ok: false, error: `step ${i}: waitMinutes must be a non-negative integer` };

    const whatsappContentSid = str(s.whatsappContentSid);
    const emailSubject = str(s.emailSubject);
    const emailBody = str(s.emailBody);
    if (channel === "whatsapp" && !whatsappContentSid) {
      return { ok: false, error: `step ${i}: whatsapp step requires whatsappContentSid` };
    }
    if (channel === "email" && (!emailSubject || !emailBody)) {
      return { ok: false, error: `step ${i}: email step requires emailSubject and emailBody` };
    }
    const whatsappVariables = Array.isArray(s.whatsappVariables)
      ? s.whatsappVariables.filter((x): x is string => typeof x === "string")
      : [];

    steps.push({
      order: i, waitMinutes, channel: channel as SequenceChannel,
      whatsappContentSid, whatsappTemplateBody: str(s.whatsappTemplateBody), whatsappVariables,
      emailSubject, emailBody,
    });
  }
  return { ok: true, value: steps };
}

export function parseExitOn(raw: unknown): ExitCondition[] {
  let arr: unknown = raw;
  if (typeof raw === "string") { try { arr = JSON.parse(raw); } catch { return []; } }
  if (!Array.isArray(arr)) return [];
  return Array.from(new Set(arr.filter((x): x is ExitCondition => EXIT_CONDITIONS.includes(x as ExitCondition))));
}

export const nextRunFrom = (now: Date, waitMinutes: number): Date => new Date(now.getTime() + waitMinutes * 60_000);
