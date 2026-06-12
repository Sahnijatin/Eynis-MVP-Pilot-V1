"use client";

// Discover — the local-discovery experience: an interactive map of curated
// places with an AI concierge, category filters, and (for curators) place
// management + the Golden-Pin promotion flow.

import { useCallback, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  MapPin, Sparkles, Search, Star, Crown, Globe, Phone, Plus, Send,
  Compass, X, Wand2, Trash2, MessageSquareText, ListFilter,
} from "lucide-react";
import {
  PLACE_CATEGORIES, GOLDEN_TIERS, GOLDEN_TIER_PRICING_INR,
  type Place, type GoldenTier,
} from "@eynis/shared";
import {
  Button, Card, Badge, Input, Select, Textarea, Field, Modal, Spinner,
  ToastProvider, useToast, tokens as t,
} from "../ds";
import { CATEGORY_COLOR, CATEGORY_EMOJI } from "./discover-map";

const DiscoverMap = dynamic(() => import("./discover-map"), {
  ssr: false,
  loading: () => (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "center", height: "100%", background: "#e2e8f0", color: t.color.textMuted }}>
      <Spinner /> <span style={{ marginLeft: 10 }}>Loading map…</span>
    </div>
  ),
});

const CATEGORY_LABEL: Record<string, string> = {
  restaurant: "Restaurants", cafe: "Cafés", attraction: "Attractions",
  shopping: "Shopping", nightlife: "Nightlife", hotel: "Stays",
  service: "Services", outdoors: "Outdoors", other: "Other",
};

const SUGGESTED_PROMPTS = [
  "Where can I grab great coffee?",
  "Plan a fun evening out",
  "Family-friendly things to do",
  "Best spot for sunset",
];

interface ChatMessage {
  role: "user" | "assistant";
  content: string;
  questions?: string[];
  recommendations?: Array<{ placeId: string; reason: string }>;
}

function priceLabel(level: number | null): string {
  return level ? "₹".repeat(Math.max(1, Math.min(4, level))) : "";
}

export default function DiscoverClient({
  initialPlaces, accent, canManage,
}: { initialPlaces: Place[]; accent: string; canManage: boolean }) {
  return (
    <ToastProvider>
      <DiscoverInner initialPlaces={initialPlaces} accent={accent} canManage={canManage} />
    </ToastProvider>
  );
}

