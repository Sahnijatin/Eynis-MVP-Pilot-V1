"use client";

import { useState } from "react";
import { UserPlus, Copy, Check, X, ChevronDown } from "lucide-react";
import type { TeamUser, TeamRole } from "../../lib/data";
import { Modal, TableEmpty } from "../ds";

const ROLE_COLORS: Record<string, string> = {
  admin: "badge-red",
  manager: "badge-blue",
  supervisor: "badge-amber",
  agent: "badge-green",
  viewer: "badge-slate",
};

interface Props {
  initialUsers: TeamUser[];
  usedSeats: number;
  maxSeats: number;
  roles: TeamRole[];
  accentColor?: string;
  propertyLabel?: string;
  teamLabel?: string;
  industryName?: string;
}

export default function TeamClient({
  initialUsers,
  usedSeats,
  maxSeats,
  roles,
  accentColor = "#0f766e",
  propertyLabel = "Property",
  teamLabel = "Team",
  industryName = "Workspace",
}: Props) {
  const settingsTabs = [
    { label: `Profile & ${propertyLabel}`, href: "/settings" },
    { label: teamLabel, href: "/settings/team" },
    { label: "Roles", href: "/settings/roles" },
    { label: "Billing", href: "/settings/billing" },
  ];
  const [users, setUsers] = useState<TeamUser[]>(initialUsers);
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteRoleId, setInviteRoleId] = useState(roles[1]?.id ?? "");
  const [inviteLoading, setInviteLoading] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [inviteError, setInviteError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [changingRoleFor, setChangingRoleFor] = useState<string | null>(null);

  const seatPct = Math.min(100, Math.round((usedSeats / maxSeats) * 100));

  async function sendInvite() {
    if (!inviteEmail.trim()) { setInviteError("Email is required"); return; }
    setInviteLoading(true);
    setInviteError(null);
    try {
      const res = await fetch("/api/team/invitations", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: inviteEmail.trim(), roleId: inviteRoleId }),
      });
      const data = (await res.json()) as { ok: boolean; inviteUrl?: string; error?: string };
      if (!data.ok) { setInviteError(data.error ?? "Failed to send invite"); return; }
      setInviteLink(data.inviteUrl ?? null);
    } catch {
      setInviteError("Network error — try again");
    } finally {
      setInviteLoading(false);
    }
  }

  function copyLink() {
    if (!inviteLink) return;
    void navigator.clipboard.writeText(inviteLink);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }

  function closeInviteModal() {
    setShowInviteModal(false);
    setInviteEmail("");
    setInviteLink(null);
    setInviteError(null);
  }

  async function toggleActive(user: TeamUser) {
    setActionLoading(user.id);
    try {
      const res = await fetch(`/api/team/users/${user.id}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ isActive: !user.isActive }),
      });
      const data = (await res.json()) as { ok: boolean; user?: TeamUser };
      if (data.ok && data.user) {
        setUsers(prev => prev.map(u => u.id === user.id ? { ...u, isActive: data.user!.isActive } : u));
      }
    } finally {
      setActionLoading(null);
    }
  }

  async function changeRole(userId: string, roleId: string) {
    setActionLoading(userId);
    try {
      const res = await fetch(`/api/team/users/${userId}`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ roleId }),
      });
      const data = (await res.json()) as { ok: boolean; user?: TeamUser };
      if (data.ok && data.user) {
        setUsers(prev => prev.map(u => u.id === userId ? { ...u, ...data.user } : u));
      }
    } finally {
      setActionLoading(null);
      setChangingRoleFor(null);
    }
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Settings</h1>
          <p className="page-subtitle">Manage your team, roles, and billing.</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        {settingsTabs.map((tab) => {
          const active = tab.href === "/settings/team";
          return (
            <a
              key={tab.href}
              href={tab.href}
              className="px-5 py-3 text-sm font-medium border-b-2 transition-colors"
              style={active
                ? { borderColor: accentColor, color: accentColor }
                : { borderColor: "transparent", color: "#64748b" }
              }
            >
              {tab.label}
            </a>
          );
        })}
      </div>

      <div className="space-y-5">
        {/* Seat usage bar */}
        <div className="card">
          <div className="flex items-center justify-between mb-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-800">Seat Usage</h3>
              <p className="text-xs text-slate-500 mt-0.5">
                {usedSeats} of {maxSeats} seats used
              </p>
            </div>
            <a href="/settings/billing" className="text-xs font-medium hover:underline" style={{ color: accentColor }}>
              Manage plan →
            </a>
          </div>
          <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all"
              style={{
                width: `${seatPct}%`,
                background: seatPct >= 90 ? "#ef4444" : seatPct >= 70 ? "#f59e0b" : accentColor,
              }}
            />
          </div>
        </div>

        {/* Team table */}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="text-base font-semibold text-slate-800">{teamLabel} Members</h3>
              <p className="text-xs text-slate-500 mt-0.5">Invite {teamLabel.toLowerCase()} and manage their access levels.</p>
            </div>
            <button
              onClick={() => setShowInviteModal(true)}
              className="px-3 py-2 text-sm font-medium rounded-lg text-white flex items-center gap-1.5"
              style={{ background: accentColor }}
            >
              <UserPlus className="w-3.5 h-3.5" /> Invite Member
            </button>
          </div>

          <div className="table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Member</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <div className="flex items-center gap-2.5">
                        <span className="w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-semibold shrink-0" style={{ background: accentColor }}>
                          {u.fullName.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase()}
                        </span>
                        <div>
                          <div className="text-sm font-medium text-slate-800">{u.fullName}</div>
                          <div className="text-xs text-slate-500">{u.email}</div>
                        </div>
                      </div>
                    </td>
                    <td>
                      {changingRoleFor === u.id ? (
                        <div className="flex items-center gap-1.5">
                          <select
                            defaultValue={u.roleId ?? ""}
                            onChange={(e) => void changeRole(u.id, e.target.value)}
                            className="text-xs border border-slate-200 rounded px-2 py-1 focus:outline-none focus:ring-1 focus:ring-teal-500"
                            autoFocus
                          >
                            {roles.map(r => (
                              <option key={r.id} value={r.id}>{r.displayName}</option>
                            ))}
                          </select>
                          <button onClick={() => setChangingRoleFor(null)} className="text-slate-500 hover:text-slate-600">
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      ) : (
                        <span className={`badge ${ROLE_COLORS[u.systemRole?.key ?? ""] ?? "badge-slate"}`}>
                          {u.systemRole?.displayName ?? u.role}
                        </span>
                      )}
                    </td>
                    <td>
                      <span className={`badge ${u.isActive ? "badge-green" : "badge-slate"}`}>
                        {u.isActive ? "Active" : "Inactive"}
                      </span>
                    </td>
                    <td>
                      <div className="flex items-center gap-3">
                        <button
                          onClick={() => setChangingRoleFor(u.id)}
                          className="text-xs text-slate-500 hover:text-teal-700 font-medium"
                        >
                          Change role
                        </button>
                        <button
                          onClick={() => void toggleActive(u)}
                          disabled={actionLoading === u.id}
                          className={`text-xs font-medium ${u.isActive ? "text-slate-500 hover:text-red-500" : "text-slate-500 hover:text-teal-700"} disabled:opacity-40`}
                        >
                          {actionLoading === u.id ? "…" : u.isActive ? "Deactivate" : "Reactivate"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {users.length === 0 && (
                  <TableEmpty colSpan={4} icon="👥" title="No team members yet"
                    description="Invite teammates to collaborate in your workspace." />
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* Invite Modal */}
      {showInviteModal && (
        <Modal title={`Invite ${teamLabel} Member`} onClose={closeInviteModal} width={448}>
          <div className="space-y-4">
              {!inviteLink ? (
                <>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Email Address
                    </label>
                    <input
                      type="email"
                      value={inviteEmail}
                      onChange={e => setInviteEmail(e.target.value)}
                      placeholder={`${teamLabel.toLowerCase().replace(/\s+/g, "")}@${industryName.toLowerCase().replace(/\s+/g, "").replace(/&/g, "")}.com`}
                      className="w-full px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2"
                      style={{ "--tw-ring-color": accentColor } as React.CSSProperties}
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Assign Role
                    </label>
                    <div className="relative">
                      <select
                        value={inviteRoleId}
                        onChange={e => setInviteRoleId(e.target.value)}
                        className="w-full appearance-none px-3 py-2.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 pr-8"
                        style={{ "--tw-ring-color": accentColor } as React.CSSProperties}
                      >
                        {roles.map(r => (
                          <option key={r.id} value={r.id}>{r.displayName}</option>
                        ))}
                      </select>
                      <ChevronDown className="absolute right-2.5 top-3 w-4 h-4 text-slate-500 pointer-events-none" />
                    </div>
                    <p className="text-xs text-slate-500 mt-1">
                      {roles.find(r => r.id === inviteRoleId)?.permissions.length ?? 0} permissions granted
                    </p>
                  </div>

                  {inviteError && (
                    <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{inviteError}</p>
                  )}

                  <button
                    onClick={() => void sendInvite()}
                    disabled={inviteLoading}
                    className="w-full py-2.5 text-sm font-medium text-white rounded-lg disabled:opacity-50 transition-colors"
                    style={{ background: accentColor }}
                  >
                    {inviteLoading ? "Generating link…" : "Generate Invite Link"}
                  </button>
                </>
              ) : (
                <div className="space-y-4">
                  <div className="flex items-center gap-2 text-green-700 bg-green-50 px-3 py-2 rounded-lg">
                    <Check className="w-4 h-4 shrink-0" />
                    <span className="text-sm font-medium">Invite link generated!</span>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">
                      Share this link
                    </label>
                    <div className="flex items-center gap-2">
                      <input
                        readOnly
                        value={inviteLink}
                        className="flex-1 px-3 py-2.5 border border-slate-200 rounded-lg text-xs text-slate-600 bg-slate-50 truncate"
                      />
                      <button
                        onClick={copyLink}
                        className="px-3 py-2.5 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                      >
                        {copied ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4 text-slate-500" />}
                      </button>
                    </div>
                    <p className="text-xs text-slate-500 mt-1.5">Link expires in 48 hours. Share it with the invitee directly.</p>
                  </div>
                  <button
                    onClick={closeInviteModal}
                    className="w-full py-2.5 text-sm font-medium border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50"
                  >
                    Done
                  </button>
                </div>
              )}
          </div>
        </Modal>
      )}
    </div>
  );
}
