import type { ParticipantBrief } from "@forkcheck/engine";
import type { Scenario } from "./scenario";

/** Each participant's brief, keyed the way `scenarioExtractInput` keys participants. */
export function scenarioBriefs(s: Scenario): ParticipantBrief[] {
  return s.participants.map((name) => ({
    participantId: name,
    readings: (s.briefs.find((b) => b.participant === name)?.readings ?? []).map((r) => ({
      decisionId: r.decision,
      dimension: r.dimension,
      reading: r.reading,
    })),
  }));
}

/** At least two participants chose different definite options; "not sure" never counts. */
export const isSplit = (optionIds: (string | null)[]) =>
  new Set(optionIds.filter((o) => o !== null)).size >= 2;