function DiscoverInner({ initialPlaces, accent, canManage }: { initialPlaces: Place[]; accent: string; canManage: boolean }) {
  const toast = useToast();
  const [places, setPlaces] = useState<Place[]>(initialPlaces);
  const [category, setCategory] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<"places" | "concierge">("places");

  // Concierge state
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const [recommendedIds, setRecommendedIds] = useState<string[]>([]);
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Management modals
  const [showAdd, setShowAdd] = useState(false);
  const [goldenFor, setGoldenFor] = useState<Place | null>(null);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return places.filter((p) => {
      if (category !== "all" && p.category !== category) return false;
      if (q && ![p.name, p.description ?? "", p.category, ...p.tags].join(" ").toLowerCase().includes(q)) return false;
      return true;
    });
  }, [places, category, search]);

  const selected = useMemo(() => places.find((p) => p.id === selectedId) ?? null, [places, selectedId]);
  const goldenCount = useMemo(() => places.filter((p) => p.isGolden).length, [places]);

  const refreshPlaces = useCallback(async () => {
    const res = await fetch("/api/places", { cache: "no-store" });
    const data = (await res.json()) as { ok: boolean; items?: Place[] };
    if (data.ok && data.items) setPlaces(data.items);
  }, []);

  const select = useCallback((p: Place) => { setSelectedId(p.id); }, []);

  // ── Concierge ───────────────────────────────────────────────────────────────
  const ask = useCallback(async (text: string) => {
    const query = text.trim();
    if (!query || thinking) return;
    setTab("concierge");
    const history = chat.map((m) => ({ role: m.role, content: m.content }));
    setChat((c) => [...c, { role: "user", content: query }]);
    setDraft("");
    setThinking(true);
    try {
      const res = await fetch("/api/places/concierge", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ query, history }),
      });
      const data = (await res.json()) as {
        ok: boolean; reply?: string; questions?: string[];
        recommendations?: Array<{ placeId: string; reason: string }>; error?: string;
      };
      if (!data.ok) { toast.push(data.error ?? "Concierge unavailable", "error"); setThinking(false); return; }
      const recs = data.recommendations ?? [];
      setChat((c) => [...c, { role: "assistant", content: data.reply ?? "", questions: data.questions, recommendations: recs }]);
      setRecommendedIds(recs.map((r) => r.placeId));
      if (recs.length > 0) setSelectedId(recs[0]!.placeId);
      setTimeout(() => chatEndRef.current?.scrollIntoView({ behavior: "smooth" }), 50);
    } catch {
      toast.push("Couldn't reach the concierge", "error");
    } finally {
      setThinking(false);
    }
  }, [chat, thinking, toast]);

  // ── Render ──────────────────────────────────────────────────────────────────
  return (
    <div className="discover-shell">
      {/* Sidebar */}
      <div className="discover-sidebar">
        <div style={{ padding: "16px 16px 12px", borderBottom: `1px solid ${t.color.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <Compass size={22} color={accent} />
            <h1 style={{ margin: 0, fontSize: 20, fontWeight: 700, color: t.color.text }}>Discover</h1>
            {canManage && (
              <Button size="sm" variant="secondary" style={{ marginLeft: "auto" }} onClick={() => setShowAdd(true)}>
                <Plus size={14} /> Add
              </Button>
            )}
          </div>
          <p style={{ margin: "6px 0 0", fontSize: 13, color: t.color.textMuted }}>
            {places.length} places nearby{goldenCount > 0 ? ` · ${goldenCount} featured` : ""}. Explore the map or ask the concierge.
          </p>

          {/* Tabs */}
          <div style={{ display: "flex", gap: 6, marginTop: 12 }}>
            <TabButton active={tab === "places"} onClick={() => setTab("places")} icon={<ListFilter size={14} />} label="Places" accent={accent} />
            <TabButton active={tab === "concierge"} onClick={() => setTab("concierge")} icon={<Sparkles size={14} />} label="AI Concierge" accent={accent} />
          </div>
        </div>

        {tab === "places" ? (
          <div className="discover-scroll">
            {/* Search + filters */}
            <div style={{ padding: "12px 16px", position: "sticky", top: 0, background: t.color.surface, zIndex: 2, borderBottom: `1px solid ${t.color.border}` }}>
              <div style={{ position: "relative" }}>
                <Search size={15} style={{ position: "absolute", left: 10, top: 11, color: t.color.textFaint }} />
                <Input placeholder="Search places…" value={search} onChange={(e) => setSearch(e.target.value)} style={{ paddingLeft: 32 }} />
              </div>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 10 }}>
                <Chip label="All" active={category === "all"} onClick={() => setCategory("all")} accent={accent} />
                {PLACE_CATEGORIES.map((c) => (
                  <Chip key={c} label={`${CATEGORY_EMOJI[c]} ${CATEGORY_LABEL[c]}`} active={category === c} onClick={() => setCategory(c)} accent={accent} />
                ))}
              </div>
            </div>

            {/* List */}
            <div style={{ padding: "8px 12px 24px" }}>
              {filtered.length === 0 ? (
                <div style={{ textAlign: "center", padding: "32px 16px", color: t.color.textMuted }}>
                  <MapPin size={26} style={{ opacity: 0.5 }} />
                  <p style={{ margin: "8px 0 0", fontSize: 14 }}>No places match your filters.</p>
                </div>
              ) : (
                filtered.map((p) => (
                  <PlaceCard key={p.id} place={p} active={p.id === selectedId} accent={accent}
                    onClick={() => select(p)}
                    onGolden={canManage ? () => setGoldenFor(p) : undefined} />
                ))
              )}
            </div>
          </div>
        ) : (
          <ConciergePanel
            chat={chat} thinking={thinking} draft={draft} setDraft={setDraft} ask={ask}
            places={places} onSelectPlace={select} accent={accent} chatEndRef={chatEndRef}
          />
        )}
      </div>

      {/* Map */}
      <div className="discover-map-wrap">
        <DiscoverMap places={filtered} selectedId={selectedId} recommendedIds={recommendedIds} onSelect={select} />
        {selected && (
          <SelectedCard place={selected} accent={accent} onClose={() => setSelectedId(null)}
            onGolden={canManage ? () => setGoldenFor(selected) : undefined} />
        )}
        <MapLegend />
      </div>

      {showAdd && canManage && (
        <AddPlaceModal accent={accent} onClose={() => setShowAdd(false)}
          onCreated={async () => { setShowAdd(false); await refreshPlaces(); toast.push("Place added", "success"); }}
          onError={(m) => toast.push(m, "error")} />
      )}
      {goldenFor && canManage && (
        <GoldenModal place={goldenFor} accent={accent} onClose={() => setGoldenFor(null)}
          onDone={async (msg) => { setGoldenFor(null); await refreshPlaces(); toast.push(msg, "success"); }}
          onError={(m) => toast.push(m, "error")} />
      )}
    </div>
  );
}

// ── Sidebar bits ────────────────────────────────────────────────────────────

function TabButton({ active, onClick, icon, label, accent }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string; accent: string }) {
  return (
    <button onClick={onClick} style={{
      flex: 1, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 6,
      padding: "8px 10px", borderRadius: 8, fontSize: 13, fontWeight: 600, cursor: "pointer",
      border: `1px solid ${active ? accent : t.color.border}`,
      background: active ? accent + "12" : "transparent", color: active ? accent : t.color.textMuted,
    }}>{icon}{label}</button>
  );
}

function Chip({ label, active, onClick, accent }: { label: string; active: boolean; onClick: () => void; accent: string }) {
  return (
    <button onClick={onClick} style={{
      padding: "5px 10px", borderRadius: 999, fontSize: 12, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap",
      border: `1px solid ${active ? accent : t.color.border}`,
      background: active ? accent : t.color.surface, color: active ? "#fff" : t.color.textMuted,
    }}>{label}</button>
  );
}

function StarRating({ rating }: { rating: number | null }) {
  if (!rating) return null;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 12, color: "#b45309", fontWeight: 600 }}>
      <Star size={12} fill="#f59e0b" color="#f59e0b" /> {rating.toFixed(1)}
    </span>
  );
}

function PlaceCard({ place, active, accent, onClick, onGolden }: {
  place: Place; active: boolean; accent: string; onClick: () => void; onGolden?: () => void;
}) {
  return (
    <div onClick={onClick} style={{
      display: "flex", gap: 10, padding: 10, borderRadius: 10, cursor: "pointer", marginBottom: 6,
      border: `1px solid ${active ? accent : place.isGolden ? "#f1d792" : t.color.border}`,
      background: active ? accent + "0c" : place.isGolden ? "linear-gradient(180deg,#fffdf5,#fff)" : t.color.surface,
      transition: "border-color .12s, background .12s",
    }}>
      <div style={{
        width: 38, height: 38, borderRadius: 9, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 18,
        background: place.isGolden ? "linear-gradient(145deg,#fbbf24,#f59e0b)" : (CATEGORY_COLOR[place.category] ?? "#64748b") + "1a",
      }}>{CATEGORY_EMOJI[place.category] ?? "📍"}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontWeight: 600, fontSize: 14, color: t.color.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{place.name}</span>
          {place.isGolden && <Crown size={13} color="#d97706" fill="#fbbf24" />}
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <span style={{ fontSize: 12, color: t.color.textMuted, textTransform: "capitalize" }}>{place.category}</span>
          <StarRating rating={place.rating} />
          {place.priceLevel && <span style={{ fontSize: 12, color: t.color.textFaint }}>{priceLabel(place.priceLevel)}</span>}
        </div>
        {place.description && (
          <p style={{ margin: "4px 0 0", fontSize: 12, color: t.color.textMuted, overflow: "hidden", textOverflow: "ellipsis", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{place.description}</p>
        )}
        {onGolden && (
          <button onClick={(e) => { e.stopPropagation(); onGolden(); }} style={{
            marginTop: 6, fontSize: 11, fontWeight: 600, cursor: "pointer", border: "none", background: "none",
            color: place.isGolden ? "#b45309" : accent, display: "inline-flex", alignItems: "center", gap: 4,
          }}>
            <Crown size={11} /> {place.isGolden ? "Manage promotion" : "Make it golden"}
          </button>
        )}
      </div>
    </div>
  );
}

// ── Concierge panel ───────────────────────────────────────────────────────────

function ConciergePanel({ chat, thinking, draft, setDraft, ask, places, onSelectPlace, accent, chatEndRef }: {
  chat: ChatMessage[]; thinking: boolean; draft: string; setDraft: (s: string) => void;
  ask: (s: string) => void; places: Place[]; onSelectPlace: (p: Place) => void; accent: string;
  chatEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const byId = useMemo(() => new Map(places.map((p) => [p.id, p])), [places]);
  return (
    <div style={{ display: "flex", flexDirection: "column", flex: 1, minHeight: 0 }}>
      <div className="discover-scroll" style={{ flex: 1, padding: "14px 16px" }}>
        {chat.length === 0 && (
          <div style={{ textAlign: "center", padding: "12px 4px 18px" }}>
            <div style={{ width: 46, height: 46, borderRadius: 12, margin: "0 auto 10px", display: "flex", alignItems: "center", justifyContent: "center", background: accent + "14" }}>
              <Sparkles size={22} color={accent} />
            </div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 600, color: t.color.text }}>Not sure where to go?</p>
            <p style={{ margin: "4px 0 14px", fontSize: 13, color: t.color.textMuted }}>Tell me the vibe and I&apos;ll suggest spots — or ask me anything.</p>
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {SUGGESTED_PROMPTS.map((p) => (
                <button key={p} onClick={() => ask(p)} style={{
                  textAlign: "left", padding: "9px 12px", borderRadius: 9, cursor: "pointer", fontSize: 13,
                  border: `1px solid ${t.color.border}`, background: t.color.surface, color: t.color.text,
                  display: "flex", alignItems: "center", gap: 8,
                }}><Wand2 size={14} color={accent} /> {p}</button>
              ))}
            </div>
          </div>
        )}

        {chat.map((m, i) => (
          <div key={i} style={{ marginBottom: 14 }}>
            {m.role === "user" ? (
              <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <div style={{ maxWidth: "85%", background: accent, color: "#fff", padding: "8px 12px", borderRadius: "12px 12px 2px 12px", fontSize: 13 }}>{m.content}</div>
              </div>
            ) : (
              <div>
                <div style={{ display: "flex", gap: 8, alignItems: "flex-start" }}>
                  <div style={{ width: 26, height: 26, borderRadius: 8, flexShrink: 0, display: "flex", alignItems: "center", justifyContent: "center", background: accent + "14" }}>
                    <Sparkles size={14} color={accent} />
                  </div>
                  <div style={{ background: t.color.surfaceMuted, padding: "9px 12px", borderRadius: "12px 12px 12px 2px", fontSize: 13, color: t.color.text }}>{m.content}</div>
                </div>
                {m.questions && m.questions.length > 0 && (
                  <div style={{ marginLeft: 34, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {m.questions.map((q) => (
                      <button key={q} onClick={() => ask(q)} style={{
                        textAlign: "left", padding: "7px 10px", borderRadius: 8, cursor: "pointer", fontSize: 12.5,
                        border: `1px dashed ${accent}66`, background: accent + "08", color: accent, fontWeight: 500,
                      }}>{q}</button>
                    ))}
                  </div>
                )}
                {m.recommendations && m.recommendations.length > 0 && (
                  <div style={{ marginLeft: 34, marginTop: 8, display: "flex", flexDirection: "column", gap: 6 }}>
                    {m.recommendations.map((r) => {
                      const p = byId.get(r.placeId);
                      if (!p) return null;
                      return (
                        <button key={r.placeId} onClick={() => onSelectPlace(p)} style={{
                          textAlign: "left", padding: "8px 10px", borderRadius: 9, cursor: "pointer",
                          border: `1px solid ${p.isGolden ? "#f1d792" : t.color.border}`,
                          background: p.isGolden ? "linear-gradient(180deg,#fffdf5,#fff)" : t.color.surface,
                          display: "flex", gap: 8, alignItems: "center",
                        }}>
                          <span style={{ fontSize: 16 }}>{CATEGORY_EMOJI[p.category] ?? "📍"}</span>
                          <span style={{ minWidth: 0 }}>
                            <span style={{ display: "flex", alignItems: "center", gap: 5 }}>
                              <span style={{ fontWeight: 600, fontSize: 13, color: t.color.text }}>{p.name}</span>
                              {p.isGolden && <Crown size={12} color="#d97706" fill="#fbbf24" />}
                            </span>
                            <span style={{ display: "block", fontSize: 11.5, color: t.color.textMuted, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.reason}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        ))}
        {thinking && (
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginLeft: 34, color: t.color.textMuted, fontSize: 13 }}>
            <Spinner size={14} /> Thinking…
          </div>
        )}
        <div ref={chatEndRef} />
      </div>

      <div style={{ padding: 12, borderTop: `1px solid ${t.color.border}`, background: t.color.surface }}>
        <div style={{ display: "flex", gap: 8 }}>
          <Input
            placeholder="Ask the concierge…" value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); ask(draft); } }}
          />
          <Button onClick={() => ask(draft)} disabled={thinking || !draft.trim()} aria-label="Send"><Send size={15} /></Button>
        </div>
      </div>
    </div>
  );
}

// ── Selected-place floating card (over the map) ─────────────────────────────────

function SelectedCard({ place, accent, onClose, onGolden }: { place: Place; accent: string; onClose: () => void; onGolden?: () => void }) {
  return (
    <div className="discover-selected">
      <Card style={{ padding: 0, overflow: "hidden", boxShadow: t.shadow.lg }}>
        <div style={{
          height: 84, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 36, position: "relative",
          background: place.isGolden ? "linear-gradient(145deg,#fbbf24,#f59e0b)" : (CATEGORY_COLOR[place.category] ?? "#64748b") + "26",
        }}>
          {CATEGORY_EMOJI[place.category] ?? "📍"}
          <button onClick={onClose} aria-label="Close" style={{ position: "absolute", top: 8, right: 8, width: 26, height: 26, borderRadius: 7, border: "none", cursor: "pointer", background: "rgba(255,255,255,0.85)", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={15} />
          </button>
          {place.isGolden && (
            <span style={{ position: "absolute", top: 8, left: 8, display: "inline-flex", alignItems: "center", gap: 4, background: "rgba(255,255,255,0.9)", color: "#b45309", padding: "3px 8px", borderRadius: 999, fontSize: 11, fontWeight: 700 }}>
              <Crown size={12} fill="#fbbf24" color="#d97706" /> Featured · {place.goldenTier}
            </span>
          )}
        </div>
        <div style={{ padding: 14 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
            <h3 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: t.color.text }}>{place.name}</h3>
            <StarRating rating={place.rating} />
            {place.priceLevel ? <span style={{ fontSize: 13, color: t.color.textFaint }}>{priceLabel(place.priceLevel)}</span> : null}
          </div>
          <div style={{ marginTop: 5 }}><Badge tone="neutral" style={{ textTransform: "capitalize" }}>{place.category}</Badge></div>
          {place.description && <p style={{ margin: "10px 0 0", fontSize: 13, color: t.color.textMuted, lineHeight: 1.5 }}>{place.description}</p>}
          {place.address && <p style={{ margin: "8px 0 0", fontSize: 12.5, color: t.color.textMuted, display: "flex", gap: 6, alignItems: "center" }}><MapPin size={13} /> {place.address}</p>}
          {place.tags.length > 0 && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 10 }}>
              {place.tags.map((tag) => <span key={tag} style={{ fontSize: 11, padding: "2px 8px", borderRadius: 999, background: t.color.surfaceMuted, color: t.color.textMuted }}>#{tag}</span>)}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <a href={`https://www.openstreetmap.org/?mlat=${place.lat}&mlon=${place.lng}#map=17/${place.lat}/${place.lng}`} target="_blank" rel="noreferrer"
              className="ds-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 8, background: accent, color: "#fff", textDecoration: "none" }}>
              <MapPin size={14} /> Directions
            </a>
            {place.website && <a href={place.website} target="_blank" rel="noreferrer" className="ds-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.color.border}`, color: t.color.text, textDecoration: "none" }}><Globe size={14} /> Website</a>}
            {place.phone && <a href={`tel:${place.phone}`} className="ds-btn" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 8, border: `1px solid ${t.color.border}`, color: t.color.text, textDecoration: "none" }}><Phone size={14} /> Call</a>}
            {onGolden && <Button size="sm" variant="secondary" onClick={onGolden}><Crown size={14} color="#d97706" /> {place.isGolden ? "Manage" : "Promote"}</Button>}
          </div>
        </div>
      </Card>
    </div>
  );
}

