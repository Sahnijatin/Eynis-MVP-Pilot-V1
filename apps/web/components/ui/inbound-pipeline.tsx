import { Suspense } from "react";
import { MessageSquare, CheckCircle2, XCircle, Clock, Zap, ChevronRight } from "lucide-react";
import { fetchConnectorEvents } from "../../lib/data";

const SENTIMENT_COLORS: Record<string, string> = {
  positive: "text-emerald-400",
  negative: "text-red-400",
  neutral: "text-slate-500"
};

const SENTIMENT_DOTS: Record<string, string> = {
  positive: "bg-emerald-400",
  negative: "bg-red-400",
  neutral: "bg-slate-400"
};

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-500 font-bold",
  high: "text-amber-500 font-semibold",
  normal: "text-slate-500"
};

const PRIORITY_BADGES: Record<string, string> = {
  urgent: "badge badge-red",
  high: "badge badge-amber",
  normal: "badge badge-slate"
};

const CATEGORY_LABELS: Record<string, string> = {
  housekeeping: "HOUSEKEEPING",
  maintenance: "MAINTENANCE",
  fnb: "F&B",
  concierge: "CONCIERGE",
  front_desk: "FRONT DESK",
  other: "OTHER"
};

const CONNECTOR_LABELS: Record<string, { label: string; color: string }> = {
  whatsapp_twilio: { label: "WhatsApp · Twilio", color: "#25d366" },
  whatsapp_interakt: { label: "WhatsApp · Interakt", color: "#25d366" },
  whatsapp_generic: { label: "WhatsApp", color: "#25d366" }
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  return `${Math.floor(m / 60)}h ago`;
}

async function PipelineContent() {
  let events: Awaited<ReturnType<typeof fetchConnectorEvents>>["items"] = [];
  let total = 0;
  try {
    const data = await fetchConnectorEvents(8);
    events = data.items ?? [];
    total = data.page?.total ?? 0;
  } catch {
    return <div className="text-xs text-slate-500 py-4 text-center">Unable to load pipeline data</div>;
  }

  if (events.length === 0) {
    return (
      <div className="text-center py-8">
        <MessageSquare className="w-8 h-8 text-slate-300 mx-auto mb-2" />
        <p className="text-sm text-slate-500">No inbound events yet</p>
        <p className="text-xs text-slate-500 mt-1">Events appear here when customers message via WhatsApp</p>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {events.map((ev) => {
        const connector = CONNECTOR_LABELS[ev.connectorKey] ?? { label: ev.connectorKey, color: "#94a3b8" };
        const replySent = ev.replyStatus === "sent";
        const replyFailed = ev.replyStatus?.startsWith("failed") || ev.replyStatus?.startsWith("error");

        return (
          <div key={ev.id} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100 hover:bg-slate-50 transition-colors">
            {/* Source icon */}
            <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 mt-0.5"
              style={{ background: `${connector.color}18` }}>
              <MessageSquare className="w-4 h-4" style={{ color: connector.color }} />
            </div>

            {/* Content */}
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <span className="text-xs font-semibold text-slate-700 truncate">{ev.guestName ?? ev.guestPhone ?? "Unknown"}</span>
                <span className="text-[9px] text-slate-500 shrink-0">{timeAgo(ev.createdAt)}</span>
              </div>

              {ev.aiSummary && (
                <p className="text-xs text-slate-600 truncate mb-1.5">{ev.aiSummary}</p>
              )}

              <div className="flex items-center gap-1.5 flex-wrap">
                {/* Source */}
                <span className="text-[9px] font-medium px-1.5 py-0.5 rounded-full" style={{ background: `${connector.color}15`, color: connector.color }}>
                  {connector.label}
                </span>

                {/* Category */}
                {ev.aiCategory && (
                  <span className="badge badge-teal text-[9px]">{CATEGORY_LABELS[ev.aiCategory] ?? ev.aiCategory.toUpperCase()}</span>
                )}

                {/* Priority */}
                {ev.aiPriority && ev.aiPriority !== "normal" && (
                  <span className={`text-[9px] ${PRIORITY_BADGES[ev.aiPriority] ?? "badge badge-slate"}`}>{ev.aiPriority.toUpperCase()}</span>
                )}

                {/* Sentiment dot */}
                {ev.aiSentiment && (
                  <span className={`w-1.5 h-1.5 rounded-full inline-block ${SENTIMENT_DOTS[ev.aiSentiment] ?? "bg-slate-400"}`} title={`Sentiment: ${ev.aiSentiment}`} />
                )}

                {/* AI provider badge */}
                {ev.aiProvider && ev.aiProvider !== "keyword" && (
                  <span className="text-[9px] text-slate-500">via {ev.aiProvider === "openai" ? "OpenAI" : "Claude"}</span>
                )}
              </div>
            </div>

            {/* Right: SR + reply status */}
            <div className="flex flex-col items-end gap-1 shrink-0">
              {ev.serviceRequestId && (
                <span className="text-[9px] font-mono text-teal-600 bg-teal-50 px-1.5 py-0.5 rounded">SR created</span>
              )}
              {replySent ? (
                <span className="flex items-center gap-1 text-[9px] text-emerald-600">
                  <CheckCircle2 className="w-3 h-3" /> replied
                </span>
              ) : replyFailed ? (
                <span className="flex items-center gap-1 text-[9px] text-red-400">
                  <XCircle className="w-3 h-3" /> no reply
                </span>
              ) : (
                <span className="flex items-center gap-1 text-[9px] text-slate-500">
                  <Clock className="w-3 h-3" /> pending
                </span>
              )}
            </div>
          </div>
        );
      })}

      {total > 8 && (
        <div className="text-center pt-1">
          <span className="text-xs text-slate-500">{total - 8} more events not shown</span>
        </div>
      )}
    </div>
  );
}

function PipelineSkeleton() {
  return (
    <div className="space-y-2 animate-pulse">
      {[0, 1, 2, 3].map((i) => (
        <div key={i} className="flex items-start gap-3 p-3 rounded-xl border border-slate-100">
          <div className="w-8 h-8 rounded-lg bg-slate-100 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 bg-slate-200 rounded" />
            <div className="h-2.5 w-4/5 bg-slate-100 rounded" />
            <div className="flex gap-1.5">
              <div className="h-4 w-20 bg-slate-100 rounded-full" />
              <div className="h-4 w-16 bg-slate-100 rounded-full" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

export function InboundPipeline() {
  return (
    <div className="card">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <div className="w-6 h-6 rounded-lg flex items-center justify-center" style={{ background: "#25d36618" }}>
            <Zap className="w-3.5 h-3.5" style={{ color: "#25d366" }} />
          </div>
          <h3 className="card-title mb-0">Inbound Pipeline</h3>
          <span className="badge badge-green text-[9px]">Live</span>
        </div>
        <a href="/queue" className="text-sm font-medium flex items-center gap-1" style={{ color: "var(--color-teal)" }}>
          All requests <ChevronRight className="w-3.5 h-3.5" />
        </a>
      </div>
      <Suspense fallback={<PipelineSkeleton />}>
        <PipelineContent />
      </Suspense>
    </div>
  );
}
