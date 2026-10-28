import type { AudioTruth } from "./audio-render";

/** The parts of a Voice Transcribe turn S1 needs. */
export interface HypothesisTurn {
  startMs: number;
  endMs: number;
  transcript: string;
  speaker?: string | undefined;
}

const UNIT_WORDS =
  "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen fifteen sixteen seventeen eighteen nineteen".split(
    " ",
  );
const UNIT_ORDINALS =
  "zeroth first second third fourth fifth sixth seventh eighth ninth tenth eleventh twelfth thirteenth fourteenth fifteenth sixteenth seventeenth eighteenth nineteenth".split(
    " ",
  );
const TEN_WORDS = "_ _ twenty thirty forty fifty sixty seventy eighty ninety".split(" ");
const TEN_ORDINALS =
  "_ _ twentieth thirtieth fortieth fiftieth sixtieth seventieth eightieth ninetieth".split(" ");

function unitValue(word: string): number | undefined {
  const i = Math.max(UNIT_WORDS.indexOf(word), UNIT_ORDINALS.indexOf(word));
  return i >= 0 ? i : undefined;
}
function tenValue(word: string): number | undefined {
  const i = Math.max(TEN_WORDS.indexOf(word), TEN_ORDINALS.indexOf(word));
  return i >= 2 ? i * 10 : undefined;
}

/**
 * Spoken numbers as digits, since ASR writes either ("third", "3rd" and "3" all become "3";
 * "thirty first" and "thirty-first" become "31"). Scale words stay words ("8 thousand"), so a
 * quote normalized word by word matches the transcript normalized as a whole.
 */
function numbersAsDigits(words: readonly string[]): string[] {
  const out: string[] = [];
  const tokens = words.flatMap((w) => {
    const [a, b, ...rest] = w.split("-");
    if (rest.length > 0 || !a || !b) return [w];
    if (tenValue(a) !== undefined && unitValue(b) !== undefined) return [a, b];
    // "ten-seat" → "10-seat", so it still matches "ten seat" written as two words.
    return [[a, b].map((part) => String(unitValue(part) ?? tenValue(part) ?? part)).join("-")];
  });
  for (let i = 0; i < tokens.length; i++) {
    const word = tokens[i]!;
    const ordinal = /^(\d+)(st|nd|rd|th)$/.exec(word);
    if (ordinal) {
      out.push(ordinal[1]!);
      continue;
    }
    let value = unitValue(word) ?? tenValue(word);
    if (value === undefined) {
      out.push(word);
      continue;
    }
    const next = tokens[i + 1];
    const unit = next === undefined ? undefined : unitValue(next);
    if (value >= 20 && unit !== undefined && unit > 0 && unit < 10) {
      value += unit;
      i++;
    }
    out.push(String(value));
  }
  return out;
}

/**
 * Lowercase words; punctuation dropped, inner apostrophes and hyphens kept ("i'll", "mm-hm").
 * Clock times lose their colon, since ASR writes "17:00" as "1700"; spoken numbers become digits.
 */
