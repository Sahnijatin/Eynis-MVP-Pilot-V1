"use client";

import { useEffect, useState, useRef } from "react";
import { AlertCircle, Clock, ChevronRight } from "lucide-react";

interface FeedItem {
  id: string;
  category: string;
  status: string;
  summary: string;
  priority: string;
  createdAt: string;
  guestName?: string;
  source?: string;
  guest?: { fullName: string } | null;
  assignedTo?: { fullName: string } | null;
}

const categoryColor: Record<string, string> = {
  housekeeping: "badge-teal",
  maintenance: "badge-amber",
  fnb: "badge-red",
  concierge: "badge-blue",
  front_desk: "badge-slate"
};

const categoryLabel: Record<string, string> = {
  housekeeping: "HOUSEKEEPING",
  maintenance: "MAINTENANCE",
  fnb: "IN-ROOM DINING",
  concierge: "CONCIERGE",
  front_desk: "FRONT DESK"
};

const statusColor: Record<string, string> = {
  open: "badge-green",
  accepted: "badge-blue",
  escalated: "badge-red",
  resolved: "badge-slate"
};

const statusLabel: Record<string, string> = {
  open: "NEW",
  accepted: "ASSIGNED",
  escalated: "ESCALATED",
  resolved: "RESOLVED"
};

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins} mins ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

function getInitials(name?: string) {
  if (!name) return "??";
  return name.split(" ").map(w => w[0]).join("").slice(0, 2);
}

export function LiveFeedSSE({ initialItems }: { initialItems: FeedItem[] }) {
  const [items, setItems] = useState<FeedItem[]>(initialItems);
  const [connected, setConnected] = useState(false);
  const [newCount, setNewCount] = useState(0);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    // The reconnect timer must be tracked and cleared on unmount — otherwise a
    // navigation during the 5s backoff lets connect() run after unmount, opening
    // an EventSource nothing will ever close (and each error loop stacks more).
    let disposed = false;
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

    const connect = () => {
      if (disposed) return;
      const es = new EventSource("/api/sse");
      esRef.current = es;

      es.onopen = () => setConnected(true);

      es.onmessage = (e) => {
        try {
          const event = JSON.parse(e.data as string) as {
            type: string;
            data: FeedItem & { status: string };
          };

          if (event.type === "sr_created") {
            setItems(prev => [event.data, ...prev].slice(0, 8));
            setNewCount(n => n + 1);
          } else if (event.type === "sr_updated") {
            setItems(prev =>
              prev.map(item =>
                item.id === event.data.id ? { ...item, status: event.data.status } : item
              )
            );
          }
        } catch { /* ignore parse errors */ }
      };

      es.onerror = () => {
        setConnected(false);
        es.close();
        // Reconnect after 5s
        if (reconnectTimer) clearTimeout(reconnectTimer);
        reconnectTimer = setTimeout(connect, 5000);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      esRef.current?.close();
    };
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h3 className="card-title mb-0">Live Request Feed</h3>
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${connected ? "bg-ok-solid animate-pulse" : "bg-slate-300"}`} />
            <span className="text-[10px] text-fg-muted uppercase tracking-wide">{connected ? "Live" : "Connecting..."}</span>
          </div>
          {newCount > 0 && (
            <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold text-white" style={{ background: "var(--color-primary, #0f766e)" }}>
              +{newCount} new
            </span>
          )}
        </div>
        <a href="/queue" className="text-sm font-medium flex items-center gap-1" style={{ color: "var(--color-teal)" }}>
          View All <ChevronRight className="w-3.5 h-3.5" />
        </a>
      </div>

      <div className="space-y-2">
        {items.slice(0, 4).map((item) => {
          const guestName = item.guest?.fullName ?? item.guestName;
          return (
            <div key={item.id} className="flex items-center gap-3 p-3 rounded-lg border border-line hover:bg-surface-inset transition-colors">
              <div className="w-10 h-10 rounded-lg bg-surface-inset flex items-center justify-center text-xs font-bold text-fg-muted shrink-0">
                {getInitials(guestName)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-fg truncate">{item.summary}</div>
                <div className="flex items-center gap-2 mt-0.5">
                  <span className={`badge text-[10px] ${categoryColor[item.category] ?? "badge-slate"}`}>
                    {categoryLabel[item.category] ?? item.category.toUpperCase()}
                  </span>
                  <span className="text-xs text-fg-muted">{timeAgo(item.createdAt)}</span>
                </div>
              </div>
              <span className={`badge ${statusColor[item.status] ?? "badge-slate"}`}>
                {statusLabel[item.status] ?? item.status.toUpperCase()}
              </span>
            </div>
          );
        })}
        {items.length === 0 && (
          <div className="text-center py-8 text-fg-muted text-sm flex flex-col items-center gap-2">
            <Clock className="w-5 h-5" />
            No active requests right now
          </div>
        )}
      </div>

      {items.length === 0 && connected && (
        <div className="mt-3 p-2 rounded-lg bg-ok-bg border border-ok-border text-xs text-ok text-center">
          Watching for new requests — WhatsApp messages will appear here instantly
        </div>
      )}
    </div>
  );
}
