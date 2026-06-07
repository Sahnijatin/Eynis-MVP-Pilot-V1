"use client";

import { useState } from "react";
import { useUser } from "@clerk/nextjs";
import { CheckCircle } from "lucide-react";

interface Props {
  token: string;
  email: string;
  hotelName: string;
  roleName: string;
  // Tenant primary color (resolved server-side from the host) so the accept
  // flow matches the white-label brand instead of a hardcoded teal (E-9).
  primaryColor: string;
}

export default function InviteAcceptClient({ token, email, hotelName, roleName, primaryColor }: Props) {
  const { isSignedIn, user } = useUser();
  const [fullName, setFullName] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  async function handleSubmit(e: React.SyntheticEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch(`/api/invitations/${token}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ fullName: fullName.trim() || undefined }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; tenantId?: string };
      if (!data.ok) {
        setError(data.error ?? "Something went wrong");
        return;
      }
      // If this browser is already signed in as the invited email, make the newly
      // joined workspace active so "Go to your workspace" lands there directly.
      const sameSession = isSignedIn && user?.primaryEmailAddress?.emailAddress?.toLowerCase() === email.toLowerCase();
      if (sameSession && data.tenantId) {
        await fetch("/api/workspace", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ tenantId: data.tenantId }),
        }).catch(() => { /* best-effort; switcher still works */ });
      }
      setSuccess(true);
    } catch {
      setError("Network error — please try again");
    } finally {
      setLoading(false);
    }
  }

  if (success) {
    // If this browser is already signed into Clerk with the SAME email as the
    // invite, jump straight to / — the smart-redirect will land them on the
    // dashboard with their assigned role+industry (no industry picker).
    const sameSession = isSignedIn && user?.primaryEmailAddress?.emailAddress?.toLowerCase() === email.toLowerCase();
    const nextHref = sameSession ? "/" : `/sign-up?email_address=${encodeURIComponent(email)}`;
    const nextLabel = sameSession ? "Go to your workspace" : "Create your sign-in";

    return (
      <div className="text-center">
        <div className="w-14 h-14 bg-teal-50 rounded-full flex items-center justify-center mx-auto mb-4">
          <CheckCircle className="w-7 h-7 text-teal-600" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-2">
          You&apos;re in!
        </h1>
        <p className="text-slate-500 text-sm mb-1">
          Your account has been created for
        </p>
        <p className="text-slate-800 font-medium text-sm mb-1">
          {hotelName}
        </p>
        <p className="text-xs text-slate-500 mb-6">
          Role: <span className="font-medium text-slate-600">{roleName}</span>
        </p>
        <a
          href={nextHref}
          className="block w-full text-center py-2.5 px-4 text-white rounded-lg text-sm font-medium transition-colors"
          style={{ background: primaryColor }}
        >
          {nextLabel}
        </a>
        {!sameSession && (
          <p className="mt-3 text-xs text-slate-500">
            Use <span className="font-medium text-slate-600">{email}</span> when signing up — it&apos;s already linked to your role.
          </p>
        )}
      </div>
    );
  }

  return (
    <>
      <div className="mb-6 text-center">
        <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center mx-auto mb-3">
          <CheckCircle className="w-5 h-5 text-teal-600" />
        </div>
        <h1 className="text-xl font-semibold text-slate-900 mb-1">
          You&apos;ve been invited
        </h1>
        <p className="text-slate-500 text-sm">
          Join <span className="font-medium text-slate-700">{hotelName}</span> as{" "}
          <span className="font-medium text-slate-700">{roleName}</span>
        </p>
      </div>

      <div className="bg-slate-50 rounded-lg px-4 py-3 mb-6 text-sm text-slate-600">
        Invitation sent to <span className="font-medium text-slate-800">{email}</span>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-700 mb-1.5">
            Your full name
          </label>
          <input
            type="text"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            placeholder="e.g. Rahul Sharma"
            className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-teal-500 focus:border-transparent"
          />
          <p className="mt-1 text-xs text-slate-500">
            Leave blank to use your email username
          </p>
        </div>

        {error && (
          <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={loading}
          className="w-full py-2.5 px-4 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          style={{ background: primaryColor }}
        >
          {loading ? "Setting up your account…" : "Accept Invitation"}
        </button>
      </form>
    </>
  );
}
