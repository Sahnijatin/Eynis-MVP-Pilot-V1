import { RequestVoicePlayer } from "../../components/ui/request-voice-player";

export const dynamic = "force-dynamic";

export default async function RequestPage({
  searchParams
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = searchParams ? await searchParams : {};
  // Accept the legacy `?hotelId=` param so QR codes / links printed before the
  // rename still resolve to the right tenant. Fallback is the demo tenant
  // (matches the seed + EYNIS_DEMO_HOTEL_ID), so a param-less visit still works.
  const tenantId =
    typeof query.tenantId === "string" ? query.tenantId
    : typeof query.hotelId === "string" ? query.hotelId
    : (process.env.EYNIS_DEMO_HOTEL_ID ?? "eynis-riviera-1");
  const result = typeof query.result === "string" ? query.result : "";
  const msg = typeof query.msg === "string" ? query.msg : "";
  const ackText =
    typeof query.ack === "string"
      ? query.ack
      : "Thank you. Your request has been received. Our team will respond shortly.";

  return (
    <main style={{ maxWidth: 720 }}>
      <h1>Guest Request</h1>
      <p style={{ color: "#64748b" }}>
        Scan-ready request form for in-room QR use. Submit once and hotel staff will follow up.
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
          <label>
            Request Type
            <select name="category" defaultValue="general" style={{ display: "block", marginTop: 4 }}>
              <option value="general">General</option>
              <option value="housekeeping">Housekeeping</option>
              <option value="maintenance">Maintenance</option>
              <option value="front_desk">Front Desk</option>
            </select>
          </label>
          <label>
            Request Details
            <textarea
              name="summary"
              required
              rows={4}
              placeholder="Example: Need two extra towels in room 204"
              style={{ display: "block", width: "100%", marginTop: 4 }}
            />
          </label>
          <button
            type="submit"
            style={{
              width: "fit-content",
              border: "1px solid #2563eb",
              background: "#2563eb",
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
    </main>
  );
}

