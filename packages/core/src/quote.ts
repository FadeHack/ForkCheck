import type { Segment } from "./model/index";

export type QuoteMatch =
  { ok: true; start: number; end: number } | { ok: false; reason: "empty_quote" | "not_found" };

interface Folded {
  text: string;
  /** Per folded UTF-16 unit, the source range it came from. */
  from: number[];
  to: number[];
}

const SINGLE_QUOTES = /[‘’‚‛′]/;
const DOUBLE_QUOTES = /[“”„‟″«»]/;
const DASHES = /[‐-―−﹘﹣－]/;
// A base character with its combining marks, so NFC never composes across a unit boundary.
const UNIT = /\P{M}\p{M}*|\p{M}+/gu;

function foldChar(c: string): string {
  if (/\s/.test(c)) return " ";
  if (SINGLE_QUOTES.test(c)) return "'";
  if (DOUBLE_QUOTES.test(c)) return '"';
  if (DASHES.test(c)) return "-";
  if (c === "…") return "...";
  return c;
}

// Non-semantic normalization only: NFC, whitespace runs, quote and dash variants, ellipsis.
function fold(s: string): Folded {
  const out: Folded = { text: "", from: [], to: [] };
  for (const m of s.matchAll(UNIT)) {
    const start = m.index;
    const end = start + m[0].length;
    for (const ch of m[0].normalize("NFC")) {
      const f = foldChar(ch);
      if (f === " " && out.text.endsWith(" ")) {
        out.to[out.to.length - 1] = end;
        continue;
      }
      out.text += f;
      for (let k = 0; k < f.length; k++) {
        out.from.push(start);
        out.to.push(end);
      }
    }
  }
  return out;
}

export function normalizeQuote(s: string): string {
  return fold(s).text.trim();
}

/**
 * Exact substring match after non-semantic normalization. Offsets index the original
 * segment text, end exclusive. There is deliberately no fuzzy fallback.
 */
export function verifyQuote(segment: Pick<Segment, "text">, quote: string): QuoteMatch {
  const needle = normalizeQuote(quote);
  if (needle === "") return { ok: false, reason: "empty_quote" };
  const hay = fold(segment.text);
  const at = hay.text.indexOf(needle);
  if (at < 0) return { ok: false, reason: "not_found" };
  return { ok: true, start: hay.from[at] ?? 0, end: hay.to[at + needle.length - 1] ?? 0 };
}

export interface NearMatch {
  segmentId: string;
  start: number;
  end: number;
  text: string;
  /** 0–1 character similarity; for organizer display only, never for verification. */
  score: number;
}

function levenshtein(a: string, b: string): number {
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      row.push(Math.min((prev[j] ?? 0) + 1, (row[j - 1] ?? 0) + 1, (prev[j - 1] ?? 0) + cost));
    }
    prev = row;
  }
  return prev[b.length] ?? 0;
}

/** Closest word windows to a quote that failed verification, best first. */
export function suggestNearMatches(
  segments: readonly Pick<Segment, "id" | "text">[],
  quote: string,
  opts: { limit?: number; minScore?: number } = {},
): NearMatch[] {
  const limit = opts.limit ?? 3;
  const minScore = opts.minScore ?? 0.6;
  const needle = normalizeQuote(quote);
  if (needle === "") return [];
  const k = needle.split(" ").length;

  const found: NearMatch[] = [];
  for (const seg of segments) {
    const words = [...seg.text.matchAll(/\S+/g)].map((m) => [m.index, m.index + m[0].length]);
    for (let size = Math.max(1, k - 1); size <= k + 1; size++) {
      for (let i = 0; i + size <= words.length; i++) {
        const start = words[i]?.[0] ?? 0;
        const end = words[i + size - 1]?.[1] ?? 0;
        const text = seg.text.slice(start, end);
        const cand = normalizeQuote(text);
        const score = 1 - levenshtein(cand, needle) / Math.max(cand.length, needle.length);
        if (score >= minScore) found.push({ segmentId: seg.id, start, end, text, score });
      }
    }
  }
  found.sort((a, b) => b.score - a.score || a.start - b.start);
  return found.slice(0, limit);
}
