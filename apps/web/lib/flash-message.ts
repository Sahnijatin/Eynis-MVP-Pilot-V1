/** Single-line flash text safe for URL query (no control chars, capped length). */
export function sanitizeFlashMessage(input: string): string {
  return input
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 160);
}

/** Read `{ error: string }` from API JSON body, or a short fallback. */
export async function extractApiErrorMessage(response: Response): Promise<string> {
  const text = await response.text();
  let raw = "";
  try {
    const j = JSON.parse(text) as { error?: unknown };
    if (typeof j.error === "string" && j.error.length > 0) {
      raw = j.error;
    }
  } catch {
    if (text.length > 0) {
      raw = text.slice(0, 80);
    }
  }
  if (!raw) {
    raw = "Request failed (HTTP " + String(response.status) + ")";
  }
  return sanitizeFlashMessage(raw);
}
