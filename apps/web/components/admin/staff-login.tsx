"use client";

import { useState } from "react";
import { Loader2, ShieldCheck } from "lucide-react";

// Login gate for the internal provisioning console (E-8). Staff enter the
// platform-admin secret; on success the server sets an httpOnly cookie and we
// reload into the console.
export function StaffLogin() {
  const [secret, setSecret] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await fetch("/api/admin/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ secret })
      });
      const data = (await r.json()) as { ok: boolean; error?: string };
      if (!r.ok || !data.ok) {
        setError(data.error ?? "Login failed.");
        setBusy(false);
        return;
      }
      window.location.reload();
    } catch {
      setError("Could not reach the server.");
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 p-6">
      <form onSubmit={submit} className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-slate-200 p-8">
        <div className="flex items-center gap-2 mb-1 text-slate-800">
          <ShieldCheck className="w-5 h-5 text-teal-700" />
          <h1 className="text-lg font-semibold">Provisioning Console</h1>
        </div>
        <p className="text-sm text-slate-500 mb-6">Internal staff only. Enter the platform admin secret to continue.</p>

        <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Platform admin secret</label>
        <input
          type="password"
          autoFocus
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 mb-4"
          placeholder="••••••••••••••••"
        />

        {error && <p className="text-sm text-red-600 mb-4">{error}</p>}

        <button
          type="submit"
          disabled={busy || secret.length === 0}
          className="w-full px-4 py-2.5 text-sm font-semibold rounded-lg text-white flex items-center justify-center gap-2 bg-teal-700 disabled:opacity-50"
        >
          {busy && <Loader2 className="w-4 h-4 animate-spin" />}
          {busy ? "Verifying…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
