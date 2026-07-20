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
    return <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 8, background: "var(--ok-bg)", color: "var(--ok-text)", fontWeight: 600 }}>✓ Quote accepted — the team will be in touch shortly.</div>;
  }
  if (current === "rejected") {
    return <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 8, background: "var(--danger-bg)", color: "var(--danger-text)", fontWeight: 600 }}>Quote declined. If you'd like a revised offer, just reply to the sender.</div>;
  }
  if (current === "expired") {
    return <div style={{ marginTop: 20, padding: "12px 14px", borderRadius: 8, background: "var(--warn-bg)", color: "var(--warn-text)", fontWeight: 600 }}>This quote has expired — contact the sender for a refreshed offer.</div>;
  }

  return (
    <div style={{ marginTop: 20 }}>
      {error && <div style={{ marginBottom: 10, padding: "8px 10px", borderRadius: 8, background: "var(--danger-bg)", color: "var(--danger-text)", fontSize: 14 }}>{error}</div>}
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
          style={{ background: "var(--surface)", color: "var(--text-muted)", border: "1px solid var(--border-strong)", borderRadius: 8, padding: "10px 22px", fontWeight: 600, fontSize: 15, cursor: "pointer", opacity: busy ? 0.6 : 1 }}
        >
          Decline
        </button>
      </div>
    </div>
  );
}
