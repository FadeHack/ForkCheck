import type { Split, SplitStatus } from "@forkcheck/core";
import type { OrganizerMeetingState, ParticipantState } from "../contracts/api";

export const organizerStages = [
  { id: "source", label: "Source" },
  { id: "questions", label: "Questions" },
  { id: "round", label: "Round" },
  { id: "reveal", label: "Reveal" },
  { id: "resolve", label: "Resolve" },
  { id: "recheck", label: "Recheck" },
  { id: "record", label: "Record" },
] as const;
export type OrganizerStage = (typeof organizerStages)[number]["id"];

/** Split states that need nothing more from anyone. */
const SETTLED: readonly SplitStatus[] = ["rechecked", "unresolved"];

/** Splits found by a diagnostic question: the ones the meeting has to resolve. */
export function splitsToSettle(
  splits: readonly Split[],
  probes: OrganizerMeetingState["probes"],
): Split[] {
  const diagnostic = new Set(probes.filter((p) => p.kind === "diagnostic").map((p) => p.id));
  return splits.filter((s) => s.outcome === "split" && diagnostic.has(s.probeId));
}

/**
 * Where the meeting is, worked out from its rounds and splits rather than its status, which
 * stays `revealed` from the first reveal on.
 */
export function organizerStage(state: OrganizerMeetingState): OrganizerStage {
  const diagnostic = state.rounds.filter((r) => r.kind === "diagnostic");
  if (diagnostic.length === 0) return "questions";
  if (diagnostic.some((r) => r.closedAt === null)) return "round";
  const toSettle = splitsToSettle(state.splits, state.probes);
  if (toSettle.length === 0 || toSettle.every((s) => SETTLED.includes(s.status))) {
    return "record";
  }
  const recheckOpen = state.rounds.some((r) => r.kind === "recheck" && r.closedAt === null);
  if (recheckOpen || toSettle.some((s) => s.status === "confirmed")) return "recheck";
  if (state.resolutions.length > 0 || toSettle.some((s) => s.status !== "open")) return "resolve";
  return "reveal";
}

export type ParticipantStage =
  "not_started" | "answer" | "waiting" | "recheck" | "reveal" | "record";

export function participantStage(state: ParticipantState): ParticipantStage {
  if (state.openProbes.length > 0) {
    const answered = new Set(state.ownAnswers.map((a) => a.probeId));
    const unanswered = state.openProbes.filter((p) => !answered.has(p.id));
    if (unanswered.length === 0) return "waiting";
    return unanswered.some((p) => p.kind === "recheck") ? "recheck" : "answer";
  }
  if (state.revealed.length === 0) return "not_started";
  const toSettle = state.revealed.filter(
    (r) => r.split.outcome === "split" && r.probe.kind === "diagnostic",
  );
  return toSettle.every((r) => SETTLED.includes(r.split.status)) ? "record" : "reveal";
}
