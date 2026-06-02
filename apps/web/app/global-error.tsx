"use client";

// Last-resort boundary. Catches errors thrown by the root layout itself
// (where the standard error.tsx can't help because the layout is what failed).
// Without this, a crash in layout.tsx renders a blank white page.
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html>
      <body style={{ margin: 0, fontFamily: "Inter, system-ui, Segoe UI, Arial, sans-serif", background: "#f8fafc" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: 24 }}>
          <div style={{ maxWidth: 480, textAlign: "center" }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, color: "#1e293b", marginBottom: 8 }}>
              Something went wrong loading Eynis
            </h1>
            <p style={{ fontSize: 14, color: "#64748b", marginBottom: 24 }}>
              {process.env.NODE_ENV !== "production" && error?.message
                ? error.message
                : "An unexpected error occurred. Your data is safe — try reloading."}
            </p>
            <div style={{ display: "flex", gap: 8, justifyContent: "center" }}>
              <button
                onClick={() => reset()}
                style={{ padding: "8px 16px", borderRadius: 8, background: "#0f766e", color: "#fff", border: 0, fontSize: 14, fontWeight: 500, cursor: "pointer" }}
              >
                Try again
              </button>
              <a
                href="/dashboard"
                style={{ padding: "8px 16px", borderRadius: 8, background: "#fff", color: "#475569", border: "1px solid #e2e8f0", fontSize: 14, fontWeight: 500, textDecoration: "none" }}
              >
                Go to dashboard
              </a>
            </div>
          </div>
        </div>
      </body>
    </html>
  );
}
