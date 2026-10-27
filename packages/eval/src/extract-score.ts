import { normalizeName, normalizeQuote, parseTranscript, type Participant } from "@forkcheck/core";
import type { DecisionWithEvidence, ExtractInput } from "@forkcheck/engine";
import type { Scenario } from "./scenario";

/** The stage input a scenario describes, with participant IDs equal to their names. */
export function scenarioExtractInput(s: Scenario): ExtractInput {
  const participants: Participant[] = s.participants.map((name) => ({
    id: name,
    meetingId: s.id,
    displayName: name,
    isSimulated: true,
    status: "active",
  }));
  const { segments } = parseTranscript({ meetingId: s.id, text: s.transcript, participants });
  return {
    meeting: { id: s.id, title: s.title, heldAt: s.heldAt, timezone: s.timezone },
    participants,
    segments,
  };
}

export interface ExtractScore {
  scenario: string;
  expected: number;
  extracted: number;
  matched: number;
  /** Expected decision IDs with no extracted match. */
  missed: string[];
  /** Statements of extracted decisions that match nothing expected. */
  extra: string[];
  /** Owners or deadlines shown as stated that the transcript never says. Must be zero. */
  invented: FieldNote[];
  /** Stated owners or deadlines that differ from the scenario's answer key; for review. */
  differs: FieldNote[];
  inferredFlags: number;
}

export interface FieldNote {
  decision: string;
  field: "owner" | "deadline";
  value: string;
}

const fold = (s: string) => normalizeQuote(s).toLowerCase();
const overlaps = (a: string, b: string) => {
  const x = fold(a);
  const y = fold(b);
  return x.includes(y) || y.includes(x);
};

/**
 * Pairs each expected decision with the first unused extracted decision that shares a
 * quote (either contains the other). Quotes, not statements, so wording never decides it.
 */
export function scoreExtraction(s: Scenario, decisions: DecisionWithEvidence[]): ExtractScore {
  const used = new Set<number>();
  const missed: string[] = [];
  const differs: FieldNote[] = [];
  const transcript = fold(s.transcript);
  const people = new Set(s.participants.map(normalizeName));

  // Checked against the raw transcript, independently of the stage's own quote checks.
  const invented: FieldNote[] = [];
  for (const { decision } of decisions) {
    const { ownerText, deadlineText } = decision;
    if (
      ownerText !== null &&
      !decision.ownerInferred &&
      !people.has(normalizeName(ownerText)) &&
      !transcript.includes(fold(ownerText))
    ) {
      invented.push({ decision: decision.id, field: "owner", value: ownerText });
    }
    if (
      deadlineText !== null &&
      !decision.deadlineInferred &&
      !transcript.includes(fold(deadlineText))
    ) {
      invented.push({ decision: decision.id, field: "deadline", value: deadlineText });
    }
  }

  for (const e of s.expectedDecisions) {
    const i = decisions.findIndex(
      (d, k) =>
        !used.has(k) && d.evidence.some((ev) => e.quotes.some((q) => overlaps(ev.quote, q))),
    );
    if (i === -1) {
      missed.push(e.id);
      continue;
    }
    used.add(i);
    const { decision } = decisions[i]!;
    if (
      decision.ownerText !== null &&
      !decision.ownerInferred &&
      (e.owner === null || normalizeName(e.owner) !== normalizeName(decision.ownerText))
    ) {
      differs.push({ decision: e.id, field: "owner", value: decision.ownerText });
    }
    if (decision.deadlineText !== null && !decision.deadlineInferred && e.deadline === null) {
      differs.push({ decision: e.id, field: "deadline", value: decision.deadlineText });
    }
  }

  return {
    scenario: s.id,
    expected: s.expectedDecisions.length,
    extracted: decisions.length,
    matched: used.size,
    missed,
    extra: decisions.filter((_, k) => !used.has(k)).map((d) => d.decision.statement),
    invented,
    differs,
    inferredFlags: decisions.filter((d) => d.decision.ownerInferred || d.decision.deadlineInferred)
      .length,
  };
}

export function summarizeScores(scores: ExtractScore[]) {
  const sum = (f: (s: ExtractScore) => number) => scores.reduce((t, s) => t + f(s), 0);
  const matched = sum((s) => s.matched);
  const extracted = sum((s) => s.extracted);
  const expected = sum((s) => s.expected);
  return {
    precision: extracted === 0 ? 0 : matched / extracted,
    recall: expected === 0 ? 0 : matched / expected,
    matched,
    extracted,
    expected,
    invented: sum((s) => s.invented.length),
    differs: sum((s) => s.differs.length),
  };
}
