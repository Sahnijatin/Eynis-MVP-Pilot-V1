// Shared client-side fetch wrapper (Phase 3 of the frontend review). The
// dominant defect class in the UI was fire-and-forget fetches: unchecked
// res.ok/data.ok made failures look like successes, and try/finally without
// catch left buttons wedged in busy state on a network error. Route every
// mutating client fetch through this so failures always surface.
//
//   const r = await jsonRequest<{ item: Thing }>("/api/things", { method: "POST", ... });
//   if (!r.ok) { toast.push(r.error, "error"); return; }
//   use(r.data.item)

export interface JsonResult<T> {
  ok: boolean;
  data: T | null;
  error: string;
}

export async function jsonRequest<T = Record<string, unknown>>(
  input: string,
  init?: RequestInit,
): Promise<JsonResult<T>> {
  try {
    const res = await fetch(input, init);
    const data = (await res.json().catch(() => null)) as (T & { ok?: boolean; error?: string }) | null;
    if (!res.ok || !data || data.ok === false) {
      const detail = data && typeof data.error === "string" && data.error ? data.error : `Request failed (${res.status})`;
      return { ok: false, data, error: detail };
    }
    return { ok: true, data, error: "" };
  } catch {
    return { ok: false, data: null, error: "Network error — please try again." };
  }
}
