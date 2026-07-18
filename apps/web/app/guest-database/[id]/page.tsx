import Link from "next/link";
import { fetchGuestProfile, fetchGuestIntelligence } from "../../../lib/data";
import {
  ArrowLeft, Star, Phone, MessageSquare, Bell,
  CheckCircle2, Clock, AlertCircle, Zap, ChevronRight
} from "lucide-react";

export const dynamic = "force-dynamic";

const categoryColor: Record<string, string> = {
  housekeeping: "badge-teal",
  maintenance: "badge-amber",
  fnb: "badge-red",
  concierge: "badge-blue",
  front_desk: "badge-slate"
};

const statusColor: Record<string, string> = {
  open: "badge-green",
  accepted: "badge-blue",
  escalated: "badge-red",
  resolved: "badge-slate"
};

const sentimentColor: Record<string, string> = {
  positive: "text-ok",
  neutral: "text-fg-muted",
  negative: "text-danger"
};

const vipColor: Record<string, string> = {
  priority: "bg-warn-solid",
  vip: "bg-accent",
  valued: "bg-info-solid",
  standard: "bg-slate-500"
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

export default async function GuestProfilePage({
  params
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const [profileData, aiData] = await Promise.allSettled([
    fetchGuestProfile(id),
    fetchGuestIntelligence(id, "claude")
  ]);

  const profile = profileData.status === "fulfilled" ? profileData.value : null;
  const guest = profile?.guest;
  const ai = aiData.status === "fulfilled" ? aiData.value : null;

  if (!guest) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-fg-muted">
        <AlertCircle className="w-10 h-10 mb-3" />
        <p className="text-lg font-semibold">Guest not found</p>
        <Link href="/guest-database" className="mt-4 text-sm font-medium" style={{ color: "var(--color-teal)" }}>← Back to Guest Database</Link>
      </div>
    );
  }

  const vipScore = ai?.intelligence?.vipScore ?? "standard";
  const openRequests = guest.serviceRequests.filter(r => r.status === "open" || r.status === "accepted" || r.status === "escalated").length;

  return (
    <div>
      {/* Header */}
      <div className="page-header">
        <div className="flex items-center gap-4">
          <Link href="/guest-database" className="p-2 rounded-lg hover:bg-surface-inset transition-colors">
            <ArrowLeft className="w-4 h-4 text-fg-muted" />
          </Link>
          <div className="flex items-center gap-3">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center text-white text-lg font-bold ${vipColor[vipScore] ?? "bg-slate-500"}`}>
              {guest.fullName.split(" ").map(w => w[0]).join("").slice(0, 2)}
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="page-title mb-0">{guest.fullName}</h1>
                {guest.segment === "VIP" && <Star className="w-4 h-4 text-warn fill-amber-400" />}
                <span className={`badge text-[10px] ${vipScore === "priority" ? "badge-amber" : vipScore === "vip" ? "badge-teal" : "badge-slate"}`}>
                  {vipScore.toUpperCase()}
                </span>
              </div>
              <p className="page-subtitle mb-0">{guest.phoneE164} · {guest.segment} · Member since {formatDate(guest.createdAt)}</p>
            </div>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="px-3 py-2 text-sm font-medium rounded-lg border border-line text-fg-muted hover:bg-surface-inset flex items-center gap-1.5">
              <MessageSquare className="w-3.5 h-3.5" /> Send WhatsApp
            </button>
            <button className="px-3 py-2 text-sm font-semibold rounded-lg text-white flex items-center gap-1.5" style={{ background: "#0f766e" }}>
              <Bell className="w-3.5 h-3.5" /> Create Request
            </button>
          </div>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-4 gap-4 mb-5">
        <div className="card">
          <div className="kpi-label">Total Visits</div>
          <div className="kpi-value mt-1.5">{guest.visitCount}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Spend</div>
          <div className="kpi-value mt-1.5">₹{guest.totalSpendInr.toLocaleString("en-IN")}</div>
        </div>
        <div className="card">
          <div className="kpi-label">Total Requests</div>
          <div className="kpi-value mt-1.5">{guest.serviceRequests.length}</div>
          {openRequests > 0 && (
            <div className="kpi-delta down mt-1 flex items-center gap-1"><AlertCircle className="w-3 h-3" />{openRequests} open</div>
          )}
        </div>
        <div className="card" style={guest.currentStay ? { borderTop: "3px solid #0f766e" } : {}}>
          <div className="kpi-label">Current Stay</div>
          {guest.currentStay ? (
            <>
              <div className="kpi-value mt-1.5">Room {guest.currentStay.roomNumber}</div>
              <div className="kpi-delta neutral mt-1">Check-in: {formatDate(guest.currentStay.checkInAt)}</div>
            </>
          ) : (
            <div className="text-sm text-fg-muted mt-2">Not currently staying</div>
          )}
        </div>
      </div>

      {/* Two-column layout */}
      <div className="grid grid-cols-3 gap-4 mb-4">
        {/* AI Intelligence Brief */}
        <div className="col-span-1 flex flex-col gap-4">
          <div className="card flex-1" style={{ borderLeft: "3px solid #0f766e" }}>
            <div className="flex items-center gap-2 mb-3">
              <Zap className="w-4 h-4 text-accent-text" />
              <h3 className="card-title mb-0">AI Guest Intelligence</h3>
            </div>
            {ai?.intelligence ? (
              <div className="space-y-3">
                <p className="text-sm text-fg leading-relaxed">{ai.intelligence.arrivalBrief}</p>
                {ai.intelligence.keyPreferences.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">Key Preferences</div>
                    <div className="flex flex-wrap gap-1.5">
                      {ai.intelligence.keyPreferences.map((p, i) => (
                        <span key={i} className="px-2 py-0.5 rounded-md text-xs bg-accent-bg text-accent-text border border-accent-line">{p}</span>
                      ))}
                    </div>
                  </div>
                )}
                {ai.intelligence.upsellOpportunities.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-muted mb-1.5">Upsell Opportunities</div>
                    <div className="space-y-1">
                      {ai.intelligence.upsellOpportunities.map((u, i) => (
                        <div key={i} className="text-xs text-fg-muted flex items-start gap-1.5"><ChevronRight className="w-3 h-3 text-accent-text mt-0.5 shrink-0" />{u}</div>
                      ))}
                    </div>
                  </div>
                )}
                {ai.intelligence.attentionFlags.length > 0 && (
                  <div>
                    <div className="text-[10px] font-semibold uppercase tracking-wider text-danger mb-1.5">Attention Flags</div>
                    <div className="space-y-1">
                      {ai.intelligence.attentionFlags.map((f, i) => (
                        <div key={i} className="text-xs text-danger flex items-start gap-1.5"><AlertCircle className="w-3 h-3 mt-0.5 shrink-0" />{f}</div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="text-sm text-fg-muted text-center py-6">AI brief unavailable — connect an AI provider in Integrations</div>
            )}
          </div>

          {/* Stay History */}
          <div className="card">
            <h3 className="card-title">Stay History</h3>
            {guest.stays.length === 0 ? (
              <div className="text-sm text-fg-muted">No stays recorded</div>
            ) : (
              <div className="space-y-2">
                {guest.stays.map((stay) => (
                  <div key={stay.id} className="flex items-center justify-between py-2 border-b border-line last:border-0">
                    <div>
                      <div className="text-sm font-medium text-fg">Room {stay.roomNumber}</div>
                      <div className="text-xs text-fg-muted">{formatDate(stay.checkInAt)} → {formatDate(stay.checkOutAt)}</div>
                    </div>
                    <span className="badge badge-slate text-[10px]">STAYED</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Requests + Connector Events */}
        <div className="col-span-2 flex flex-col gap-4">
          {/* Service Requests */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="card-title mb-0">Service Requests</h3>
              <span className="text-xs text-fg-muted">{guest.serviceRequests.length} total</span>
            </div>
            {guest.serviceRequests.length === 0 ? (
              <div className="text-sm text-fg-muted text-center py-6">No requests from this guest</div>
            ) : (
              <div className="space-y-2">
                {guest.serviceRequests.map((sr) => (
                  <div key={sr.id} className="flex items-start gap-3 p-3 rounded-lg border border-line hover:bg-surface-inset transition-colors">
                    <div className="mt-0.5">
                      {sr.status === "resolved" ? (
                        <CheckCircle2 className="w-4 h-4 text-ok" />
                      ) : sr.status === "escalated" ? (
                        <AlertCircle className="w-4 h-4 text-danger" />
                      ) : (
                        <Clock className="w-4 h-4 text-warn" />
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-fg truncate">{sr.summary}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        <span className={`badge text-[10px] ${categoryColor[sr.category] ?? "badge-slate"}`}>{sr.category.toUpperCase()}</span>
                        <span className={`badge text-[10px] ${statusColor[sr.status] ?? "badge-slate"}`}>{sr.status.toUpperCase()}</span>
                        {sr.assignedTo && <span className="text-xs text-fg-muted">→ {sr.assignedTo.fullName}</span>}
                        <span className="text-xs text-fg-muted">{timeAgo(sr.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* WhatsApp / Connector Events */}
          <div className="card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="card-title mb-0">Inbound Messages</h3>
              <Phone className="w-4 h-4 text-fg-muted" />
            </div>
            {guest.connectorEvents.length === 0 ? (
              <div className="text-sm text-fg-muted text-center py-6">No inbound messages from this guest</div>
            ) : (
              <div className="space-y-2">
                {guest.connectorEvents.map((ev) => (
                  <div key={ev.id} className="flex items-start gap-3 p-3 rounded-lg border border-line hover:bg-surface-inset transition-colors">
                    <div className="w-8 h-8 rounded-lg bg-ok-bg flex items-center justify-center shrink-0">
                      <MessageSquare className="w-4 h-4 text-ok" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-fg truncate">{ev.aiSummary ?? "Message received"}</div>
                      <div className="flex items-center gap-2 mt-0.5 flex-wrap">
                        {ev.aiCategory && <span className={`badge text-[10px] ${categoryColor[ev.aiCategory] ?? "badge-slate"}`}>{ev.aiCategory.toUpperCase()}</span>}
                        {ev.aiSentiment && (
                          <span className={`text-xs font-medium flex items-center gap-0.5 ${sentimentColor[ev.aiSentiment] ?? "text-fg-muted"}`}>
                            ● {ev.aiSentiment}
                          </span>
                        )}
                        <span className="text-xs text-fg-muted">{timeAgo(ev.createdAt)}</span>
                        {ev.replyStatus === "sent" && <span className="text-xs text-ok">replied</span>}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
