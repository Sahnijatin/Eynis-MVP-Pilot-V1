"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronsUpDown, Plus, Building2, Loader2 } from "lucide-react";
import { ORG_ROLE_LABELS, type OrgRole } from "../../lib/rbac";
import type { WorkspaceSummary } from "../../lib/user-context";

const SYSTEM_KEY_TO_ORG: Record<string, OrgRole> = {
  admin: "org_admin", manager: "org_manager", supervisor: "org_supervisor", agent: "org_agent", viewer: "org_viewer",
};
const roleLabel = (key: string | null) => (key && SYSTEM_KEY_TO_ORG[key] ? ORG_ROLE_LABELS[SYSTEM_KEY_TO_ORG[key]] : "");

export function WorkspaceSwitcher({ workspaces, activeTenantId, accentColor }: { workspaces: WorkspaceSummary[]; activeTenantId: string | null; accentColor: string }) {
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const active = workspaces.find(w => w.tenantId === activeTenantId) ?? workspaces[0];
  if (!active) return null;

  async function switchTo(tenantId: string) {
    if (tenantId === activeTenantId) { setOpen(false); return; }
    setSwitching(tenantId);
    try {
      const res = await fetch("/api/workspace", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tenantId }),
      });
      if (res.ok) { window.location.assign("/dashboard"); return; }
    } catch { /* fall through */ }
    setSwitching(null);
  }

  return (
    <div className="px-3 mb-2 relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="w-full flex items-center gap-2 px-2.5 py-2 rounded-lg text-left transition-colors"
        style={{ background: "rgba(255,255,255,0.06)", border: "1px solid rgba(255,255,255,0.1)" }}
      >
        <div className="w-6 h-6 rounded flex items-center justify-center shrink-0" style={{ background: accentColor + "33" }}>
          <Building2 className="w-3.5 h-3.5" style={{ color: "#c8d8f0" }} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-[11px] font-semibold text-slate-200 truncate">{active.propertyName ?? "Workspace"}</div>
          <div className="text-[9px]" style={{ color: "#5a7a9a" }}>
            {workspaces.length > 1 ? `${workspaces.length} workspaces` : "Workspace"}
          </div>
        </div>
        <ChevronsUpDown className="w-3.5 h-3.5 shrink-0" style={{ color: "#5a7a9a" }} />
      </button>

      {open && (
        <div
          className="absolute left-3 right-3 top-full mt-1 z-50 rounded-lg overflow-hidden shadow-2xl"
          style={{ background: "#10243b", border: "1px solid rgba(255,255,255,0.12)" }}
        >
          <div className="max-h-64 overflow-y-auto py-1">
            {workspaces.map(w => {
              const isActive = w.tenantId === activeTenantId;
              return (
                <button
                  key={w.tenantId}
                  onClick={() => switchTo(w.tenantId)}
                  disabled={!!switching}
                  className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-white/5 disabled:opacity-60"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-[11px] font-semibold text-slate-200 truncate">{w.propertyName ?? "Workspace"}</div>
                    {roleLabel(w.roleKey) && <div className="text-[9px]" style={{ color: "#5a7a9a" }}>{roleLabel(w.roleKey)}</div>}
                  </div>
                  {switching === w.tenantId
                    ? <Loader2 className="w-3.5 h-3.5 animate-spin shrink-0" style={{ color: "#5a7a9a" }} />
                    : isActive ? <Check className="w-3.5 h-3.5 shrink-0" style={{ color: accentColor }} /> : null}
                </button>
              );
            })}
          </div>
          <a
            href="/onboarding?new=1"
            className="flex items-center gap-2 px-3 py-2 border-t hover:bg-white/5"
            style={{ borderColor: "rgba(255,255,255,0.1)", color: "#9ab0c8" }}
          >
            <Plus className="w-3.5 h-3.5" />
            <span className="text-[11px] font-semibold">Create new workspace</span>
          </a>
        </div>
      )}
    </div>
  );
}
