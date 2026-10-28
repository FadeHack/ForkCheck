import fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  commitmentSurvival,
  commitmentTerms,
  maxWeightAssignment,
  normalizeWords,
  scoreTranscription,
  speakerAccuracy,
  wordErrorRate,
  type AudioTruth,
  type HypothesisTurn,
} from "../src/index";

describe("normalizeWords", () => {
  it("lowercases and drops punctuation, keeping inner apostrophes and hyphens", () => {
    expect(normalizeWords("Great. Then we ship on Friday, after the legal review!")).toEqual([
      "great",
      "then",
      "we",
      "ship",
      "on",
      "friday",
      "after",
      "the",
      "legal",
      "review",
    ]);
    expect(normalizeWords("I’ll do it — mm-hm, 'quoted'")).toEqual([
      "i'll",
      "do",
      "it",
      "mm-hm",
      "quoted",
    ]);
  });
});

describe("clock times", () => {
  it("drop the colon so 17:00 and 1700 compare equal", () => {
    expect(normalizeWords("by 17:00 UTC, 9:30")).toEqual(["by", "1700", "utc", "930"]);
  });
});

describe("wordErrorRate", () => {
  it("is 0 for a match up to case and punctuation", () => {
    expect(wordErrorRate("Ship it on Friday.", "ship it on friday").wer).toBe(0);
  });

  it("counts substitutions, deletions and insertions", () => {
    // ref: the cat sat on the mat (6); hyp: the cat sit on mat mat now
    const r = wordErrorRate("the cat sat on the mat", "the cat sit on mat mat now");
    expect(r).toMatchObject({ referenceWords: 6 });
    expect(r.substitutions + r.deletions + r.insertions).toBe(3);
    expect(r.wer).toBeCloseTo(3 / 6);
  });

  it("counts a repeated word as one insertion", () => {
    const r = wordErrorRate("the pricing page", "the pricing pricing page");
    expect(r).toEqual({
      wer: 1 / 3,
      referenceWords: 3,
      substitutions: 0,
      deletions: 0,
      insertions: 1,
    });
  });

  it("handles empty sides", () => {
    expect(wordErrorRate("", "").wer).toBe(0);
    expect(wordErrorRate("", "noise").wer).toBe(1);
    expect(wordErrorRate("two words", "")).toMatchObject({ wer: 1, deletions: 2 });
  });
});

describe("maxWeightAssignment", () => {
  it("finds the optimum where greedy choice fails", () => {
    // Greedy takes row 0 → col 0 (9) and leaves row 1 with 1: total 10. Optimum is 8 + 8 = 16.
    expect(
      maxWeightAssignment([
        [9, 8],
        [8, 1],
      ]),
    ).toEqual([1, 0]);
  });

  it("leaves extra rows unassigned and handles extra columns", () => {
    expect(
      maxWeightAssignment([
        [5, 0],
        [0, 5],
        [4, 4],
      ]),
    ).toEqual([0, 1, -1]);
    expect(maxWeightAssignment([[1, 7, 3]])).toEqual([1]);
    expect(maxWeightAssignment([])).toEqual([]);
  });

  it("matches brute force on small matrices", () => {
    const permutations = (n: number): number[][] =>
      n === 0
        ? [[]]
        : permutations(n - 1).flatMap((p) =>
            Array.from({ length: n }, (_, i) => [...p.slice(0, i), n - 1, ...p.slice(i)]),
          );
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 4 }).chain((n) =>
          fc.array(fc.array(fc.integer({ min: 0, max: 50 }), { minLength: n, maxLength: n }), {
            minLength: n,
            maxLength: n,
          }),
        ),
        (w) => {
          const total = (a: number[]) => a.reduce((s, j, i) => s + (j >= 0 ? w[i]![j]! : 0), 0);
          const best = Math.max(...permutations(w.length).map(total));
          expect(total(maxWeightAssignment(w))).toBe(best);
        },
      ),
    );
  });
});

const line = (
  idx: number,
  speaker: string,
  text: string,
  startMs: number,
  endMs: number,
  kind: "turn" | "backchannel" = "turn",
) => ({
  idx,
  speaker,
  voice: "v",
  text,
  startMs,
  endMs,
  kind,
  scriptIdx: kind === "turn" ? idx : null,
});

const truth: Pick<AudioTruth, "turns"> = {
  turns: [
    line(0, "Rosa", "They need it back next Friday.", 0, 3000),
    line(1, "Kwame", "Next Friday is fine. I'll own the questionnaire.", 3400, 7000),
    line(2, "Lena", "Mm-hm.", 5000, 5500, "backchannel"),
    line(3, "Lena", "I'll do the legal and insurance sections.", 7400, 10_000),
  ],
};

