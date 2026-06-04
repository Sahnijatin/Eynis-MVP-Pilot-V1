// Lightweight sentiment classifier (Phase 7).
//
// Pure + keyword-based so real-time, per-utterance classification needs no API
// call (keys-last). Returns a sentiment label and a score in [-1, 1]. Later we
// can swap in a Claude-backed classifier behind the same signature without
// touching the webhook/timeline code.

export type Sentiment = "positive" | "neutral" | "negative";

const POSITIVE = [
  "yes", "yeah", "sure", "great", "perfect", "interested", "sounds good", "definitely",
  "love", "happy", "thank", "awesome", "excellent", "go ahead", "please do", "absolutely",
  "wonderful", "of course", "that works", "book", "sign me up",
];
const NEGATIVE = [
  "no", "not interested", "stop", "angry", "terrible", "bad", "hate", "annoyed",
  "busy", "never", "remove", "don't", "dont", "won't", "wont", "frustrated", "waste",
  "rude", "leave me alone", "not now", "go away",
];

// Word-boundary match so "no" doesn't fire inside "now"/"know"; multi-word
// phrases still match as a whole.
const countHits = (haystack: string, needles: string[]): number =>
  needles.reduce((n, w) => {
    const re = new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`);
    return re.test(haystack) ? n + 1 : n;
  }, 0);

export function classifySentiment(text: string): { sentiment: Sentiment; score: number } {
  const t = (text ?? "").toLowerCase();
  if (!t.trim()) return { sentiment: "neutral", score: 0 };
  const pos = countHits(t, POSITIVE);
  const neg = countHits(t, NEGATIVE);
  if (pos === 0 && neg === 0) return { sentiment: "neutral", score: 0 };
  const score = (pos - neg) / (pos + neg); // [-1, 1]
  const sentiment: Sentiment = score > 0.2 ? "positive" : score < -0.2 ? "negative" : "neutral";
  return { sentiment, score: Number(score.toFixed(3)) };
}

// Rolls a list of per-utterance scores into one aggregate label (average).
export function aggregateSentiment(scores: number[]): { sentiment: Sentiment; score: number } {
  if (scores.length === 0) return { sentiment: "neutral", score: 0 };
  const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
  const sentiment: Sentiment = avg > 0.2 ? "positive" : avg < -0.2 ? "negative" : "neutral";
  return { sentiment, score: Number(avg.toFixed(3)) };
}