function MapLegend() {
  return (
    <div className="discover-legend">
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11.5, fontWeight: 600, color: "#b45309" }}>
        <Crown size={13} fill="#fbbf24" color="#d97706" /> Golden Pin
      </span>
      <span style={{ fontSize: 11, color: "#64748b" }}>Hover a pin for a peek · click for details</span>
    </div>
  );
}

// ── Add-place modal ─────────────────────────────────────────────────────────────

function AddPlaceModal({ accent, onClose, onCreated, onError }: { accent: string; onClose: () => void; onCreated: () => void; onError: (m: string) => void }) {
  const [form, setForm] = useState({ name: "", category: "restaurant", description: "", lat: "15.54", lng: "73.76", address: "", rating: "", priceLevel: "", tags: "", website: "", phone: "" });
  const [saving, setSaving] = useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async () => {
    if (!form.name.trim()) { onError("Name is required"); return; }
    const lat = Number(form.lat), lng = Number(form.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) { onError("Valid coordinates are required"); return; }
    setSaving(true);
    try {
      const res = await fetch("/api/places", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: form.name, category: form.category, description: form.description || null,
          lat, lng, address: form.address || null,
          rating: form.rating ? Number(form.rating) : null,
          priceLevel: form.priceLevel ? Number(form.priceLevel) : null,
          tags: form.tags.split(",").map((s) => s.trim()).filter(Boolean),
          website: form.website || null, phone: form.phone || null,
        }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) { onError(data.error ?? "Could not add place"); setSaving(false); return; }
      onCreated();
    } catch { onError("Could not add place"); setSaving(false); }
  };

  return (
    <Modal title="Add a place" onClose={onClose} width={520}
      footer={<><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={submit} disabled={saving} style={{ background: accent }}>{saving ? <Spinner size={14} /> : "Add place"}</Button></>}>
      <Field label="Name"><Input value={form.name} onChange={set("name")} placeholder="e.g. Sunset Beach Café" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Category">
          <Select value={form.category} onChange={set("category")}>
            {PLACE_CATEGORIES.map((c) => <option key={c} value={c}>{CATEGORY_LABEL[c]}</option>)}
          </Select>
        </Field>
        <Field label="Price level (1–4)"><Input type="number" min={1} max={4} value={form.priceLevel} onChange={set("priceLevel")} placeholder="2" /></Field>
      </div>
      <Field label="Description"><Textarea value={form.description} onChange={set("description")} placeholder="What makes it worth a visit?" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Latitude" hint="-90 to 90"><Input value={form.lat} onChange={set("lat")} /></Field>
        <Field label="Longitude" hint="-180 to 180"><Input value={form.lng} onChange={set("lng")} /></Field>
      </div>
      <Field label="Address"><Input value={form.address} onChange={set("address")} placeholder="Street, area" /></Field>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <Field label="Rating (0–5)"><Input type="number" min={0} max={5} step={0.1} value={form.rating} onChange={set("rating")} placeholder="4.5" /></Field>
        <Field label="Phone"><Input value={form.phone} onChange={set("phone")} placeholder="+91…" /></Field>
      </div>
      <Field label="Website"><Input value={form.website} onChange={set("website")} placeholder="https://…" /></Field>
      <Field label="Tags" hint="comma-separated"><Input value={form.tags} onChange={set("tags")} placeholder="rooftop, family, vegan" /></Field>
    </Modal>
  );
}