const hyp = (
  speaker: string,
  startMs: number,
  endMs: number,
  transcript: string,
): HypothesisTurn => ({
  speaker,
  startMs,
  endMs,
  transcript,
});

describe("speakerAccuracy", () => {
  it("maps labels to people by shared time, independent of label names", () => {
    const r = speakerAccuracy(truth, [
      hyp("B", 0, 3000, "x"),
      hyp("A", 3400, 7000, "x"),
      hyp("C", 7400, 10_000, "x"),
    ]);
    expect(r.mapping).toEqual({ B: "Rosa", A: "Kwame", C: "Lena" });
    expect(r).toMatchObject({ correct: 3, total: 3, accuracy: 1 });
  });

  it("scores merged speakers as errors", () => {
    // One label covers Rosa and Kwame; Kwame's turn is longer, so A maps to Kwame.
    const r = speakerAccuracy(truth, [hyp("A", 0, 7000, "x"), hyp("B", 7400, 10_000, "x")]);
    expect(r.mapping).toEqual({ A: "Kwame", B: "Lena" });
    expect(r).toMatchObject({ correct: 2, total: 3 });
  });

  it("leaves over-segmented labels unmapped", () => {
    const r = speakerAccuracy(truth, [
      hyp("A", 0, 3000, "x"),
      hyp("B", 3400, 5000, "x"),
      hyp("D", 5000, 7000, "x"),
      hyp("C", 7400, 10_000, "x"),
    ]);
    expect(Object.values(r.mapping).filter((p) => p === null)).toHaveLength(1);
  });
});

const source = {
  participants: ["Rosa", "Kwame", "Lena"],
  expectedDecisions: [
    {
      statement: "Kwame returns the questionnaire next Friday.",
      quotes: ["They need it back next Friday", "I'll own the questionnaire"],
    },
    {
      statement: "Lena does the legal and insurance sections.",
      quotes: ["legal and insurance sections"],
    },
  ],
};

describe("commitment survival", () => {
  it("extracts dates, names and deliverable nouns from quotes", () => {
    expect(commitmentTerms(source, truth).map((t) => [t.term, t.kind, t.speaker])).toEqual([
      ["next", "date", "Rosa"],
      ["friday", "date", "Rosa"],
      ["questionnaire", "deliverable", "Kwame"],
      ["legal", "deliverable", "Lena"],
      ["insurance", "deliverable", "Lena"],
      ["sections", "deliverable", "Lena"],
    ]);
  });

  it("accepts a term the ASR split into words, but not a longer word containing it", () => {
    const terms = [
      { term: "questionnaire", kind: "deliverable" as const, scriptIdx: 1, speaker: "Kwame" },
    ];
    const mapping = { B: "Kwame" };
    const split = [hyp("B", 3400, 7000, "I'll own the question naire.")];
    expect(commitmentSurvival(terms, truth, split, mapping).survived).toBe(1);
    const name = [{ term: "jun", kind: "name" as const, scriptIdx: 1, speaker: "Kwame" }];
    const longer = [hyp("B", 3400, 7000, "June owns it.")];
    expect(commitmentSurvival(name, truth, longer, mapping).survived).toBe(0);
  });

  it("requires the term in the right speaker's overlapping turn", () => {
    const terms = commitmentTerms(source, truth);
    const hypothesis = [
      hyp("A", 0, 3000, "They need it back next Friday."),
      hyp("B", 3400, 7000, "Next Friday is fine. I'll own the question air."),
      // Right words, but attributed to Kwame's label.
      hyp("B", 7400, 10_000, "I'll do the legal and insurance sections."),
    ];
    const mapping = { A: "Rosa", B: "Kwame" };
    const r = commitmentSurvival(terms, truth, hypothesis, mapping);
    expect(r.survived).toBe(2);
    expect(r.lost.map((t) => t.term)).toEqual(["questionnaire", "legal", "insurance", "sections"]);
  });
});

describe("scoreTranscription", () => {
  it("is perfect for a perfect transcription", () => {
    const hypothesis = truth.turns.map(
      (t, i) =>
        hyp(`L${t.speaker}`, t.startMs, t.endMs, t.text) &&
        hyp(["A", "B", "C", "C"][i]!, t.startMs, t.endMs, t.text),
    );
    const r = scoreTranscription(source, truth, hypothesis);
    expect(r.wer.wer).toBe(0);
    expect(r.speakers.accuracy).toBe(1);
    expect(r.commitments.survival).toBe(1);
  });
});
