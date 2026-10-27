import type { Decision, Dimension, Segment } from "./model/index";

// R§6.3 code lint. Every rule is a pure function returning findings; an empty list passes.

export type ProbeLintRule =
  | "option_count"
  | "length_ratio"
  | "verbatim_speaker"
  | "presupposition"
  | "one_dimension"
  | "debated_target"
  | "duplicate"
  | "recheck_overlap"
  | "recheck_restates_resolution";

export interface ProbeLintFinding {
  rule: ProbeLintRule;
  detail: string;
}

export interface ProbeDraft {
  stem: string;
  /** Model options only; code appends "Not sure" afterwards, so it is not counted here. */
  options: readonly { text: string }[];
}

export interface ProbeTarget {
  decision: Pick<Decision, "id" | "status">;
  dimension: Dimension;
}

export const PROBE_LINT_DEFAULTS = {
  minOptions: 2,
  maxOptions: 4,
  maxLengthRatio: 2.5,
  /** A shared run of this many words between an option and a speaker turn is verbatim. */
  verbatimRunWords: 5,
  /** Recheck stems sharing this fraction of content words with the original fail. */
  maxRecheckOverlap: 0.5,
};

const finding = (rule: ProbeLintRule, detail: string): ProbeLintFinding => ({ rule, detail });

