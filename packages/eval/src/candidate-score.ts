import type { Candidate } from "@forkcheck/core";
import type { DecisionWithEvidence } from "@forkcheck/engine";
import { matchDecisions } from "./extract-score";
import type { Scenario } from "./scenario";

export interface CandidateScore {
  scenario: string;
  candidates: number;
  /** Planted mismatch IDs with a candidate on the same decision and dimension. */
  hit: string[];
  missed: string[];
  /** Candidates on a planted (decision, dimension) pair; the rest are unplanted. */
  onPlanted: Set<string>;
}

/** A planted mismatch counts as found when a candidate targets its decision and dimension. */
export function scoreCandidates(
  s: Scenario,
  decisions: DecisionWithEvidence[],
  candidates: Candidate[],
): CandidateScore {
  const matches = matchDecisions(s, decisions);
  const hit: string[] = [];
  const missed: string[] = [];
  const onPlanted = new Set<string>();
  for (const m of s.plantedMismatches) {
    const i = matches.get(m.decision);
    const decisionId = i === undefined ? undefined : decisions[i]!.decision.id;
    const found = candidates.filter(
      (c) => c.decisionId === decisionId && c.dimension === m.dimension,
    );
    (found.length > 0 ? hit : missed).push(m.id);
    for (const c of found) onPlanted.add(c.id);
  }
  return { scenario: s.id, candidates: candidates.length, hit, missed, onPlanted };
}
