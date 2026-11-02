/**
 * Swaps participant names for placeholders and back. Each word of a name gets its own
 * placeholder ("Nadia Park" is "Person A Surname A"), so a first name used alone is hidden too
 * and every replacement maps back to exactly the text it replaced. Matching is case-sensitive
 * and whole-word, so "Ana" inside "Banana" stays.
 */
export interface Pseudonyms {
  hide(text: string): string;
  reveal(text: string): string;
}

/** A, B, …, Z, AA, AB, … */
function letters(i: number): string {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) {
    s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  }
  return s;
}

const WORD = /[\p{L}\p{N}'’-]+/gu;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Matches any of `words`, longest first, not inside a longer word. */
function wholeWords(words: string[]): RegExp | null {
  if (words.length === 0) return null;
  const sorted = [...words].sort((a, b) => b.length - a.length).map(escape);
  return new RegExp(`(?<![\\p{L}\\p{N}_])(?:${sorted.join("|")})(?![\\p{L}\\p{N}_])`, "gu");
}

export function pseudonyms(names: readonly string[]): Pseudonyms {
  const toPlaceholder = new Map<string, string>();
  names.forEach((name, i) => {
    const tag = letters(i);
    // A trailing possessive belongs to the sentence, not the name.
    const words = (name.match(WORD) ?? []).map((w) => w.replace(/['’]s$/u, ""));
    words.forEach((word, k) => {
      if ([...word].length < 2 || toPlaceholder.has(word)) return;
      toPlaceholder.set(
        word,
        k === 0 ? `Person ${tag}` : `Surname ${tag}${k === 1 ? "" : String(k)}`,
      );
    });
  });
  const toName = new Map([...toPlaceholder].map(([name, placeholder]) => [placeholder, name]));
  const hidePattern = wholeWords([...toPlaceholder.keys()]);
  const revealPattern = wholeWords([...toName.keys()]);
  return {
    hide: (text) =>
      hidePattern === null ? text : text.replace(hidePattern, (w) => toPlaceholder.get(w)!),
    reveal: (text) =>
      revealPattern === null ? text : text.replace(revealPattern, (p) => toName.get(p)!),
  };
}

/** Applies `fn` to every string value in a JSON-shaped value; keys are schema fields and stay. */
export function mapStrings<T>(value: T, fn: (s: string) => string): T {
  const walk = (v: unknown): unknown => {
    if (typeof v === "string") return fn(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v !== null && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
    }
    return v;
  };
  return walk(value) as T;
}
