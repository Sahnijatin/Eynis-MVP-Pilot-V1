"use client";

// Catches any unhandled error thrown during render of a server or client
// component below this boundary. Without it, Next.js would render an empty
// shell on the broken route — the bug we're protecting against.
import { useEffect } from "react";
import { AlertTriangle, RefreshCw, LayoutDashboard } from "lucide-react";

export default function ErrorBoundary({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (process.env.NODE_ENV !== "production") {
      console.error("[ErrorBoundary]", error);
    }
  }, [error]);

  return (
    <div className="flex items-center justify-center" style={{ minHeight: "60vh" }}>
      <div className="max-w-md w-full text-center p-8">
        <div className="w-14 h-14 rounded-full bg-amber-50 flex items-center justify-center mx-auto mb-4">
          <AlertTriangle className="w-7 h-7 text-amber-500" />
        </div>
        <h1 className="text-lg font-semibold text-slate-800 mb-2">
          Couldn&apos;t load this page
        </h1>
        <p className="text-sm text-slate-500 mb-6">
          Something went wrong while loading your workspace. Your data is safe.
        </p>
        <div className="flex items-center justify-center gap-2">
          <button
            onClick={() => reset()}
            className="px-4 py-2 text-sm font-medium rounded-lg text-white flex items-center gap-1.5"
            style={{ background: "var(--color-industry, #0f766e)" }}
          >
            <RefreshCw className="w-3.5 h-3.5" /> Try again
          </button>
          <a
            href="/dashboard"
            className="px-4 py-2 text-sm font-medium rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50 flex items-center gap-1.5"
          >
            <LayoutDashboard className="w-3.5 h-3.5" /> Back to dashboard
          </a>
        </div>
      </div>
    </div>
  );
}
