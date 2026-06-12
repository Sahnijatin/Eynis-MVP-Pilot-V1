// Discover — AI concierge.
//
// Given a tenant's curated Places and a free-text request ("where can I take the
// kids tonight?"), recommend a shortlist *from the tenant's own places only* and
// reply conversationally. If the request is too vague to answer well, the
// concierge asks a couple of clarifying questions instead of guessing.
//
// Grounding rule (same discipline as Research Studio): the model may ONLY pick
// from the supplied place ids — it must not invent venues. When no AI key is
// configured we fall back to deterministic keyword scoring so the feature still
// works in dev/test with zero external calls.

import { AI_AVAILABLE, CLAUDE_AVAILABLE, aiCompleteTiered, extractJson } from "../ai/intelligence";

export interface ConciergePlace {
  id: string;
  name: string;
  category: string;
  description: string | null;
  tags: string[];
  rating: number | null;
  priceLevel: number | null;
  isGolden: boolean;
}

export interface ConciergeTurn {
  role: "user" | "assistant";
  content: string;
}

export interface ConciergeRecommendation {
  placeId: string;
  reason: string;
}

export interface ConciergeResult {
  reply: string;
  questions: string[];
  recommendations: ConciergeRecommendation[];
  usedAI: boolean;
}

const MAX_RECOMMENDATIONS = 6;

// Golden places earn a small ranking boost in the deterministic fallback — they
// pay for prominence — but never outrank a clearly better keyword match.
const GOLDEN_BOOST = 1.5;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "near", "want", "looking", "place", "places",
  "where", "what", "can", "i", "we", "a", "an", "to", "go", "some", "good",
  "me", "my", "best", "find", "show", "something", "around", "here", "you",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));
}

// Deterministic keyword recommender — used as the no-AI fallback and to seed the
// AI's candidate ordering. Scores each place by token overlap across its name,
// category, tags and description, then applies the golden boost.
export function keywordRecommend(query: string, places: ConciergePlace[]): ConciergeRecommendation[] {
  const terms = tokenize(query);
  const scored = places.map((p) => {
    const haystack = [
      p.name, p.category, p.description ?? "", ...p.tags,
    ].join(" ").toLowerCase();
    let score = 0;
    for (const term of terms) {
      if (haystack.includes(term)) score += 1;
      if (p.category.includes(term)) score += 1; // category match is a strong signal
      if (p.tags.some((t) => t.toLowerCase().includes(term))) score += 1;
    }
    if (p.rating) score += p.rating / 10; // gentle tie-break toward better-rated spots
    if (p.isGolden) score *= GOLDEN_BOOST;
    return { place: p, score };
  });

  // When nothing matched the query terms at all, fall back to top-rated places so
  // the user still gets useful suggestions (golden first).
  const anyMatch = scored.some((s) => s.score > 0);
  const ranked = scored
    .sort((a, b) => {
      if (anyMatch) return b.score - a.score;
      const ga = a.place.isGolden ? 1 : 0, gb = b.place.isGolden ? 1 : 0;
      if (gb !== ga) return gb - ga;
      return (b.place.rating ?? 0) - (a.place.rating ?? 0);
    })
    .slice(0, MAX_RECOMMENDATIONS)
    .filter((s) => (anyMatch ? s.score > 0 : true));

  return ranked.map((s) => ({
    placeId: s.place.id,
    reason: s.place.isGolden ? "Featured pick" : "Matches what you asked for",
  }));
}

function fallbackReply(query: string, recs: ConciergeRecommendation[]): string {
  if (recs.length === 0) {
    return "I couldn't find a great match nearby for that. Try a different vibe — food, nightlife, something outdoors, or a family-friendly spot?";
  }
  return `Here ${recs.length === 1 ? "is a spot" : `are ${recs.length} spots`} near you that fit "${query.trim()}". Tap a pin on the map to see details.`;
}

