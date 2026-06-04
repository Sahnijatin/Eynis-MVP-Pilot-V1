// Message-template library helpers (pure): create/update validation and the
// approval-status lifecycle. WhatsApp templates carry a Meta/Twilio approval
// state; email templates are usable as soon as they're written.

export const TEMPLATE_CHANNELS = ["whatsapp", "email"] as const;
export type TemplateChannel = (typeof TEMPLATE_CHANNELS)[number];

export const TEMPLATE_CATEGORIES = ["marketing", "utility", "authentication"] as const;
export const TEMPLATE_STATUSES = ["draft", "submitted", "approved", "rejected"] as const;
export type TemplateStatus = (typeof TEMPLATE_STATUSES)[number];

export type Validated<T> = { ok: true; value: T } | { ok: false; error: string };

const str = (v: unknown): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim();
  return s.length > 0 ? s : null;
};
const strList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export interface TemplateCreate {
  name: string;
  channel: TemplateChannel;
  category: string;
  language: string;
  subject: string | null;
  body: string;
  variables: string[];
}

export function validateTemplateCreate(body: Record<string, unknown>): Validated<TemplateCreate> {
  const name = str(body.name);
  if (!name) return { ok: false, error: "name is required" };
  const channel = str(body.channel);
  if (!channel || !TEMPLATE_CHANNELS.includes(channel as TemplateChannel)) {
    return { ok: false, error: `channel must be one of ${TEMPLATE_CHANNELS.join(", ")}` };
  }
  const text = str(body.body);
  if (!text) return { ok: false, error: "body is required" };
  const category = str(body.category) ?? "marketing";
  if (!TEMPLATE_CATEGORIES.includes(category as (typeof TEMPLATE_CATEGORIES)[number])) {
    return { ok: false, error: `category must be one of ${TEMPLATE_CATEGORIES.join(", ")}` };
  }
  const subject = str(body.subject);
  if (channel === "email" && !subject) return { ok: false, error: "email template requires a subject" };
  return {
    ok: true,
    value: { name, channel: channel as TemplateChannel, category, language: str(body.language) ?? "en", subject, body: text, variables: strList(body.variables) },
  };
}

// Validate a requested status change. WhatsApp templates can only be "approved"
// with a provider id (the Content SID); a rejection should carry a reason.
export function validateStatusChange(
  channel: string,
  next: string,
  opts: { providerTemplateId?: string | null; rejectionReason?: string | null },
): Validated<{ status: TemplateStatus; providerTemplateId: string | null; rejectionReason: string | null; submittedAt?: Date }> {
  if (!TEMPLATE_STATUSES.includes(next as TemplateStatus)) {
    return { ok: false, error: `status must be one of ${TEMPLATE_STATUSES.join(", ")}` };
  }
  const status = next as TemplateStatus;
  const providerTemplateId = str(opts.providerTemplateId) ?? null;
  const rejectionReason = str(opts.rejectionReason) ?? null;
  if (status === "approved" && channel === "whatsapp" && !providerTemplateId) {
    return { ok: false, error: "approving a WhatsApp template requires providerTemplateId (the approved Content SID)" };
  }
  return {
    ok: true,
    value: {
      status,
      providerTemplateId: status === "approved" ? providerTemplateId : null,
      rejectionReason: status === "rejected" ? rejectionReason : null,
      ...(status === "submitted" ? { submittedAt: new Date() } : {}),
    },
  };
}
