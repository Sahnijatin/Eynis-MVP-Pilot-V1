import Link from "next/link";
import { CalendarDays, Users, AlertCircle, ChevronRight } from "lucide-react";
import { SmartInsights } from "./smart-insights";
import { fetchAppointments, fetchPatients } from "../../lib/data";

// Healthcare Command Centre (Wave 5) — real data: today's schedule from the
// Appointment model and follow-up status from the Patient model.

const STATUS_META: Record<string, { label: string; color: string; bg: string }> = {
  scheduled: { label: "Scheduled", color: "#64748b", bg: "#f1f5f9" },
  checked_in: { label: "Checked In", color: "#059669", bg: "#d1fae5" },
  waiting: { label: "Waiting", color: "#d97706", bg: "#fef3c7" },
  in_progress: { label: "In Progress", color: "#1d4ed8", bg: "#eff6ff" },
  completed: { label: "Completed", color: "#475569", bg: "#f1f5f9" },
  no_show: { label: "No Show", color: "#dc2626", bg: "#fee2e2" },
  cancelled: { label: "Cancelled", color: "#94a3b8", bg: "#f8fafc" },
};

const fmtTime = (iso: string) => new Date(iso).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });

export async function HealthcareDashboard() {
  const today = new Date().toISOString().slice(0, 10);
  const [appts, patients] = await Promise.all([fetchAppointments(today), fetchPatients()]);

  const list = appts.items;
  const inFlow = list.filter((a) => ["checked_in", "waiting", "in_progress"].includes(a.status)).length;
  const noShows = list.filter((a) => a.status === "no_show").length;
  const upcoming = [...list].filter((a) => !["completed", "cancelled", "no_show"].includes(a.status)).sort((a, b) => new Date(a.scheduledAt).getTime() - new Date(b.scheduledAt).getTime()).slice(0, 6);
  const followUps = patients.items.filter((p) => p.status === "overdue" || p.status === "lost_follow_up");

  return (
    <div>
      <SmartInsights industry="healthcare" />

      <div className="kpi-grid mb-5">
        <div className="card"><div className="kpi-label">Appointments Today</div><div className="kpi-value mt-1.5">{list.length}</div><div className="kpi-delta neutral mt-1.5">{list.filter((a) => a.status === "completed").length} completed</div></div>
        <div className="card"><div className="kpi-label">In Flow</div><div className="kpi-value mt-1.5">{inFlow}</div><div className="kpi-delta neutral mt-1.5">checked-in / waiting</div></div>
        <div className="card"><div className="kpi-label">Total Patients</div><div className="kpi-value mt-1.5">{patients.items.length}</div></div>
        <div className="card" style={{ borderTop: (noShows + followUps.length) > 0 ? "3px solid #f59e0b" : undefined }}><div className="kpi-label">Needs Attention</div><div className="kpi-value mt-1.5">{noShows + followUps.length}</div><div className="kpi-delta neutral mt-1.5">no-shows + overdue follow-ups</div></div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        <div className="card col-span-2">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2"><CalendarDays className="w-4 h-4" style={{ color: "#0891b2" }} /><h3 className="card-title mb-0">Today&apos;s Schedule</h3></div>
            <Link href="/appointments" className="text-xs font-medium flex items-center gap-1 hover:underline" style={{ color: "#0891b2" }}>View all <ChevronRight className="w-3 h-3" /></Link>
          </div>
          {upcoming.length === 0 ? (
            <div className="py-6 text-center text-sm text-fg-subtle">No appointments left today — add one from the Appointments page.</div>
          ) : (
            <div className="space-y-2">
              {upcoming.map((a) => {
                const s = STATUS_META[a.status] ?? STATUS_META.scheduled;
                return (
                  <div key={a.id} className="flex items-center gap-3 p-2.5 rounded-lg border border-line">
                    <span className="text-sm font-semibold text-fg-muted w-16">{fmtTime(a.scheduledAt)}</span>
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-sm text-fg">{a.patientName}</div>
                      <div className="text-xs text-fg-muted">{a.type || "Appointment"}{a.provider ? ` · ${a.provider}` : ""}</div>
                    </div>
                    <span className="badge text-xs" style={{ background: s.bg, color: s.color }}>{s.label}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="card">
          <div className="flex items-center gap-2 mb-3"><AlertCircle className="w-4 h-4 text-danger" /><h3 className="card-title mb-0">Follow-up Alerts</h3></div>
          {followUps.length === 0 ? (
            <div className="py-4 text-sm text-fg-subtle">No overdue follow-ups.</div>
          ) : (
            <div className="space-y-2">
              {followUps.slice(0, 6).map((p) => (
                <div key={p.id} className="p-2.5 rounded-lg bg-danger-bg border border-danger-border">
                  <div className="text-sm font-semibold text-danger">{p.name}</div>
                  <div className="text-xs text-danger mt-0.5">{p.condition || "Follow-up"}{p.status === "lost_follow_up" ? " · lost to follow-up" : " · overdue"}</div>
                </div>
              ))}
            </div>
          )}
          <Link href="/patients" className="mt-4 inline-flex items-center gap-1 text-sm font-medium text-fg-muted hover:text-fg">
            <Users className="w-4 h-4" /> Open patient records <ChevronRight className="w-3.5 h-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}
