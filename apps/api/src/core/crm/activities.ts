// CRM activity helpers (Increment C) — manual notes & tasks.

export type Ok<T> = { ok: true; value: T };
export type Err = { ok: false; error: string };
export type Result<T> = Ok<T> | Err;

function optString(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t === "" ? null : t;
}
const INVALID_DATE = Symbol("invalid_date");
function parseOptionalDate(v: unknown): Date | null | typeof INVALID_DATE {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v !== "string") return INVALID_DATE;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? INVALID_DATE : d;
}

// Manual activity types a user can create. (Channel events — calls, WhatsApp —
// are projected at read time, not created via this route.)
export const MANUAL_ACTIVITY_TYPES = ["note", "task", "meeting"] as const;

export interface ActivityCreateValue {
  type: string;
  title: string;
  body: string | null;
  dueAt: Date | null;
  dealId: string | null;
  status: string; // tasks start "open"; notes/meetings are "logged"
}

export function validateActivityCreate(body: Record<string, unknown>): Result<ActivityCreateValue> {
  const type = optString(body.type) ?? "note";
  if (!MANUAL_ACTIVITY_TYPES.includes(type as (typeof MANUAL_ACTIVITY_TYPES)[number])) {
    return { ok: false, error: `type must be one of ${MANUAL_ACTIVITY_TYPES.join(", ")}` };
  }
  const title = optString(body.title);
  if (!title) return { ok: false, error: "title is required" };
  if (title.length > 300) return { ok: false, error: "title is too long (max 300)" };
  const dueAt = parseOptionalDate(body.dueAt);
  if (dueAt === INVALID_DATE) return { ok: false, error: "dueAt must be a valid date" };
  return {
    ok: true,
    value: {
      type,
      title,
      body: optString(body.body),
      dueAt,
      dealId: optString(body.dealId),
      status: type === "task" ? "open" : "logged",
    },
  };
}

export interface ActivityUpdate {
  title?: string;
  body?: string | null;
  dueAt?: Date | null;
  status?: string;
  completedAt?: Date | null;
}

export function buildActivityUpdate(body: Record<string, unknown>): Result<ActivityUpdate> {
  const update: ActivityUpdate = {};
  if ("title" in body) {
    const title = optString(body.title);
    if (!title) return { ok: false, error: "title cannot be empty" };
    update.title = title;
  }
  if ("body" in body) update.body = optString(body.body);
  if ("dueAt" in body) {
    const d = parseOptionalDate(body.dueAt);
    if (d === INVALID_DATE) return { ok: false, error: "dueAt must be a valid date" };
    update.dueAt = d;
  }
  // Completing / reopening a task.
  if ("status" in body) {
    const status = optString(body.status);
    if (status === "done") { update.status = "done"; update.completedAt = new Date(); }
    else if (status === "open") { update.status = "open"; update.completedAt = null; }
    else if (status) update.status = status;
  }
  if ("completed" in body) {
    if (body.completed === true) { update.status = "done"; update.completedAt = new Date(); }
    else if (body.completed === false) { update.status = "open"; update.completedAt = null; }
  }
  if (Object.keys(update).length === 0) return { ok: false, error: "No updatable fields provided" };
  return { ok: true, value: update };
}

export function serializeActivity(a: {
  id: string;
  type: string;
  title: string;
  body: string | null;
  direction: string | null;
  dueAt: Date | null;
  completedAt: Date | null;
  status: string;
  contactId: string | null;
  dealId: string | null;
  userId: string | null;
  meta: unknown;
  createdAt: Date;
  user?: { id: string; fullName: string } | null;
}) {
  return {
    id: a.id,
    type: a.type,
    title: a.title,
    body: a.body,
    direction: a.direction,
    dueAt: a.dueAt ? a.dueAt.toISOString() : null,
    completedAt: a.completedAt ? a.completedAt.toISOString() : null,
    status: a.status,
    contactId: a.contactId,
    dealId: a.dealId,
    userId: a.userId,
    userName: a.user?.fullName ?? null,
    meta: a.meta ?? null,
    createdAt: a.createdAt.toISOString(),
  };
}