const SYSTEM = `You are a friendly local concierge embedded in a discovery map.
You recommend places to visit from a FIXED list the host has curated.
Hard rules:
- Recommend ONLY places from the provided list, by their exact id. Never invent venues.
- Recommend at most ${MAX_RECOMMENDATIONS}, best first.
- If the request is too vague to recommend well (no hint of vibe, time, budget, company),
  return an empty recommendations array and 1-2 short clarifying questions instead.
- "isGolden" places are sponsored partners: you may favour them when they genuinely
  fit, but never recommend a poor fit just because it is golden.
- Keep "reply" warm, concise (1-3 sentences), and never list place names the user
  can already see on the map — refer them to the pins.
Respond with STRICT JSON only:
{"reply": string, "questions": string[], "recommendations": [{"placeId": string, "reason": string}]}`;

interface ParsedConcierge {
  reply?: unknown;
  questions?: unknown;
  recommendations?: unknown;
}

/**
 * Run the concierge. `history` is prior turns (oldest→newest) for multi-turn
 * follow-ups; `query` is the latest user message.
 */
export async function runConcierge(
  query: string,
  places: ConciergePlace[],
  history: ConciergeTurn[] = [],
  provider: "claude" | "openai" = "claude",
): Promise<ConciergeResult> {
  const trimmed = query.trim();
  const keyword = keywordRecommend(trimmed, places);

  if (!AI_AVAILABLE || places.length === 0) {
    return {
      reply: fallbackReply(trimmed, keyword),
      questions: [],
      recommendations: keyword,
      usedAI: false,
    };
  }

  // Compact catalogue — only what the model needs to choose, keeps tokens low.
  const catalogue = places.map((p) => ({
    id: p.id,
    name: p.name,
    category: p.category,
    tags: p.tags.slice(0, 6),
    rating: p.rating,
    priceLevel: p.priceLevel,
    isGolden: p.isGolden,
    blurb: (p.description ?? "").slice(0, 160),
  }));

  const convo = history
    .slice(-6)
    .map((t) => `${t.role === "user" ? "Guest" : "Concierge"}: ${t.content}`)
    .join("\n");

  const userContent = [
    `PLACES (choose only from these ids):\n${JSON.stringify(catalogue)}`,
    convo ? `CONVERSATION SO FAR:\n${convo}` : "",
    `LATEST GUEST MESSAGE:\n${trimmed}`,
  ].filter(Boolean).join("\n\n");

  try {
    const raw = await aiCompleteTiered(userContent, {
      provider: CLAUDE_AVAILABLE && provider === "claude" ? "claude" : "openai",
      tier: "cheap",
      maxTokens: 900,
      system: SYSTEM,
    });
    const parsed = extractJson(raw) as ParsedConcierge | null;
    if (!parsed) throw new Error("no json");

    const validIds = new Set(places.map((p) => p.id));
    const recommendations: ConciergeRecommendation[] = Array.isArray(parsed.recommendations)
      ? parsed.recommendations
          .map((r): ConciergeRecommendation | null => {
            const rec = r as { placeId?: unknown; reason?: unknown };
            const placeId = typeof rec.placeId === "string" ? rec.placeId : null;
            if (!placeId || !validIds.has(placeId)) return null; // drop hallucinated ids
            return { placeId, reason: typeof rec.reason === "string" ? rec.reason : "Recommended for you" };
          })
          .filter((r): r is ConciergeRecommendation => r !== null)
          .slice(0, MAX_RECOMMENDATIONS)
      : [];

    const questions: string[] = Array.isArray(parsed.questions)
      ? parsed.questions.filter((q): q is string => typeof q === "string").slice(0, 3)
      : [];

    const reply = typeof parsed.reply === "string" && parsed.reply.trim()
      ? parsed.reply.trim()
      : fallbackReply(trimmed, recommendations);

    return { reply, questions, recommendations, usedAI: true };
  } catch {
    // AI failed/malformed — degrade to the deterministic recommender.
    return {
      reply: fallbackReply(trimmed, keyword),
      questions: [],
      recommendations: keyword,
      usedAI: false,
    };
  }
}
