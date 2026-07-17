"use client";

import { useState } from "react";
import { Pencil, Check, X, Plus, Lock, Users, ShieldCheck } from "lucide-react";
import { Modal, Button, Field, Input, useToast } from "../ds";
import { jsonRequest } from "../../lib/client-request";
import {
  SYSTEM_ROLES,
  PERMISSION_LABELS,
  type Permission,
} from "../../lib/rbac";
import type { TeamRole } from "../../lib/data";

const ALL_PERMISSIONS = Object.keys(PERMISSION_LABELS) as Permission[];

interface DisplayRole {
  key: string;
  displayName: string;
  description: string;
  permissions: string[];
  isSystemRole: boolean;
  iconColor: string;
  iconBg: string;
  userCount: number;
  isCustom: boolean;
  apiId?: string;
}

interface Props {
  initialRoles: TeamRole[];
  plan: string;
  accentColor?: string;
  propertyLabel?: string;
  teamLabel?: string;
}

export default function RolesClient({
  initialRoles,
  plan,
  accentColor = "#0f766e",
  propertyLabel = "Property",
  teamLabel = "Team",
}: Props) {
  const SETTINGS_TABS = [
    { label: `Profile & ${propertyLabel}`, href: "/settings" },
    { label: teamLabel, href: "/settings/team" },
    { label: "Roles", href: "/settings/roles" },
    { label: "Billing", href: "/settings/billing" },
  ];
  const toast = useToast();
  const [displayRoles, setDisplayRoles] = useState<DisplayRole[]>(() => {
    const system: DisplayRole[] = SYSTEM_ROLES.map(r => {
      // Exact key match only — a substring match let a custom role like
      // "night_manager" hijack the "Manager" system card (wrong userCount, and
      // renaming the card would PUT to the custom role's id).
      const apiRole = initialRoles.find(ar => !ar.isCustom && ar.key === r.key.replace("org_", ""));
      return {
        key: r.key,
        displayName: apiRole?.displayName ?? r.defaultDisplayName,
        // The DB's permission set is what the API actually enforces — display
        // it when present rather than the client-side defaults.
        description: r.description,
        permissions: apiRole?.permissions?.length ? apiRole.permissions : r.permissions,
        isSystemRole: true,
        iconColor: r.iconColor,
        iconBg: r.iconBg,
        userCount: apiRole?.userCount ?? 0,
        isCustom: false,
        apiId: apiRole?.id,
      };
    });
    const custom: DisplayRole[] = initialRoles
      .filter(ar => ar.isCustom)
      .map(ar => ({
        key: ar.key,
        displayName: ar.displayName,
        description: "Custom role",
        permissions: ar.permissions,
        isSystemRole: false,
        iconColor: "#7c3aed",
        iconBg: "#f5f3ff",
        userCount: ar.userCount ?? 0,
        isCustom: true,
        apiId: ar.id,
      }));
    return [...system, ...custom];
  });

  const [editingKey, setEditingKey]           = useState<string | null>(null);
  const [editName, setEditName]               = useState("");
  const [saveLoading, setSaveLoading]         = useState(false);
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [customName, setCustomName]           = useState("");
  const [customKey, setCustomKey]             = useState("");
  const [customPerms, setCustomPerms]         = useState<Permission[]>([]);
  const [customLoading, setCustomLoading]     = useState(false);
  const [customError, setCustomError]         = useState<string | null>(null);
  const [expandedKey, setExpandedKey]         = useState<string | null>("org_admin");

  const isGrowth = plan !== "starter";

  function startEdit(role: DisplayRole) {
    setEditingKey(role.key);
    setEditName(role.displayName);
  }

  async function saveRename(key: string) {
    if (!editName.trim()) return;
    setSaveLoading(true);
    try {
      const role = displayRoles.find(r => r.key === key);
      if (role?.apiId) {
        const r = await jsonRequest(`/api/team/roles/${role.apiId}`, {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ displayName: editName.trim() }),
        });
        if (!r.ok) { toast.push(`Rename failed: ${r.error}`, "error"); return; }
      }
      setDisplayRoles(prev => prev.map(r => r.key === key ? { ...r, displayName: editName.trim() } : r));
      toast.push("Role renamed", "success");
    } finally {
      setSaveLoading(false);
      setEditingKey(null);
    }
  }

  function toggleCustomPerm(perm: Permission) {
    setCustomPerms(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]);
  }

  async function createCustomRole() {
    if (!customName.trim()) { setCustomError("Role name is required"); return; }
    setCustomLoading(true);
    setCustomError(null);
    try {
      const key = customKey.trim() || customName.trim().toLowerCase().replace(/\s+/g, "_");
      const r = await jsonRequest<{ role?: TeamRole }>("/api/team/roles", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ displayName: customName.trim(), key, permissions: customPerms }),
      });
      if (!r.ok) { setCustomError(r.error); return; }
      const data = r.data!;
      setDisplayRoles(prev => [...prev, {
        key,
        displayName: customName.trim(),
        description: "Custom role",
        permissions: customPerms,
        isSystemRole: false,
        iconColor: "#7c3aed",
        iconBg: "#f5f3ff",
        userCount: 0,
        isCustom: true,
        apiId: data.role?.id,
      }]);
      setShowCustomModal(false);
      setCustomName(""); setCustomKey(""); setCustomPerms([]);
    } finally {
      setCustomLoading(false);
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

      <div className="flex border-b border-slate-200 mb-6">
        {SETTINGS_TABS.map(tab => {
          const active = tab.href === "/settings/roles";
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

      <div className="flex items-center justify-between mb-5">
        <div>
          <h2 className="text-base font-semibold text-slate-800">Roles & Permissions</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            System roles cannot be deleted. Display names are customisable per property. Custom roles require Growth plan.
          </p>
        </div>
        <Button
          variant={isGrowth ? "primary" : "secondary"}
          onClick={() => { if (isGrowth) setShowCustomModal(true); }}
          disabled={!isGrowth}
          title={isGrowth ? "Create custom role" : "Upgrade to Growth to create custom roles"}
        >
          {isGrowth ? <Plus className="w-3.5 h-3.5" /> : <Lock className="w-3.5 h-3.5" />}
          {isGrowth ? "New Role" : "Custom Roles (Growth+)"}
        </Button>
      </div>

      <div className="space-y-3">
        {displayRoles.map(role => {
          const isExpanded = expandedKey === role.key;
          return (
            <div key={role.key} className="card overflow-hidden">
              <div className="flex items-center gap-3 cursor-pointer" onClick={() => setExpandedKey(isExpanded ? null : role.key)}>
                <div className="w-10 h-10 rounded-xl flex items-center justify-center text-sm font-bold shrink-0" style={{ background: role.iconBg, color: role.iconColor }}>
                  {role.displayName.slice(0, 2).toUpperCase()}
                </div>

                <div className="flex-1 min-w-0">
                  {editingKey === role.key ? (
                    <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                      <input
                        value={editName}
                        onChange={e => setEditName(e.target.value)}
                        onKeyDown={e => { if (e.key === "Enter") void saveRename(role.key); if (e.key === "Escape") setEditingKey(null); }}
                        className="border border-slate-200 rounded px-2 py-1 text-sm font-semibold focus:outline-none focus:ring-2 focus:ring-teal-500 w-44"
                        autoFocus
                      />
                      <button onClick={() => void saveRename(role.key)} disabled={saveLoading} className="text-teal-700 hover:text-teal-800"><Check className="w-4 h-4" /></button>
                      <button onClick={() => setEditingKey(null)} className="text-slate-500 hover:text-slate-600"><X className="w-4 h-4" /></button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-slate-800">{role.displayName}</span>
                      {role.isCustom && <span className="text-[10px] px-1.5 py-0.5 bg-purple-100 text-purple-700 rounded font-medium">CUSTOM</span>}
                      {role.isSystemRole && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-500 rounded font-medium flex items-center gap-0.5">
                          <Lock className="w-2.5 h-2.5" />SYSTEM
                        </span>
                      )}
                      <button onClick={e => { e.stopPropagation(); startEdit(role); }} className="text-slate-300 hover:text-slate-500 transition-colors" title="Rename">
                        <Pencil className="w-3 h-3" />
                      </button>
                    </div>
                  )}
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    <span className="text-[11px] font-mono text-slate-500">{role.key}</span>
                    <span className="flex items-center gap-0.5 text-xs text-slate-500"><Users className="w-3 h-3" />{role.userCount} user{role.userCount !== 1 ? "s" : ""}</span>
                    <span className="text-xs text-slate-500">{role.permissions.length}/{ALL_PERMISSIONS.length} permissions</span>
                  </div>
                </div>

                <div className="hidden md:block text-xs text-slate-500 max-w-xs text-right shrink-0">
                  {role.description}
                </div>
                <span className="text-slate-300 text-xs shrink-0">{isExpanded ? "▲" : "▼"}</span>
              </div>

              {isExpanded && (
                <div className="mt-4 pt-4 border-t border-slate-100">
                  <div className="flex items-center gap-1.5 mb-3">
                    <ShieldCheck className="w-3.5 h-3.5 text-teal-600" />
                    <span className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Permissions</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
                    {ALL_PERMISSIONS.map(perm => {
                      const granted = role.permissions.includes(perm);
                      return (
                        <div
                          key={perm}
                          className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-medium"
                          style={granted ? { background: role.iconBg, color: role.iconColor } : { background: "#f8fafc", color: "#cbd5e1" }}
                        >
                          <span className="text-sm leading-none shrink-0">{granted ? "✓" : "—"}</span>
                          <span>{PERMISSION_LABELS[perm]}</span>
                        </div>
                      );
                    })}
                  </div>
                  {role.isSystemRole && (
                    <p className="text-[11px] text-slate-500 mt-3 flex items-center gap-1">
                      <Lock className="w-3 h-3" />
                      System role — cannot be deleted. Only the display name can be customised.
                    </p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Custom Role Modal */}
      {showCustomModal && (
        <Modal
          title="Create Custom Role"
          width={520}
          onClose={() => setShowCustomModal(false)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setShowCustomModal(false)} disabled={customLoading}>Cancel</Button>
              <Button variant="primary" onClick={() => void createCustomRole()} disabled={customLoading}>{customLoading ? "Creating…" : "Create role"}</Button>
            </>
          }
        >
          <p className="text-xs text-slate-500 mb-3">Custom roles belong to your workspace and can be deleted.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Display name">
              <Input value={customName} onChange={e => setCustomName(e.target.value)} placeholder="e.g. Housekeeping" />
            </Field>
            <Field label="Key (auto)">
              <Input value={customKey} onChange={e => setCustomKey(e.target.value)} placeholder={customName.toLowerCase().replace(/\s+/g, "_") || "housekeeping"} style={{ fontFamily: "monospace" }} />
            </Field>
          </div>
          <Field label="Permissions">
            <div className="grid grid-cols-2 gap-2">
              {ALL_PERMISSIONS.map(perm => (
                <label key={perm} className="flex items-center gap-2 cursor-pointer p-1.5 rounded hover:bg-slate-50">
                  <input type="checkbox" checked={customPerms.includes(perm)} onChange={() => toggleCustomPerm(perm)} className="rounded text-teal-600 focus:ring-teal-500" />
                  <span className="text-xs text-slate-700">{PERMISSION_LABELS[perm]}</span>
                </label>
              ))}
            </div>
          </Field>
          {customError && <p className="text-sm text-red-600 bg-red-50 px-3 py-2 rounded-lg">{customError}</p>}
        </Modal>
      )}
    </div>
  );
}
