"use client";

import { useState } from "react";

export function RequestVoicePlayer({ text }: { text: string }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const play = async () => {
    try {
      setLoading(true);
      setError("");
      const res = await fetch("/api/public/request/voice", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text })
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: unknown };
        throw new Error(typeof payload.error === "string" ? payload.error : "Could not play voice");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const audio = new Audio(url);
      audio.onended = () => URL.revokeObjectURL(url);
      await audio.play();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not play voice");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ marginTop: 8 }}>
      <button
        type="button"
        onClick={play}
        disabled={loading}
        style={{
          border: "1px solid #0f766e",
          background: "#0f766e",
          color: "#fff",
          borderRadius: 6,
          padding: "6px 12px",
          cursor: loading ? "wait" : "pointer",
          opacity: loading ? 0.75 : 1
        }}
      >
        {loading ? "Generating voice..." : "Play voice confirmation"}
      </button>
      {error ? <p style={{ margin: "6px 0 0 0", fontSize: 13 }}>{error}</p> : null}
    </div>
  );
}