// ── Golden-pin promotion modal ──────────────────────────────────────────────────

const TIER_PERKS: Record<GoldenTier, string[]> = {
  spotlight: ["Golden pin on the map", "Highlighted in listings", "Crown badge"],
  premium: ["Everything in Spotlight", "Larger map pin & priority sort", "Favoured by the AI concierge"],
  elite: ["Everything in Premium", "Top placement everywhere", "Featured hero styling"],
};

function GoldenModal({ place, accent, onClose, onDone, onError }: { place: Place; accent: string; onClose: () => void; onDone: (msg: string) => void; onError: (m: string) => void }) {
  const [tier, setTier] = useState<GoldenTier>((place.goldenTier as GoldenTier) ?? "premium");
  const [months, setMonths] = useState(1);
  const [busy, setBusy] = useState(false);

  const activate = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/places/${place.id}/golden`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier, months }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) { onError(data.error ?? "Could not activate promotion"); setBusy(false); return; }
      onDone(`${place.name} is now a ${tier} Golden Pin ✨`);
    } catch { onError("Could not activate promotion"); setBusy(false); }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const res = await fetch(`/api/places/${place.id}/golden`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tier: null }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string };
      if (!data.ok) { onError(data.error ?? "Could not remove promotion"); setBusy(false); return; }
      onDone(`Promotion removed for ${place.name}`);
    } catch { onError("Could not remove promotion"); setBusy(false); }
  };

  return (
    <Modal title="Golden Pin promotion" onClose={onClose} width={560}
      footer={
        <>
          {place.isGolden && <Button variant="danger" onClick={remove} disabled={busy} style={{ marginRight: "auto" }}><Trash2 size={14} /> Remove</Button>}
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button onClick={activate} disabled={busy} style={{ background: "linear-gradient(145deg,#fbbf24,#f59e0b)", color: "#3b2a00" }}>
            {busy ? <Spinner size={14} /> : <><Crown size={15} /> Activate</>}
          </Button>
        </>
      }>
      <p style={{ margin: "0 0 14px", fontSize: 13, color: t.color.textMuted }}>
        Promote <strong>{place.name}</strong> to a Golden Pin — a premium, more prominent listing that stands out on the map and gets favoured by the concierge.
      </p>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
        {GOLDEN_TIERS.map((tk) => {
          const active = tier === tk;
          return (
            <button key={tk} onClick={() => setTier(tk)} style={{
              textAlign: "left", padding: 12, borderRadius: 10, cursor: "pointer",
              border: `2px solid ${active ? "#f59e0b" : t.color.border}`,
              background: active ? "linear-gradient(180deg,#fffdf5,#fff)" : t.color.surface,
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontWeight: 700, fontSize: 14, textTransform: "capitalize", color: t.color.text }}>
                {active && <Crown size={14} color="#d97706" fill="#fbbf24" />}{tk}
              </div>
              <div style={{ fontSize: 18, fontWeight: 800, color: "#b45309", margin: "6px 0 8px" }}>
                ₹{GOLDEN_TIER_PRICING_INR[tk].toLocaleString("en-IN")}<span style={{ fontSize: 11, fontWeight: 500, color: t.color.textFaint }}>/mo</span>
              </div>
              <ul style={{ margin: 0, paddingLeft: 16, fontSize: 11.5, color: t.color.textMuted, lineHeight: 1.6 }}>
                {TIER_PERKS[tk].map((perk) => <li key={perk}>{perk}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 14 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: t.color.text }}>Duration</span>
        <Select value={String(months)} onChange={(e) => setMonths(Number(e.target.value))} style={{ width: 140 }}>
          {[1, 3, 6, 12].map((m) => <option key={m} value={m}>{m} month{m > 1 ? "s" : ""}</option>)}
        </Select>
        <span style={{ marginLeft: "auto", fontSize: 13, color: t.color.textMuted }}>
          Total: <strong style={{ color: t.color.text }}>₹{(GOLDEN_TIER_PRICING_INR[tier] * months).toLocaleString("en-IN")}</strong>
        </span>
      </div>
      <p style={{ margin: "12px 0 0", fontSize: 11.5, color: t.color.textFaint, display: "flex", gap: 6, alignItems: "center" }}>
        <MessageSquareText size={13} /> Staff-provisioned for this pilot — activating sets the promotion immediately; no payment is charged.
      </p>
    </Modal>
  );
}
