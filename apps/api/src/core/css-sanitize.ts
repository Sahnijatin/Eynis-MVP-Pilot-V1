// Sanitiser for per-tenant custom CSS (E-9, white_label tier).
//
// Custom CSS is injected into a <style> element in the tenant's own app shell, so
// it must not be able to (a) break out of <style> into HTML (XSS), or (b) make
// network requests that exfiltrate data / leak presence. We therefore strip every
// known dangerous construct rather than trying to allow-list properties:
//
//   • comments              — could obfuscate the keywords we strip below
//   • "<" and ">"           — prevents "</style>" breakout into HTML
//   • @import / @charset…   — pulls remote stylesheets (tracking/exfiltration)
//   • url(...)              — the only CSS network channel; also the classic
//                             attribute-selector data-exfiltration vector
//   • expression(...)       — legacy IE script execution
//   • behavior / -moz-binding (HTC/XBL script bindings)
//   • javascript:/vbscript: schemes
//
// What survives is layout/colour/typography CSS with no network or script reach.
// (Trade-off: @font-face / remote fonts need url() and are therefore not
//  supported here — tenants use the structured `fontFamily` field instead.)

const MAX_CSS_BYTES = 20_000;

export function sanitizeCustomCss(input: unknown): string | null {
  if (typeof input !== "string") return null;
  let css = input.trim();
  if (!css) return null;
  // Hard length cap first so the regex passes below can't be fed a huge payload.
  if (css.length > MAX_CSS_BYTES) css = css.slice(0, MAX_CSS_BYTES);

  css = css
    // Strip CSS comments first (they could hide keywords like @imp/**/ort).
    .replace(/\/\*[\s\S]*?\*\//g, "")
    // No angle brackets at all → "</style>" can't terminate the <style> element.
    .replace(/[<>]/g, "")
    // Remove at-rules that fetch remote resources.
    .replace(/@import\b[^;]*;?/gi, "")
    .replace(/@charset\b[^;]*;?/gi, "")
    .replace(/@namespace\b[^;]*;?/gi, "")
    // Remove the CSS network/script function vectors.
    .replace(/url\s*\([^)]*\)/gi, "")
    .replace(/expression\s*\([^)]*\)/gi, "")
    // Remove declarations whose property is a known script-binding vector.
    .replace(/(?:-moz-binding|behavior)\s*:[^;]*;?/gi, "")
    // Belt-and-suspenders: kill any leftover script schemes.
    .replace(/javascript\s*:/gi, "")
    .replace(/vbscript\s*:/gi, "");

  const cleaned = css.trim();
  return cleaned.length ? cleaned : null;
}
