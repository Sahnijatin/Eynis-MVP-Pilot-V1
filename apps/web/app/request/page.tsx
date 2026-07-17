import { RequestVoicePlayer } from "../../components/ui/request-voice-player";
import { resolveHostTheme } from "../../lib/host-theme";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = searchParams ? await searchParams : {};
  const result = typeof query.result === "string" ? query.result : "";
  const msg = typeof query.msg === "string" ? query.msg : "";
  const ackText =
    typeof query.ack === "string"
      ? query.ack
      : "Thank you. Your request has been received. Our team will respond shortly.";

  // Brand the public intake page with the tenant when it's served on their host
  // (white-label, E-9). Degrades to the platform default off a custom domain.
  const theme = await resolveHostTheme();

  // Tenant resolution, most-specific first: an explicit link param (accepting the
  // legacy `?hotelId=` so QR codes printed before the rename still work), then the
  // tenant that owns this host (white-label domains). The shared demo tenant is
  // opt-in only (EYNIS_ALLOW_DEMO_FALLBACK, matching lib/api.ts) — otherwise a
  // param-less visit must fail closed rather than file a real customer's request
  // (and their PII) into the demo workspace.
  const demoFallbackAllowed =
    String(process.env.EYNIS_ALLOW_DEMO_FALLBACK ?? "").toLowerCase() === "true";
  const tenantId =
    typeof query.tenantId === "string" ? query.tenantId
    : typeof query.hotelId === "string" ? query.hotelId
    : theme.tenantId
      ?? (demoFallbackAllowed ? (process.env.EYNIS_DEMO_HOTEL_ID ?? "eynis-riviera-1") : null);

  return (
    <main style={{ maxWidth: 720 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16 }}>
        <div style={{ width: 36, height: 36, borderRadius: 8, background: theme.primaryColor, display: "flex", alignItems: "center", justifyContent: "center", overflow: "hidden", flexShrink: 0 }}>
          {theme.logoUrl
            ? <img src={theme.logoUrl} alt="" style={{ width: "100%", height: "100%", objectFit: "contain" }} />
            : <span style={{ color: "#fff", fontWeight: 700 }}>{theme.brandName.charAt(0).toUpperCase()}</span>}
        </div>
        <span style={{ fontWeight: 700, fontSize: 18 }}>{theme.brandName}</span>
      </div>
      <h1>Submit a Request</h1>
      {!tenantId ? (
        <p style={{ color: "#64748b" }}>
          This request link is missing its workspace. Please use the exact link or
          QR code you were given, or contact the team that shared it with you.
        </p>
      ) : (
      <>
      <p style={{ color: "#64748b" }}>
        Scan-ready request form. Submit once and our team will follow up.
      </p>
      {result ? (
        <div
          style={{
            background: result === "ok" ? "#dcfce7" : "#fee2e2",
            color: result === "ok" ? "#166534" : "#991b1b",
            border: "1px solid " + (result === "ok" ? "#86efac" : "#fecaca"),
            padding: "8px 10px",
            borderRadius: 8,
            marginBottom: 12
          }}
        >
          {result === "ok" ? "Request submitted successfully." : msg || "Request failed."}
          {result === "ok" ? <RequestVoicePlayer text={ackText} /> : null}
        </div>
      ) : null}
      <section style={{ border: "1px solid #ddd", borderRadius: 8, padding: 12, background: "#fff" }}>
        <form method="POST" action="/api/public/request" style={{ display: "grid", gap: 10 }}>
          <input type="hidden" name="tenantId" value={tenantId} />
          <label>
            Your Name
            <input name="guestName" required style={{ display: "block", width: "100%", marginTop: 4 }} />
          </label>
          <label>
            WhatsApp Number
            <input
              name="guestPhone"
              required
              placeholder="+9198XXXXXXXX"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          {/* Industry-neutral categories (3.6): this public form serves every
              vertical, so no hospitality-specific wording. The API accepts the
              category as free text and classification refines it downstream. */}
          <label>
            Request Type
            <select name="category" defaultValue="general" style={{ display: "block", marginTop: 4 }}>
              <option value="general">General</option>
              <option value="service">Service</option>
              <option value="maintenance">Maintenance</option>
              <option value="billing">Billing</option>
            </select>
          </label>
          <label>
            Request Details
            <textarea
              name="summary"
              required
              rows={4}
              placeholder="Describe what you need and where — the more detail, the faster we can help"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <button
            type="submit"
            style={{
              width: "fit-content",
              border: `1px solid ${theme.primaryColor}`,
              background: theme.primaryColor,
              color: "#fff",
              borderRadius: 6,
              padding: "6px 12px",
              cursor: "pointer"
            }}
          >
            Submit Request
          </button>
        </form>
      </section>
      </>
      )}
    </main>
  );
}