/** Lowercased word tokens; apostrophe variants fold so "don’t" matches "don't". */
function words(text: string): string[] {
  return (
    text
      .normalize("NFC")
      .toLowerCase()
      .replace(/[‘’‛′]/g, "'")
      .match(/[\p{L}\p{N}]+(?:'[\p{L}]+)*/gu) ?? []
  );
}

const foldText = (text: string) => words(text).join(" ");

export function lintOptionCount(
  options: ProbeDraft["options"],
  { minOptions, maxOptions } = PROBE_LINT_DEFAULTS,
): ProbeLintFinding[] {
  const n = options.length;
  return n < minOptions || n > maxOptions
    ? [finding("option_count", `${n} options; need ${minOptions} to ${maxOptions}`)]
    : [];
}

/** Longest over shortest option, in characters, so no option stands out by size. */
export function lintLengthRatio(
  options: ProbeDraft["options"],
  { maxLengthRatio } = PROBE_LINT_DEFAULTS,
): ProbeLintFinding[] {
  const lengths = options.map((o) => o.text.trim().length);
  if (lengths.length < 2) return [];
  const shortest = Math.min(...lengths);
  const longest = Math.max(...lengths);
  const ratio = shortest === 0 ? Infinity : longest / shortest;
  return ratio > maxLengthRatio
    ? [
        finding(
          "length_ratio",
          `longest option is ${ratio === Infinity ? "unbounded" : ratio.toFixed(2)}× the shortest; max ${maxLengthRatio}×`,
        ),
      ]
    : [];
}

/**
 * An option that quotes a speaker reads as the "right" answer. It fails when it shares a
 * run of `verbatimRunWords` words with a turn, or, if shorter, appears whole in one
 * (options under three words are too generic to count).
 */
export function lintVerbatimSpeaker(
  options: ProbeDraft["options"],
  segments: readonly Pick<Segment, "text">[],
  { verbatimRunWords } = PROBE_LINT_DEFAULTS,
): ProbeLintFinding[] {
  const turns = segments.map((s) => ` ${foldText(s.text)} `);
  const out: ProbeLintFinding[] = [];
  options.forEach((o, i) => {
    const w = words(o.text);
    if (w.length < 3) return;
    const run = Math.min(verbatimRunWords, w.length);
    for (let start = 0; start + run <= w.length; start++) {
      const phrase = ` ${w.slice(start, start + run).join(" ")} `;
      if (turns.some((t) => t.includes(phrase))) {
        out.push(finding("verbatim_speaker", `option ${i + 1} repeats "${phrase.trim()}"`));
        return;
      }
    }
  });
  return out;
}

// Stems must not presuppose that anyone is wrong or confused.
const PRESUPPOSITION = /\b(disagree\w*|misunderst\w*|confus\w*|(?:in)?correct\w*|obvious\w*)\b/giu;

export function lintPresupposition(stem: string): ProbeLintFinding[] {
  const hits = [...new Set([...stem.matchAll(PRESUPPOSITION)].map((m) => m[0].toLowerCase()))];
  return hits.map((h) => finding("presupposition", `stem uses "${h}"`));
}

const WH = "(?:who|whose|when|what|which|where|how)";
const COMPOUND = new RegExp(`\\b${WH}\\b[^?]*\\b(?:and|or)\\s+(?:by\\s+)?${WH}\\b`, "iu");

/**
 * A probe targets exactly one (decision, dimension). The stem check catches the usual
 * compound forms: two questions, or "who ... and when".
 */
export function lintOneDimension(
  stem: string,
  targets: readonly ProbeTarget[],
): ProbeLintFinding[] {
  const out: ProbeLintFinding[] = [];
  if (targets.length !== 1) {
    out.push(finding("one_dimension", `probe targets ${targets.length} dimensions; need 1`));
  }
  const questions = (stem.match(/\?/g) ?? []).length;
  if (questions > 1) {
    out.push(finding("one_dimension", `stem asks ${questions} questions`));
  } else if (COMPOUND.test(stem)) {
    out.push(finding("one_dimension", "stem joins two questions"));
  }
  return out;
}

/** Openly debated decisions are already known to be unsettled; probing them adds nothing. */
export function lintDebatedTarget(targets: readonly ProbeTarget[]): ProbeLintFinding[] {
  return targets
    .filter((t) => t.decision.status === "debated")
    .map((t) => finding("debated_target", `decision ${t.decision.id} is debated`));
}

/**
 * Keeps the first probe per (decision, dimension), in input order. Dropped probes carry a
 * `duplicate` finding naming the probe they repeat.
 */
export function dedupeProbes<P extends { target: ProbeTarget }>(
  probes: readonly P[],
): { kept: P[]; dropped: { probe: P; finding: ProbeLintFinding }[] } {
  const seen = new Map<string, number>();
  const kept: P[] = [];
  const dropped: { probe: P; finding: ProbeLintFinding }[] = [];
  probes.forEach((p, i) => {
    const key = `${p.target.decision.id}\u0000${p.target.dimension}`;
    const first = seen.get(key);
    if (first === undefined) {
      seen.set(key, i);
      kept.push(p);
    } else {
      dropped.push({
        probe: p,
        finding: finding(
          "duplicate",
          `probe ${i + 1} repeats probe ${first + 1} on ${p.target.decision.id}/${p.target.dimension}`,
        ),
      });
    }
  });
  return { kept, dropped };
}

const STOPWORDS = new Set(
  (
    "a an the and or but if of to in on at by for from with as is are was were be been being " +
    "do does did will would should could can may might must shall it its this that these those " +
    "you your we our they their he she his her i me my what which who whom whose when where " +
    "how why there here than then so not no yes all any each"
  ).split(" "),
);

// Crude stemming so "ships", "shipped" and "shipping" count as the same word.
const stemWord = (w: string) =>
  w.replace(/(?:'s|ing|ed|s)$/u, "").replace(/([b-df-hj-np-tv-z])\1$/u, "$1") || w;

function contentWords(text: string): Set<string> {
  return new Set(
    words(text)
      .filter((w) => !STOPWORDS.has(w))
      .map(stemWord),
  );
}

/** Jaccard overlap of content words, 0 to 1. */
export function stemOverlap(a: string, b: string): number {
  const x = contentWords(a);
  const y = contentWords(b);
  if (x.size === 0 && y.size === 0) return 1;
  let shared = 0;
  for (const w of x) if (y.has(w)) shared++;
  return shared / (x.size + y.size - shared);
}

/**
 * A recheck must ask something new (R§5.5): its stem may not echo the original question,
 * and no option may simply restate the resolution.
 */
export function lintRecheckNovelty(
  recheck: ProbeDraft,
  original: { stem: string; resolutionText: string },
  { maxRecheckOverlap } = PROBE_LINT_DEFAULTS,
): ProbeLintFinding[] {
  const out: ProbeLintFinding[] = [];
  const overlap = stemOverlap(recheck.stem, original.stem);
  if (overlap >= maxRecheckOverlap) {
    out.push(
      finding(
        "recheck_overlap",
        `stem shares ${overlap.toFixed(2)} of its words with the original; max ${maxRecheckOverlap}`,
      ),
    );
  }
  const resolution = foldText(original.resolutionText);
  recheck.options.forEach((o, i) => {
    if (foldText(o.text) === resolution) {
      out.push(finding("recheck_restates_resolution", `option ${i + 1} is the resolution text`));
    }
  });
  return out;
}

/** Every per-probe rule for a diagnostic probe. Dedupe runs across probes separately. */
export function lintProbe(
  probe: ProbeDraft,
  context: { targets: readonly ProbeTarget[]; segments: readonly Pick<Segment, "text">[] },
  options = PROBE_LINT_DEFAULTS,
): ProbeLintFinding[] {
  return [
    ...lintOptionCount(probe.options, options),
    ...lintLengthRatio(probe.options, options),
    ...lintVerbatimSpeaker(probe.options, context.segments, options),
    ...lintPresupposition(probe.stem),
    ...lintOneDimension(probe.stem, context.targets),
    ...lintDebatedTarget(context.targets),
  ];
}

/** Rules for a recheck probe: the shape rules plus novelty against the original. */
export function lintRecheck(
  recheck: ProbeDraft,
  context: {
    original: { stem: string; resolutionText: string };
    segments: readonly Pick<Segment, "text">[];
  },
  options = PROBE_LINT_DEFAULTS,
): ProbeLintFinding[] {
  return [
    ...lintOptionCount(recheck.options, options),
    ...lintLengthRatio(recheck.options, options),
    ...lintVerbatimSpeaker(recheck.options, context.segments, options),
    ...lintPresupposition(recheck.stem),
    ...lintRecheckNovelty(recheck, context.original, options),
  ];
}