export function normalizeWords(text: string): string[] {
  return numbersAsDigits(
    text
      .toLowerCase()
      .replace(/[’‘]/g, "'")
      .replace(/(\d):(\d\d)\b/g, "$1$2")
      .replace(/[^\p{L}\p{N}'\- ]+/gu, " ")
      .split(/\s+/)
      .map((w) => w.replace(/^['-]+|['-]+$/g, ""))
      .filter(Boolean),
  );
}

export interface WerResult {
  wer: number;
  referenceWords: number;
  substitutions: number;
  deletions: number;
  insertions: number;
}

/** Word error rate by Levenshtein alignment over normalized words. */
export function wordErrorRate(reference: string, hypothesis: string): WerResult {
  const ref = normalizeWords(reference);
  const hyp = normalizeWords(hypothesis);
  // Each cell holds [cost, substitutions, deletions, insertions] for the best path.
  type Cell = [number, number, number, number];
  let prev: Cell[] = Array.from({ length: hyp.length + 1 }, (_, j): Cell => [j, 0, 0, j]);
  for (let i = 1; i <= ref.length; i++) {
    const row: Cell[] = [[i, 0, i, 0]];
    for (let j = 1; j <= hyp.length; j++) {
      const diag = prev[j - 1]!;
      const up = prev[j]!;
      const left = row[j - 1]!;
      const same = ref[i - 1] === hyp[j - 1];
      const options: Cell[] = [
        [diag[0] + (same ? 0 : 1), diag[1] + (same ? 0 : 1), diag[2], diag[3]],
        [up[0] + 1, up[1], up[2] + 1, up[3]],
        [left[0] + 1, left[1], left[2], left[3] + 1],
      ];
      row.push(options.reduce((best, c) => (c[0] < best[0] ? c : best)));
    }
    prev = row;
  }
  const [cost, substitutions, deletions, insertions] = prev[hyp.length]!;
  return {
    wer: ref.length === 0 ? (hyp.length === 0 ? 0 : 1) : cost / ref.length,
    referenceWords: ref.length,
    substitutions,
    deletions,
    insertions,
  };
}

/**
 * Hungarian algorithm (Kuhn–Munkres) for a maximum-weight assignment of rows to columns.
 * Returns, for each row, its column or -1 when there are more rows than columns.
 */
export function maxWeightAssignment(weights: readonly (readonly number[])[]): number[] {
  const rows = weights.length;
  const cols = Math.max(0, ...weights.map((r) => r.length));
  const n = Math.max(rows, cols);
  if (n === 0) return [];
  const max = Math.max(0, ...weights.flat());
  // Square cost matrix, 1-based as in the classic formulation; padding costs `max` (weight 0).
  const cost = (i: number, j: number) => max - (weights[i - 1]?.[j - 1] ?? 0);
  const u = new Array<number>(n + 1).fill(0);
  const v = new Array<number>(n + 1).fill(0);
  const p = new Array<number>(n + 1).fill(0);
  const way = new Array<number>(n + 1).fill(0);
  for (let i = 1; i <= n; i++) {
    p[0] = i;
    let j0 = 0;
    const minv = new Array<number>(n + 1).fill(Infinity);
    const used = new Array<boolean>(n + 1).fill(false);
    do {
      used[j0] = true;
      const i0 = p[j0]!;
      let delta = Infinity;
      let j1 = 0;
      for (let j = 1; j <= n; j++) {
        if (used[j]) continue;
        const cur = cost(i0, j) - u[i0]! - v[j]!;
        if (cur < minv[j]!) {
          minv[j] = cur;
          way[j] = j0;
        }
        if (minv[j]! < delta) {
          delta = minv[j]!;
          j1 = j;
        }
      }
      for (let j = 0; j <= n; j++) {
        if (used[j]) {
          u[p[j]!]! += delta;
          v[j]! -= delta;
        } else {
          minv[j]! -= delta;
        }
      }
      j0 = j1;
    } while (p[j0] !== 0);
    do {
      const j1 = way[j0]!;
      p[j0] = p[j1]!;
      j0 = j1;
    } while (j0 !== 0);
  }
  const result = new Array<number>(rows).fill(-1);
  for (let j = 1; j <= n; j++) {
    const i = p[j]!;
    if (i >= 1 && i <= rows && j <= cols) result[i - 1] = j - 1;
  }
  return result;
}

const overlapMs = (a: { startMs: number; endMs: number }, b: { startMs: number; endMs: number }) =>
  Math.max(0, Math.min(a.endMs, b.endMs) - Math.max(a.startMs, b.startMs));

export interface SpeakerResult {
  accuracy: number;
  correct: number;
  total: number;
  /** ASR label → person; labels left over after assignment map to null. */
  mapping: Record<string, string | null>;
}

/**
 * Maps ASR labels to people by the assignment with the most shared speaking time, then scores
 * each script turn by the mapped speaker of the ASR turn overlapping it most.
 */
export function speakerAccuracy(
  truth: Pick<AudioTruth, "turns">,
  hypothesis: readonly HypothesisTurn[],
): SpeakerResult {
  const turns = truth.turns.filter((t) => t.kind === "turn");
  const people = [...new Set(turns.map((t) => t.speaker))];
  const labels = [...new Set(hypothesis.map((h) => h.speaker ?? "?"))];
  const weights = labels.map((label) =>
    people.map((person) =>
      hypothesis
        .filter((h) => (h.speaker ?? "?") === label)
        .reduce(
          (sum, h) =>
            sum +
            turns.filter((t) => t.speaker === person).reduce((s, t) => s + overlapMs(h, t), 0),
          0,
        ),
    ),
  );
  const assignment = maxWeightAssignment(weights);
  const mapping = Object.fromEntries(
    labels.map((label, i) => [label, assignment[i]! >= 0 ? people[assignment[i]!]! : null]),
  );

  let correct = 0;
  for (const t of turns) {
    const best = hypothesis.reduce<HypothesisTurn | undefined>((winner, h) => {
      const o = overlapMs(h, t);
      return o > 0 && (!winner || o > overlapMs(winner, t)) ? h : winner;
    }, undefined);
    if (best && mapping[best.speaker ?? "?"] === t.speaker) correct++;
  }
  return {
    accuracy: turns.length ? correct / turns.length : 1,
    correct,
    total: turns.length,
    mapping,
  };
}

const DATE_WORDS = new Set([
  ..."monday tuesday wednesday thursday friday saturday sunday".split(" "),
  ..."january february march april may june july august september october november december".split(
    " ",
  ),
  ..."today tomorrow tonight yesterday next last week weekend month quarter eod eow".split(" "),
]);
const NUMBER_WORDS = new Set(
  "zero one two three four five six seven eight nine ten eleven twelve fifteen twenty thirty forty fifty hundred thousand half first second third".split(
    " ",
  ),
);
const STOPWORDS = new Set(
  "the and that this with from have will what when where which while their there they them then than into onto about after before also just only need needs it's i'll we'll you'll that's back goes does done make sure".split(
    " ",
  ),
);

export interface CommitmentSource {
  participants: readonly string[];
  expectedDecisions: readonly { statement: string; quotes: readonly string[] }[];
}

export interface CommitmentTerm {
  term: string;
  kind: "date" | "number" | "name" | "deliverable";
  /** Script turn index that holds the quote. */
  scriptIdx: number;
  speaker: string;
}

/**
 * Commitment terms from each decision's quotes: dates, numbers, names (participants and
 * capitalized words), and deliverable nouns (longer words the decision statement repeats).
 */
export function commitmentTerms(
  source: CommitmentSource,
  truth: Pick<AudioTruth, "turns">,
): CommitmentTerm[] {
  const names = new Set(source.participants.map((p) => p.toLowerCase()));
  const terms: CommitmentTerm[] = [];
  const seen = new Set<string>();
  for (const decision of source.expectedDecisions) {
    const statementWords = new Set(normalizeWords(decision.statement));
    for (const quote of decision.quotes) {
      const turn = truth.turns.find((t) => t.kind === "turn" && t.text.includes(quote));
      if (!turn || turn.scriptIdx === null) continue;
      const raw = quote.split(/\s+/);
      raw.forEach((token, position) => {
        const [word] = normalizeWords(token);
        if (!word) return;
        let kind: CommitmentTerm["kind"] | undefined;
        if (DATE_WORDS.has(word)) kind = "date";
        else if (/\d/.test(word) || NUMBER_WORDS.has(word)) kind = "number";
        else if (names.has(word) || (position > 0 && /^\p{Lu}/u.test(token) && word !== "i"))
          kind = "name";
        else if (word.length >= 4 && !STOPWORDS.has(word) && statementWords.has(word))
          kind = "deliverable";
        const key = `${turn.scriptIdx}:${word}`;
        if (kind && !seen.has(key)) {
          seen.add(key);
          terms.push({ term: word, kind, scriptIdx: turn.scriptIdx!, speaker: turn.speaker });
        }
      });
    }
  }
  return terms;
}

export interface SurvivalResult {
  survival: number;
  survived: number;
  total: number;
  lost: CommitmentTerm[];
}

const bare = (word: string) => word.replace(/-/g, "").replace(/'s$/, "");

/**
 * True when `term` is one word of `words`, or 2–3 consecutive words written together
 * ("sub processor", "5 45"). Possessives match the plain word, and a whole-hour time
 * ("1700") matches its spoken hour ("17").
 */
function hasTerm(words: readonly string[], term: string): boolean {
  const hour = /^(\d{1,2})00$/.exec(term)?.[1];
  const targets = [bare(term), ...(hour ? [hour] : [])];
  for (let i = 0; i < words.length; i++) {
    let joined = "";
    for (let n = 0; n < 3 && i + n < words.length; n++) {
      joined += bare(words[i + n]!);
      if (targets.includes(joined)) return true;
      if (joined.length >= bare(term).length) break;
    }
  }
  return false;
}

/** A term survives when an ASR turn overlapping its script turn, mapped to the same person, has it. */
export function commitmentSurvival(
  terms: readonly CommitmentTerm[],
  truth: Pick<AudioTruth, "turns">,
  hypothesis: readonly HypothesisTurn[],
  mapping: Readonly<Record<string, string | null>>,
): SurvivalResult {
  const lost: CommitmentTerm[] = [];
  for (const term of terms) {
    const line = truth.turns.find((t) => t.kind === "turn" && t.scriptIdx === term.scriptIdx);
    const found =
      line !== undefined &&
      hypothesis.some(
        (h) =>
          overlapMs(h, line) > 0 &&
          mapping[h.speaker ?? "?"] === term.speaker &&
          hasTerm(normalizeWords(h.transcript), term.term),
      );
    if (!found) lost.push(term);
  }
  const survived = terms.length - lost.length;
  return {
    survival: terms.length ? survived / terms.length : 1,
    survived,
    total: terms.length,
    lost,
  };
}

export interface S1Result {
  wer: WerResult;
  speakers: SpeakerResult;
  commitments: SurvivalResult;
}

export function scoreTranscription(
  source: CommitmentSource,
  truth: Pick<AudioTruth, "turns">,
  hypothesis: readonly HypothesisTurn[],
): S1Result {
  const reference = truth.turns.map((t) => t.text).join(" ");
  const speakers = speakerAccuracy(truth, hypothesis);
  return {
    wer: wordErrorRate(reference, hypothesis.map((h) => h.transcript).join(" ")),
    speakers,
    commitments: commitmentSurvival(
      commitmentTerms(source, truth),
      truth,
      hypothesis,
      speakers.mapping,
    ),
  };
}
