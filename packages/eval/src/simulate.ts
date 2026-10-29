import { confirmedResolutionNote, type ParticipantBrief } from "@forkcheck/engine";
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

/**
 * Briefs for a recheck round: each participant keeps their own reading of the planted gap
 * and now also holds the resolution the group confirmed, which is how a vague resolution
 * hides the same split.
 */
export function recheckBriefs(
  s: Scenario,
  mismatchId: string,
  resolutionText: string,
): ParticipantBrief[] {
  const m = s.plantedMismatches.find((x) => x.id === mismatchId);
  if (!m) throw new Error(`unknown mismatch ${mismatchId}`);
  return scenarioBriefs(s).map((b) => ({
    ...b,
    readings: b.readings.map((r) =>
      r.decisionId === m.decision && r.dimension === m.dimension
        ? {
            ...r,
            reading: `${r.reading} ${confirmedResolutionNote(resolutionText)}`,
          }
        : r,
    ),
  }));
}
