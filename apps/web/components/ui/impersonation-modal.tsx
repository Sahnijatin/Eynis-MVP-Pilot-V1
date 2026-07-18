"use client";

import { useEffect, useMemo, useState } from "react";
import { X, Search, UserCog, History, Loader2, ShieldCheck } from "lucide-react";
import { ORG_ROLE_LABELS, type OrgRole } from "../../lib/rbac";

interface TeamUser {
  id: string;
  fullName: string | null;
  email: string;
  isActive: boolean;
  systemRole: { key: string; displayName: string } | null;
}

interface RecentTarget {
  userId: string;
  email: string | null;
  roleKey: string | null;
}

const SYSTEM_KEY_TO_ORG: Record<string, OrgRole> = {
  admin: "org_admin", manager: "org_manager", supervisor: "org_supervisor", agent: "org_agent", viewer: "org_viewer",
};

function roleLabel(key: string | null | undefined): string {
  if (!key) return "—";
  const org = SYSTEM_KEY_TO_ORG[key];
  return org ? ORG_ROLE_LABELS[org] : key;
}

function initials(name: string | null, email: string): string {
  const src = (name && name.trim()) || email;
  const parts = src.split(/[\s@.]+/).filter(Boolean);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || src.slice(0, 2).toUpperCase();
}

export function ImpersonationModal({ accentColor, onClose }: { accentColor: string; onClose: () => void }) {
  const [users, setUsers] = useState<TeamUser[]>([]);
  const [recent, setRecent] = useState<RecentTarget[]>([]);
  const [currentUserId, setCurrentUserId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [startingId, setStartingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/impersonate", { cache: "no-store" })
      .then(r => r.json())
      .then((data: { ok: boolean; users?: TeamUser[]; recent?: RecentTarget[]; currentUserId?: string | null }) => {
        if (cancelled) return;
        if (data.ok) {
          setUsers(data.users ?? []);
          setRecent(data.recent ?? []);
          setCurrentUserId(data.currentUserId ?? null);
        } else {
          setError("Could not load users.");
        }
      })
      .catch(() => { if (!cancelled) setError("Could not load users."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  // Eligible targets: active users in the tenant, excluding yourself.
  const eligible = useMemo(
    () => users.filter(u => u.isActive && u.id !== currentUserId),
    [users, currentUserId],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return eligible;
    return eligible.filter(u =>
      (u.fullName ?? "").toLowerCase().includes(q) || u.email.toLowerCase().includes(q),
    );
  }, [eligible, query]);

  const recentUsers = useMemo(() => {
    const byId = new Map(eligible.map(u => [u.id, u]));
    return recent.map(r => byId.get(r.userId)).filter((u): u is TeamUser => !!u);
  }, [recent, eligible]);

  async function startImpersonation(userId: string) {
    setStartingId(userId);
    setError(null);
    try {
      const res = await fetch("/api/impersonate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ targetUserId: userId }),
      });
      const data = await res.json();
      if (!res.ok || !data.ok) {
        setError(data?.error ?? "Failed to start impersonation.");
        setStartingId(null);
        return;
      }
      // Full reload so server components re-render under the impersonation cookie.
      window.location.assign("/dashboard");
    } catch {
      setError("Failed to start impersonation.");
      setStartingId(null);
    }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4" style={{ background: "rgba(15,23,42,0.55)" }}>
      <div className="w-full max-w-md bg-surface rounded-2xl shadow-2xl overflow-hidden flex flex-col" style={{ maxHeight: "80vh" }}>
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-line">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: accentColor + "1a" }}>
              <UserCog className="w-4 h-4" style={{ color: accentColor }} />
            </div>
            <div>
              <div className="text-sm font-semibold text-fg">Impersonate a user</div>
              <div className="text-xs text-fg-muted">View the app exactly as they do</div>
            </div>
          </div>
          <button onClick={onClose} className="text-fg-muted hover:text-fg-muted" aria-label="Close">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Search */}
        <div className="px-5 pt-4">
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-line focus-within:border-line-strong">
            <Search className="w-4 h-4 text-fg-muted shrink-0" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by name or email…"
              className="flex-1 text-sm outline-none bg-transparent text-fg placeholder:text-fg-muted"
            />
          </div>
        </div>

        {error && (
          <div className="mx-5 mt-3 px-3 py-2 rounded-lg text-xs text-danger bg-danger-bg border border-danger-border">{error}</div>
        )}

        {/* Body */}
        <div className="px-5 py-4 overflow-y-auto flex-1">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-10 text-fg-muted text-sm">
              <Loader2 className="w-4 h-4 animate-spin" /> Loading users…
            </div>
          ) : (
            <>
              {!query && recentUsers.length > 0 && (
                <div className="mb-4">
                  <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                    <History className="w-3 h-3" /> Recent
                  </div>
                  <div className="flex flex-col gap-1">
                    {recentUsers.map(u => (
                      <UserRow key={"recent-" + u.id} user={u} accentColor={accentColor} starting={startingId === u.id} disabled={!!startingId} onSelect={() => startImpersonation(u.id)} />
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-1.5 mb-2 text-[11px] font-semibold uppercase tracking-wide text-fg-muted">
                <ShieldCheck className="w-3 h-3" /> {query ? "Results" : "All users"}
              </div>
              {filtered.length === 0 ? (
                <div className="py-8 text-center text-sm text-fg-muted">No matching users.</div>
              ) : (
                <div className="flex flex-col gap-1">
                  {filtered.map(u => (
                    <UserRow key={u.id} user={u} accentColor={accentColor} starting={startingId === u.id} disabled={!!startingId} onSelect={() => startImpersonation(u.id)} />
                  ))}
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function UserRow({ user, accentColor, starting, disabled, onSelect }: { user: TeamUser; accentColor: string; starting: boolean; disabled: boolean; onSelect: () => void }) {
  return (
    <button
      onClick={onSelect}
      disabled={disabled}
      className="flex items-center gap-3 px-2.5 py-2 rounded-lg text-left transition-colors hover:bg-surface-inset disabled:opacity-60 disabled:cursor-not-allowed"
    >
      <div className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold shrink-0" style={{ background: accentColor + "1a", color: accentColor }}>
        {initials(user.fullName, user.email)}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-fg truncate">{user.fullName || user.email}</div>
        <div className="text-xs text-fg-muted truncate">{user.email}</div>
      </div>
      <span className="text-[10px] font-semibold px-2 py-0.5 rounded-full shrink-0" style={{ background: "#f1f5f9", color: "#475569" }}>
        {roleLabel(user.systemRole?.key)}
      </span>
      {starting && <Loader2 className="w-4 h-4 animate-spin text-fg-muted shrink-0" />}
    </button>
  );
}
