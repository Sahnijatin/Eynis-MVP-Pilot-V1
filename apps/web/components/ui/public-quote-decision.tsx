"use client";

import { useState } from "react";

// Accept / Decline actions on the public quote page (Phase 6). Idempotent on the
// API side; on success we show the terminal state instead of the buttons.
export function QuoteDecision({ token, status, primaryColor }: { token: string; status: string; primaryColor: string }) {
  const [current, setCurrent] = useState(status);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function decide(action: "accept" | "decline") {
    if (busy) return;
    if (action === "decline" && !window.confirm("Decline this quote?")) return;
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/public/quotes/${encodeURIComponent(token)}/${action}`, {
        method: "POST", headers: { "content-type": "application/json" }, body: "{}",
      });
      const data = (await res.json()) as { ok: boolean; status?: string; error?: string };
      if (!data.ok) { setError(data.error ?? "Something went wrong — please try again."); return; }
      setCurrent(data.status ?? (action === "accept" ? "accepted" : "rejected"));
    } catch {
      setError("Something went wrong — please try again.");
    } finally {
      setBusy(false);
    }
  }

  if (current === "accepted") {
    return <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 8, background: "#dcfce7", color: "#166534", fontWeight: 600 }}>✓ Quote accepted — the team will be in touch shortly.</div>;
  }
  if (current === "rejected") {
    return <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontWeight: 600 }}>Quote declined. If you'd like a revised offer, just reply to the sender.</div>;
  }
  if (current === "expired") {
    return <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 8, background: "#fef3c7", color: "#92400e", fontWeight: 600 }}>This quote has expired — contact the sender for a refreshed offer.</div>;
  }

  return (
    <div style={{ marginTop: 20 }}>
      {error && <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "#fee2e2", color: "#991b1b", fontSize: 14 }}>{error}</div>}
      <div style={{ display: "flex", gap: 10 }}>
        <button
          onClick={() => decide("accept")}
          disabled={busy}
          style={{ background: primaryColor, color: "#fff", border: "none", borderRadius: 8, padding: "10px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          {busy ? "Working…" : "Accept quote"}
        </button>
        <button
          onClick={() => decide("decline")}
          disabled={busy}
          style={{ background: "#fff", color: "#475569", border: "1px solid #cbd5e1", borderRadius: 8, padding: "10px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
